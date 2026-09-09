# TongdaXin Finance MCP

DSH 默认使用通达信官方 Streamable HTTP MCP，而不是社区 `pytdx` HQ TCP
节点。官方服务地址来自通达信配置指南：

```text
https://txmcp.tdx.com.cn:3001/txmcp
```

它支持由通达信官方 MCP 暴露的行情、财务、资金流向等工具；具体工具列表
以服务端返回为准。该服务不提供下单、撤单或账户操作授权。

## DSH 配置

MCP Manager 使用以下安全配置：

```json
{
  "transport": "streamable-http",
  "label": "通达信官方数据",
  "serverName": "tdx-finance",
  "url": "https://txmcp.tdx.com.cn:3001/txmcp",
  "headers": {},
  "credentialHeaders": {
    "Authorization": "TDX_API_KEY"
  },
  "enabled": true
}
```

`TDX_API_KEY` 是 DSH Credential ref，不是实际密钥。实际 API Key 必须在
DSH 凭据设置中手动配置，不能写入 MCP JSON、代码仓库或聊天消息。没有配置
时，MCP 会显示 `blocked / 等待凭据`，不会把未授权请求发送到通达信。

通达信 API Key 获取流程：

1. 登录通达信 AI 平台并进入会员中心；
2. 在「API Key 管理」创建 Key；
3. 选择「问答词元」并复制密钥；
4. 在 DSH 的凭据配置中，将 ref `TDX_API_KEY` 写入该密钥。

## Agent-only 安装规则

MCP 只能由 Agent 通过 `mcp_install` 安装，Web 设置页不提供新增 MCP 按钮。
已安装的 MCP 可以在 Web 设置中手动配置 API Key、Authorization 和其他认证
字段。

## Legacy fallback

本目录中的 `tdx_mcp/` 保留了早期基于社区 `pytdx` HQ 协议的只读实现，便于
离线测试和兼容旧环境，但它不是当前 DSH 默认接入方式。由于公共 HQ 节点可能
返回空数据，不应再把它作为官方 API 的替代品。

## 风险提示

通达信 API 数据可能存在延迟或额度限制。行情、财务和资金数据仅供研究参考，
不构成投资建议。
