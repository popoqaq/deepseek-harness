# dsh-image-analysis

English | [中文](README.zh.md)

Host plugin: automatic image analysis for text-only sessions.

When a prompt carries images and the session's model cannot take image input, the gateway refuses it by default. This plugin takes the admission over through the generic seam `gateway/admit-image-prompt` (declared by `dsh-host-apiproxy`): it keeps the user's picture in the conversation (an injected image message, bubble included), persists the bytes into the session workspace (`.dsh-images/`), runs a vision-model subagent over them in the background, and publishes the transcription as a `notice` context message that wakes the main model.

- The main model's request serializer (`llm-deepseek`) drops the bare image message and carries the notice text, so an image-only prompt whose notice follows must not fail with `UNSUPPORTED_CONTENT`.
- Every failure (no workspace, missing attachment service, persistence failure, subagent failure/timeout, empty output) degrades to a short account instead of losing the user message.
- Agent disposal (user stop, session teardown) aborts the in-flight round; no stale notice is published afterwards.
- `enabled: false` leaves the gateway's historical refusal in place.

## Configuration

| Field | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | Master switch. |
| `model` | `deepseek-v4-flash-vision-exp` | Vision model the analysis subagent runs on (through the session's provider route). |
| `timeoutMs` | `120000` | Analysis budget; expiry degrades to the workspace note. |
| `directory` | `.dsh-images` | Workspace-relative directory the persisted images land in. |

No companion browser package is needed: the upstream conversation surface natively provides the file-pick attach button (ui-conversation composer paperclip), the picture surfaces immediately on admission, and the analysis lands as an ordinary conversation notice.
