/**
 * dsh-image-analysis host plugin: provides the `imagePromptAdmission`
 * takeover service, keeps the picture in the conversation, runs the vision
 * subagent, and publishes the notice that wakes the main model.
 */

import { describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {
  ImagePromptAdmission,
  ImagePromptAdmissionService,
} from '@deepseek-ai/dsh-api-session-controller/src/image-prompt-admission.ts'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { apply, Config, name } from '../src/index.ts'

const IMAGE_PART = {
  type: 'image' as const,
  mediaType: 'image/png' as const,
  data: 'AQIDBA==',
  name: 'shot.png',
}

async function harness(options: {
  analysis?: ContentBlock[]
  stopReason?: string
  cwd?: string
  withAttachments?: boolean
} = {}): Promise<{
  ctx: Context
  agent: Agent & { inject: ReturnType<typeof vi.fn>; followup: ReturnType<typeof vi.fn> }
  service: ImagePromptAdmissionService
}> {
  const ctx = new Context()
  if (options.withAttachments !== false) {
    ctx.provide('attachments', {
      admitPromptContent: vi.fn(async (content: readonly { type: string; mediaType?: string }[]) =>
        content.map(part => part.type === 'image'
          ? { type: 'image', attachment: { attachmentId: 'att-saved', mediaType: part.mediaType, bytes: 4, width: 1, height: 1 } }
          : part)),
      readImage: vi.fn(async () => ({
        ref: { attachmentId: 'att-saved', mediaType: 'image/png', bytes: 4, width: 1, height: 1 },
        data: Uint8Array.of(1, 2, 3, 4),
      })),
    } as never)
  }
  ctx.provide('fileUploads', { resolve: vi.fn(() => undefined) } as never)
  const followup = vi.fn()
  const inject = vi.fn()
  const append = vi.fn()
  const agent = {
    id: 'session-under-test',
    ctx,
    session: {
      header: { cwd: options.cwd },
      append,
    },
    inject,
    followup,
  } as unknown as Agent & { inject: typeof inject; followup: typeof followup }
  ctx.provide('agents', { get: () => agent } as never)
  ctx.provide('subagents', {
    start: vi.fn(async () => ({
      result: Promise.resolve({
        output: options.analysis ?? [],
        stopReason: options.stopReason ?? 'completed',
      }),
      dispose: vi.fn(async () => {}),
    })),
  } as never)

  await ctx.plugin({ name, Config, apply }, {
    enabled: true,
    model: 'deepseek-v4-flash-vision-exp',
    timeoutMs: 120_000,
    directory: '.dsh-images',
  })
  const service = ctx.imagePromptAdmission
  if (service === undefined) throw new Error('imagePromptAdmission service was not provided')
  return { ctx, agent, service }
}

/** Full admission payload the controller would pass at the refusal point. */
function payload(agent: Agent, partial: Partial<ImagePromptAdmission> = {}): ImagePromptAdmission {
  return {
    sessionId: 'session-under-test' as SessionId,
    agent,
    mode: 'queue',
    source: { kind: 'user' as const },
    content: [IMAGE_PART],
    provider: 'deepseek-official',
    model: 'deepseek-v4-flash',
    modelInfo: {
      provider: 'deepseek-official',
      id: 'deepseek-v4-flash',
      name: 'DeepSeek-V4-Flash',
      inputModalities: ['text'],
    },
    ...partial,
  }
}

describe('dsh-image-analysis host plugin', () => {
  it('takes the admission over, surfaces the picture, and publishes the analysis notice', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'dsh-image-analysis-'))
    try {
      const { ctx, agent, service } = await harness({
        cwd,
        analysis: [{ type: 'text', text: '这是一只猫。' }],
      })
      const result = await service.admit(payload(agent))
      expect(result).toEqual({ kind: 'admitted' })
      // The picture lands in the session log IMMEDIATELY (bubble + status);
      // nothing is injected into the inbox and nothing wakes the main model.
      expect(agent.inject).not.toHaveBeenCalled()
      const session = agent.session as unknown as { append: ReturnType<typeof vi.fn> }
      expect(session.append).toHaveBeenCalledTimes(1)
      const [eventType, appended] = session.append.mock.calls[0] as unknown as [
        string, { content: ContentBlock[] },
      ]
      expect(eventType).toBe('user/message')
      expect(appended.content[0]).toMatchObject({ type: 'image', attachment: { attachmentId: 'att-saved' } })
      // The analysis round settles into the notice that wakes the main model.
      await vi.waitFor(() => {
        expect(agent.followup).toHaveBeenCalledTimes(1)
      })
      const [notice] = agent.followup.mock.calls[0] as unknown as [{
        content: Array<{ text: string }>
        source: { plugin: string; form: string }
      }]
      expect(notice.content[0]?.text).toBe('这是一只猫。')
      expect(notice.source).toMatchObject({ plugin: 'image-analysis', form: 'notice' })
      // The image was persisted into the session workspace (content-addressed
      // short id, punctuation stripped).
      const { existsSync } = await import('node:fs')
      expect(existsSync(join(cwd, '.dsh-images', 'img-1-attsaved.png'))).toBe(true)
      await ctx.fiber.dispose()
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  it('publishes a degraded notice when the subagent produces nothing', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'dsh-image-analysis-'))
    try {
      const { ctx, agent, service } = await harness({ cwd, analysis: [] })
      expect(await service.admit(payload(agent))).toEqual({ kind: 'admitted' })
      await vi.waitFor(() => {
        expect(agent.followup).toHaveBeenCalledTimes(1)
      })
      const [notice] = agent.followup.mock.calls[0] as unknown as [{
        content: Array<{ text: string }>
      }]
      expect(notice.content[0]?.text).toContain('自动分析未产生结果')
      await ctx.fiber.dispose()
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  it('rejects with the attachment-error shape when the attachment service is missing', async () => {
    const { ctx, agent, service } = await harness({ withAttachments: false })
    const result = await service.admit(payload(agent))
    expect(result).toMatchObject({ kind: 'rejected', code: 'attachment-error' })
    await ctx.fiber.dispose()
  })

  it('degrades when the session has no workspace directory', async () => {
    const { ctx, agent, service } = await harness({ analysis: [{ type: 'text', text: 'x' }] })
    expect(await service.admit(payload(agent))).toEqual({ kind: 'admitted' })
    await vi.waitFor(() => {
      expect(agent.followup).toHaveBeenCalledTimes(1)
    })
    const [notice] = agent.followup.mock.calls[0] as unknown as [{
      content: Array<{ text: string }>
    }]
    expect(notice.content[0]?.text).toContain('没有工作目录')
    await ctx.fiber.dispose()
  })
})
