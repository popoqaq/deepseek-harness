/**
 * Automatic image analysis for text-only sessions — host plugin.
 *
 * Takes over image-prompt admission through the session controller's
 * generic seam (the optional `imagePromptAdmission` service declared by
 * dsh-api-session-controller): when the session's model cannot take image
 * input, the plugin keeps the user's picture in the conversation (an
 * injected image message, bubble included), runs a vision-model subagent
 * over the persisted bytes in the background, and publishes the
 * transcription as a `notice` context message that wakes the main model.
 * Every failure degrades to a short account instead of losing the user
 * message; agent disposal (stop/session teardown) aborts the in-flight
 * round so no stale notice lands afterwards.
 *
 * Durable content is promoted through the same services the controller uses
 * (`ctx.fileUploads.resolve` + `ctx.attachments.admitPromptContent`), so
 * limits and validation stay identical on both paths.
 *
 * @module dsh-image-analysis
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'

import type { Agent } from '@deepseek-ai/dsh-agent'
import { AttachmentError } from '@deepseek-ai/dsh-attachment'
import type { AttachmentAdmissionPart, ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-client-file-upload'
import type {
  ImagePromptAdmission,
  ImagePromptAdmissionService,
  ImagePromptAdmitDecision,
} from '@deepseek-ai/dsh-api-session-controller/src/image-prompt-admission.ts'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, UserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { SubagentResult } from '@deepseek-ai/dsh-subagent'

export const name = 'dsh-image-analysis'

/**
 * Services the admission listener and the analysis chain touch directly.
 * Declared so this plugin's fiber resolves the sibling providers (cordis
 * climbs service stores only for fibers that declare the requirement);
 * without this, the first `ctx.agents`/`ctx.subagents` access throws
 * `cannot get property ... without inject`.
 */
export const inject = ['agents', 'attachments', 'fileUploads', 'subagents']

export interface Config {
  /** Master switch; `false` leaves the gateway's historical refusal in place. */
  enabled: boolean
  /** Vision model the analysis subagent runs on (through the session's provider route). */
  model: string
  /** Analysis budget in milliseconds; expiry degrades to the workspace note. */
  timeoutMs: number
  /** Workspace-relative directory the persisted images land in. */
  directory: string
}

export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true),
  model: z.string().default('deepseek-v4-flash-vision-exp'),
  timeoutMs: z.natural().default(120_000),
  directory: z.string().default('.dsh-images'),
})

const EXTENSIONS: Readonly<Record<ImageAttachmentRef['mediaType'], string>> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
}

/** Join the text blocks of a message (the analysis notice carrier). */
function flattenText(blocks: readonly ContentBlock[]): string {
  return blocks
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('')
}

/** First line of a text, bounded for the collapsed notice summary. */
function oneLine(text: string, max: number): string {
  const first = text.split('\n', 1)[0]?.trim() ?? ''
  return first.length > max ? `${first.slice(0, max)}…` : first
}

/** A degraded outcome: the analysis could not run or produced nothing. */
function degraded(text: string): AnalysisOutcome {
  return { ok: false, summary: '自动分析失败', text }
}

/** One analysis round's user-facing outcome. */
interface AnalysisOutcome {
  ok: boolean
  /** One-line account for the collapsed notice row. */
  summary: string
  /** Full model-facing text (the notice content). */
  text: string
}

/** One durable image part admitted through the controller's pipeline. */
interface DurableImage {
  /** Durable attachment reference, resolvable to bytes via `ctx.attachments`. */
  readonly attachment: ImageAttachmentRef
}

/** Admitted content split into the parts a message and analysis can use. */
interface ResolvedPrompt {
  /** The durable user-message content (images and text). */
  readonly content: ContentBlock[]
  /** The durable image parts, in order. */
  readonly images: readonly DurableImage[]
  /** Joined user text (the analysis question carrier). */
  readonly text: string
}

/**
 * Promote raw client parts to durable content through the same services the
 * session controller uses (file receipts resolved by `ctx.fileUploads`,
 * images validated and persisted by `ctx.attachments.admitPromptContent`),
 * so limits and validation stay identical on both paths.
 */
async function promotePromptContent(
  ctx: Context,
  agent: Agent,
  content: ImagePromptAdmission['content'],
): Promise<ResolvedPrompt> {
  const resolved = content.map((part): AttachmentAdmissionPart => {
    if (part.type === 'file') {
      const attachment = ctx.fileUploads.resolve(agent, part.receiptId)
      if (attachment === undefined) {
        throw new Error('File was not uploaded for this session.')
      }
      return { type: 'file', attachment }
    }
    if (part.type === 'image') {
      return {
        type: 'image',
        mediaType: part.mediaType,
        data: part.data,
        ...(part.name === undefined ? {} : { name: part.name }),
      }
    }
    return { type: 'text', text: part.text }
  })
  const admitted = await ctx.attachments.admitPromptContent(resolved)
  const images: DurableImage[] = []
  const blocks: ContentBlock[] = []
  const text: string[] = []
  for (const part of admitted) {
    if (part.type === 'text') {
      text.push(part.text)
      blocks.push({ type: 'text', text: part.text })
    } else if (part.type === 'image') {
      images.push({ attachment: part.attachment })
      blocks.push({ type: 'image', attachment: part.attachment })
    } else {
      // A staged non-image file has no user message seat on this path.
      ctx.logger.warn('image-analysis: dropping non-image staged file from the takeover message')
    }
  }
  return { content: blocks, images, text: text.join('') }
}

/** Persist one durable image attachment into the analysis directory. */
async function persistImage(
  ctx: Context,
  image: DurableImage,
  dir: string,
  index: number,
): Promise<{ path: string; name: string } | undefined> {
  const stored = await ctx.attachments.readImage(image.attachment)
  const shortId = image.attachment.attachmentId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 12)
  const name = `img-${index + 1}-${shortId}${EXTENSIONS[stored.ref.mediaType]}`
  const path = join(dir, name)
  await writeFile(path, stored.data)
  return { path, name }
}

/**
 * Analyze the given durable image blocks with a vision-model subagent and
 * report the outcome. Never returns a throwing path except abort: workspace,
 * attachment, persistence, subagent, timeout, and empty-output failures all
 * degrade to a short account.
 */
async function analyzeImages(
  ctx: Context,
  agent: Agent,
  images: readonly DurableImage[],
  userText: string,
  config: Config,
  provider: string,
  signal: AbortSignal,
): Promise<AnalysisOutcome> {
  const cwd = agent.session.header.cwd
  if (cwd === undefined) {
    return degraded('图片已随消息接收，但当前会话没有工作目录，未能自动分析；可切换支持图片的模型后直接查看。')
  }
  const dir = join(cwd, config.directory)
  const persisted: { path: string; name: string }[] = []
  try {
    await mkdir(dir, { recursive: true })
  } catch (error) {
    ctx.logger.warn(`image-analysis: creating "${dir}" failed: ${String(error)}`)
    return degraded('图片已随消息接收，但工作区目录不可写，未能自动分析；可切换支持图片的模型后直接查看。')
  }
  for (const [index, image] of images.entries()) {
    signal.throwIfAborted()
    try {
      const entry = await persistImage(ctx, image, dir, index)
      if (entry !== undefined) persisted.push(entry)
    } catch (error) {
      ctx.logger.warn(`image-analysis: persisting "${image.attachment.attachmentId}" failed: ${String(error)}`)
    }
  }
  if (persisted.length === 0) {
    return degraded('图片已随消息接收，但保存到工作区失败，未能自动分析；可切换支持图片的模型后直接查看。')
  }

  const promptText = [
    '分析以下图片并回答用户的问题。请用图片所在语言的短句作答。',
    '图片文件（使用 read_image 工具逐个查看）：',
    ...persisted.map(({ path }) => `- ${path}`),
    ...(userText.length > 0 ? ['', `用户问题：${userText}`] : []),
  ].join('\n')

  const budget = AbortSignal.timeout(config.timeoutMs)
  const combined = AbortSignal.any([budget, signal])

  let result: SubagentResult | undefined
  try {
    const run = await ctx.subagents.start('spawn', {
      label: 'image-analysis',
      prompt: [{ type: 'text', text: promptText }],
      parent: agent,
      signal: combined,
      agentOptions: { provider, model: config.model },
    })
    try {
      result = await run.result
    } finally {
      await run.dispose()
    }
  } catch (error) {
    signal.throwIfAborted()
    if (combined.aborted) {
      ctx.logger.warn(`image-analysis: subagent analysis timed out after ${config.timeoutMs}ms`)
    } else {
      ctx.logger.warn(`image-analysis: subagent analysis failed: ${String(error)}`)
    }
    return degraded(
      `图片已保存到工作区 ${config.directory}/，但自动分析${combined.aborted ? '超时' : '失败'}；可切换支持图片的模型后直接查看。`,
    )
  }

  const analysis = flattenText(result.output).trim()
  if (result.stopReason === 'completed' && analysis.length > 0) {
    return {
      ok: true,
      summary: oneLine(analysis, 160),
      text: analysis,
    }
  }
  return degraded(
    `图片已保存到工作区 ${config.directory}/，但自动分析未产生结果；可切换支持图片的模型后直接查看。`,
  )
}

/** Per-session background analysis bookkeeping (rounds chain so notices keep prompt order). */
interface AnalysisState {
  chain: Promise<void>
  abort: AbortController
}

export function apply(ctx: Context, config: Config): void {
  if (!config.enabled) return
  const states = new Map<SessionId, AnalysisState>()

  /** Run one round in the background and publish its outcome as a notice. */
  function scheduleAnalysis(
    agent: Agent,
    images: readonly DurableImage[],
    userText: string,
    provider: string,
  ): void {
    const sessionId = agent.id
    const controller = new AbortController()
    const prior = states.get(sessionId)?.chain ?? Promise.resolve()
    const chain = prior.then(async () => {
      try {
        const outcome = await analyzeImages(
          ctx, agent, images, userText, config, provider, controller.signal,
        )
        // The agent may have been detached (session switched/removed) while
        // the analysis ran; publishing to a dead agent would strand a notice.
        if (ctx.agents.get(sessionId) !== agent || controller.signal.aborted) {
          return
        }
        const message = createUserMessage({
          content: [{ type: 'text', text: outcome.text }],
          source: {
            kind: 'plugin',
            plugin: 'image-analysis',
            form: 'notice',
            summary: outcome.summary,
          },
        })
        agent.followup(message)
      } catch (error) {
        // Caller abort (agent disposal/session teardown): stay silent — the
        // injected image message is the user's own and needs no stale notice.
        ctx.logger.info(`image-analysis: analysis for "${sessionId}" aborted: ${String(error)}`)
      } finally {
        states.delete(sessionId)
      }
    })
    states.set(sessionId, { chain, abort: controller })
  }

  // Agent disposal (user stop / session teardown) aborts the in-flight round.
  ctx.on('agent/disposed', ({ agent }) => {
    states.get(agent.id)?.abort.abort('agent disposed')
  })

  // The admission seam: take over image prompts the session's model cannot
  // carry. Keep the picture visible IMMEDIATELY, then let the analysis notice
  // wake the main model when it lands.
  const admissionService: ImagePromptAdmissionService = {
    admit: async (payload: ImagePromptAdmission): Promise<ImagePromptAdmitDecision> => {
      let resolved: ResolvedPrompt
      try {
        resolved = await promotePromptContent(ctx, payload.agent, payload.content)
      } catch (error) {
        const code = error instanceof AttachmentError ? error.code : 'unavailable'
        return {
          kind: 'rejected',
          code: 'attachment-error',
          message: error instanceof Error ? error.message : 'Image prompt admission failed',
          reason: code,
        }
      }
      const message: UserMessage = createUserMessage({
        content: resolved.content,
        source: payload.source,
      })
      // Append the user message to the session log NOW rather than queueing it
      // in the agent inbox: an inbox-only message materializes only when a step
      // claims it, which would wait for the analysis notice and leave the UI
      // (bubble + analyzing status) silent for the whole vision round. A plain
      // log append broadcasts the node immediately and wakes nothing; the
      // notice follow-up below is the only inbox item, so the main model runs
      // once with the notice, and the text-only serializer drops the bare image
      // message while carrying the notice text.
      payload.agent.session.append('user/message', message, { surfaceOp: 'append' })
      scheduleAnalysis(payload.agent, resolved.images, resolved.text, payload.provider)
      return { kind: 'admitted' }
    },
  }
  ctx.effect(
    () => ctx.provide('imagePromptAdmission', admissionService),
    'image-analysis: admission takeover',
  )
}
