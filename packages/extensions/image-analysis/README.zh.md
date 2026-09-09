# dsh-image-analysis

[English](README.md) | 中文

宿主插件：面向纯文本会话的自动图片分析。

当提示词携带图片而会话当前模型不支持图片输入时，网关默认会拒绝该提示词。本插件通过 `dsh-host-apiproxy` 声明的通用准入缝 `gateway/admit-image-prompt` 接管准入：把用户的图片保留在会话中（注入的图片消息，气泡立现），将图片字节落盘到会话工作区（`.dsh-images/`），在后台用视觉模型子代理分析，并把转写结果以 `notice` 上下文消息发布、唤醒主模型。

- 主模型的请求序列化器（`llm-deepseek`）会丢弃纯图片消息并携带 notice 文本，因此"纯图片提示词 + 随后的分析 notice"不会以 `UNSUPPORTED_CONTENT` 失败。
- 一切失败（无工作目录、附件服务缺失、落盘失败、子代理失败/超时、空输出）都降级为简短说明，绝不丢失用户消息。
- agent 销毁（用户停止、会话拆除）会中止进行中的分析轮次，之后不再发布过期 notice。
- `enabled: false` 时保持网关的历史拒绝行为。

## 配置

| 字段 | 默认值 | 含义 |
| --- | --- | --- |
| `enabled` | `true` | 总开关。 |
| `model` | `deepseek-v4-flash-vision-exp` | 分析子代理使用的视觉模型（经会话的 provider 路由解析）。 |
| `timeoutMs` | `120000` | 分析预算；超时降级为工作区提示。 |
| `directory` | `.dsh-images` | 图片落盘的工作区相对目录。 |

无需配套浏览器包：上游会话界面原生提供文件选择按钮（ui-conversation 输入框回形针），图片在准入时即时上屏，分析结果以普通会话 notice 呈现。
