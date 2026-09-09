/**
 * Generic admission seam for image prompts on models that cannot take image
 * input. The session controller refuses such prompts by default
 * (`MODEL_DOES_NOT_SUPPORT_IMAGES`), but a plugin may provide the optional
 * `imagePromptAdmission` service to take the admission over — e.g. automatic
 * image analysis that keeps the user's picture in the conversation, runs a
 * vision subagent over it, and publishes the transcription as a notice that
 * wakes the main model.
 *
 * Takeover contract for the service:
 * - Return `{ kind: 'admitted' }`: the controller answers the prompt RPC
 *   `accepted` and does nothing else — durable conversion and message
 *   admission are the service's. Nothing in this seam awaits background work:
 *   the RPC returns immediately, so long-running orchestration must proceed
 *   asynchronously.
 * - Return `{ kind: 'rejected', code, message, reason }` to refuse the prompt
 *   with the service's own error; the controller throws it as a
 *   `session/attachment-invalid` RemoteError.
 * - No service registered keeps the historical refusal.
 *
 * The payload's `content` is the raw client parts (images still staged file
 * receipts; nothing admitted yet). A takeover listener that needs durable
 * image blocks runs the same promotion the controller would: resolve file
 * receipts through `ctx.fileUploads.resolve(agent, receiptId)` and promote
 * via `ctx.attachments.admitPromptContent`.
 *
 * @module dsh-api-session-controller/image-prompt-admission
 */

import type { Agent } from '@deepseek-ai/dsh-agent'
import type { LlmModelInfo, MessageSource } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { PromptContentPart } from './types.ts'

/** One takeover decision for an image prompt the model cannot carry natively. */
export type ImagePromptAdmitDecision =
  /** The service admitted the prompt itself; the RPC answers `accepted`. */
  | { kind: 'admitted' }
  /** Refuse the prompt with the service's own diagnostic. */
  | { kind: 'rejected'; code: string; message: string; reason: string }

/** The admission context the controller hands to the takeover service. */
export interface ImagePromptAdmission {
  /** The session the prompt targets. */
  readonly sessionId: SessionId
  /** The session's live agent; its facade methods are the takeover surface. */
  readonly agent: Agent
  /** The prompt's dispatch mode; a takeover must honor steer-vs-queue. */
  readonly mode: 'queue' | 'steer'
  /** Raw client parts (images still staged; nothing admitted yet). */
  readonly content: readonly PromptContentPart[]
  /** Request identity and optional browser zone — use verbatim on any durable message you create. */
  readonly source: MessageSource
  /** Provider route of the session's current model selection. */
  readonly provider: string
  /** Model id of the session's current selection. */
  readonly model: string
  /** Resolved model facts that failed the image-capability check. */
  readonly modelInfo: LlmModelInfo
}

/**
 * Optional host service that may take over image-prompt admission when the
 * session's model cannot carry images. Registered by a plugin through
 * `ctx.provide('imagePromptAdmission', service)`; absent by default.
 */
export interface ImagePromptAdmissionService {
  /** Decide one admission; see {@link ImagePromptAdmitDecision}. */
  readonly admit: (admission: ImagePromptAdmission) => Promise<ImagePromptAdmitDecision>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Optional image-prompt admission takeover (see {@link ImagePromptAdmissionService}). */
    readonly imagePromptAdmission?: ImagePromptAdmissionService
  }
}
