# dsh-client-ui-watchlist
[English](README.md) | 中文

Web 会话头部的自选股看盘工具：紧凑报价条 + 管理弹层。自选股在浏览器本地持久化
（localStorage，`dsh.watchlist.v1`）；行情通过可选 host 能力 `watchlistHost`
获取，仅在部署配置了行情数据源时可用。未配置时仍可完整管理自选股（按 6 位 A 股
代码添加，名称回退为代码），不伪造价格。

设计见 `docs/superpowers/specs/2026-08-19-watchlist-plugin-design.md`
（Host Remote + 行情适配器为待完成的 host 侧后续工作）。
