# Weather MCP

一个用于测试 MCP 生命周期的只读天气服务，数据来自无需 API Key 的
[Open-Meteo Forecast API](https://open-meteo.com/en/docs)。

## Tools

- `weather_current(location)`：当前天气；
- `weather_forecast(location, days)`：未来 1 至 7 天预报。

## 运行

```bash
cd /Users/muku/work/deepseek-harness/packages/mcp/mcp-weather
uv sync
uv run weather-mcp
```

在 DSH MCP Manager 的 Agent 安装流程中，stdio 配置应为：

```json
{
  "transport": "stdio",
  "serverName": "weather",
  "command": "uv",
  "args": [
    "run",
    "--directory",
    "/Users/muku/work/deepseek-harness/packages/mcp/mcp-weather",
    "weather-mcp"
  ],
  "cwd": "/Users/muku/work/deepseek-harness/packages/mcp/mcp-weather",
  "enabled": true
}
```

示例调用：

```text
weather_current("上海")
weather_forecast("北京", 3)
```

该服务没有认证配置，也没有交易、写入或账户权限。
