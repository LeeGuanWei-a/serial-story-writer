/**
 * Host 入口与公共领域导出。
 *
 * ## 这个入口刻意很薄
 *
 * 它**不挂模型面工具**:工具由专用预设把 `./agent`(或 `./agent-v2`)挂进自己的作用域,
 * 因此宿主的工具目录里永远看不到 `serial_*`。这里只做两件事:声明依赖、确认宿主
 * 服务到位。
 *
 * ## 为什么没有 loopback 通道
 *
 * `dsh 0.2.0-rc.2` 有个上游缺陷:第三方插件注册 HTTP 通道时,`connection.rpc.handle`
 * 与 `webServer.register` 会走到同一段嵌套 inject(`dsh-client-connection` 自己的 inject
 * 是 `["credentials"]` 而非 `["webServer"]`),激活时报 `cannot get property "webServer"
 * without inject`。
 *
 * 早期版本为此准备了一套 loopback 读端点作为"等上游修复"的储备。**该储备已删除**:
 * 浏览器侧的只读工作台改走 dsh 原生的 Typert Remote(`workspaceFiles`),那条路是通的,
 * 而且只读、以会话工作区为根。既然那条路不再需要,留一份永不挂载的处理器只是死代码。
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { SerialProjectError } from './types.js'

export { SerialProjectError }
export type {
  AssetRef,
  CharacterAppearance,
  CharacterRecord,
  CollectionBlueprint,
  CommitReceipt,
  CreativeStrategy,
  GlossaryEntry,
  SerialApplyRequest,
  SerialAssetReadResult,
  SerialAppearancesResult,
  SerialAuditFinding,
  SerialAuditResult,
  SerialChronicleResult,
  SerialChronicleStop,
  SerialInitializeRequest,
  SerialProjectErrorCode,
  SerialProposalChange,
  SerialProposalCommand,
  SerialReadRequest,
  SerialReadResult,
  SerialReplaceRequest,
  SerialThreadResult,
  SerialThreadsResult,
  SerialWorldResult,
  StoryThread,
  TimelineRecord,
  Revision,
  WorldId,
} from './types.ts'

/** Cordis 诊断用的稳定插件名。 */
export const name = 'dsh-serial-story'

/** 必需的宿主服务。 */
export const inject = ['workspaceRegistry']

/** Host 配置。 */
export interface Config {
  /** 预留给将来的配置项;当前为空。 */
  readonly _placeholder?: never
}

/** Host 配置 schema。 */
export const Config: z<Config> = z.object({})

/**
 * 占住宿主 fiber 并确认必需服务。
 *
 * @param ctx 含 Workspace registry 的宿主上下文。
 * @param _config 已解析的 Host 配置(当前为空)。
 */
export function apply(ctx: Context, _config: Config): void {
  // 触碰 registry,使这个 fiber 不被判为 unused。
  ctx.get('workspaceRegistry')
  ctx.logger.info('dsh-serial-story: Host entry activated')
}
