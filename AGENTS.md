# 短篇集作家 DSH 插件 Agent 规则

## 灵感来源

本插件沿用 `@ethanyoq/dsh-ai-novel-writer` 0.1.0 的 Host / Preset / Client 三层结构。**不** 复用其源代码；只借鉴其公开包形态、SHA-256 资产修订号、提案式创作流与侧栏抽屉 UX。「世界观 → 多短篇集、人物档案跨集共享」是本插件相对 novel-writer 的新增产品领域，必须保持独立。

## 各入口职责
- 根 Host 入口：解析 `.serial/` workspace，存储工厂，preset installer 的宿主胶水。**不挂模型面工具**。
- `./agent`：V1 兼容入口，暴露 `serial_read` 与 `serial_apply_change`，使用 Harness 原生 one-shot approval。
- `./agent-v2`：提案入口，暴露 `serial_read` 与 `serial_propose_change`，**只** 由 bundled Preset 挂入。
- `./client`：在 Plugin Configuration 卡片与侧栏抽屉注册客户端。

## 硬约束
- 任何 Preset 都不挂 shell、通用文件读写工具、文本替换工具或 Code Mode。
- 插件 UI 不引入 `@deepseek-ai/dsh-client-ui-primitives`；只能使用 Client runtime 暴露的主题 token。
- 浏览器只发送不透明的 `WorkspaceId` + 严格类型的请求体；不携带本地文件系统路径、不调用直接的项目写入端点。
- 提案工具记录 Host 提供的 session 与 call 身份；模型不应也无法提供这些字段。

## 子智能体模型路由

为本插件生成子智能体时，优先使用原生 `gpt-5.6-terra` 模型与 `xhigh` 推理强度。