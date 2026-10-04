/** Agent-scoped serial-story tools and their native approval policy. */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { Workspace } from '@deepseek-ai/dsh-workspace'
import { defineTool, ToolArgsError } from '@deepseek-ai/dsh-tools'
import type { PreToolDecision, ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-session'
import z from '@deepseek-ai/schemastery'
import { SerialProjectError, type AssetRef, type CreativeStrategy, type SerialApplyRequest, type SerialReadRequest, type WorldId, type Revision } from './types.js'
import {
  canonicalSerialAssetText,
  canonicalSerialInitialization,
  openSerialProject,
  serialAssetSource,
} from './serial-project.js'
import type { SerialProject, SerialProjectOptions } from './serial-project.js'
import {
  assertProposalProjectState,
  normalizeProposalCommand,
  openSerialInbox,
  proposalSummary,
  type SerialProposalInboxOptions,
} from './proposal-inbox.js'

const DEFAULT_ASSET_BYTES = 512 * 1024
const DEFAULT_WORKING_SET_BYTES = 512 * 1024
const DEFAULT_QUERY_MATCHES = 20
const DEFAULT_MAX_PROPOSAL_BYTES = 2 * 1024 * 1024
const DEFAULT_MAX_PENDING_PROPOSALS = 20
const SERIAL_PRESET_ID = 'short-story-writer'
const SERIAL_V1_TOOL_NAMES: ReadonlySet<string> = new Set(['serial_read', 'serial_apply_change'])
const SERIAL_V2_TOOL_NAMES: ReadonlySet<string> = new Set(['serial_read', 'serial_propose_change'])

/** 本插件用到的 preset 注册表切片(dsh 的 `agentPresets` 服务)。 */
interface DedicatedPresetRegistry {
  /** 该 Agent 上下文所组合的 preset id;未组合任何 preset 时为 undefined。 */
  composedPreset(ctx: Context): string | undefined
}

// 本插件依赖的 preset 选中事件。这里自行声明而**不**导入预设注册表包的类型:
// 0.2.0-rc.2 的 dsh 子包不在 npm 上,工作区里它的 `@deepseek-ai/cordis` 与
// Schemastery 解析到嵌套实例,导入其类型既拿不到增强,又会破坏本文件的
// `z<Config>` 注解。
declare module '@deepseek-ai/cordis' {
  interface Events {
    /** 一个会话把不同的 preset 写进了它的持久日志。 */
    'agent-preset/selected'(sessionId: SessionId, agentPreset: string): void
  }
}

const DEDICATED_SURFACE_INSTALLATION = Symbol.for('@leeguanwei/dsh-serial-story/dedicated-surface-installation')
type DedicatedSurfaceInstallation = { readonly presetId: string; readonly dispose: () => void }

function dedicatedSurfaceInstallationFor(agent: Agent): DedicatedSurfaceInstallation | undefined {
  return Reflect.get(agent, DEDICATED_SURFACE_INSTALLATION) as DedicatedSurfaceInstallation | undefined
}

function setDedicatedSurfaceInstallation(agent: Agent, installation: DedicatedSurfaceInstallation): void {
  Reflect.set(agent, DEDICATED_SURFACE_INSTALLATION, installation)
}

function clearDedicatedSurfaceInstallation(agent: Agent, dispose: () => void): void {
  if (dedicatedSurfaceInstallationFor(agent)?.dispose === dispose) {
    Reflect.deleteProperty(agent, DEDICATED_SURFACE_INSTALLATION)
  }
}

/** Deployment bounds for the model-facing serial-story tools. */
export interface Config {
  readonly assetBytes?: number
  readonly workingSetBytes?: number
  readonly queryMatches?: number
  readonly maxProposalBytes?: number
  readonly maxPendingProposals?: number
}

/** Fail-loud validation and defaults for deployment-varying tool bounds. */
export const Config: z<Config> = z.object({
  assetBytes: z.number().step(1).min(1).default(DEFAULT_ASSET_BYTES),
  workingSetBytes: z.number().step(1).min(1).default(DEFAULT_WORKING_SET_BYTES),
  queryMatches: z.number().step(1).min(1).max(20).default(DEFAULT_QUERY_MATCHES),
  maxProposalBytes: z.number().step(1).min(1).default(2 * 1024 * 1024),
  maxPendingProposals: z.number().step(1).min(1).default(20),
})

/** Deployment bounds for the proposal-based agent surface. */
export interface ShortStoryConfig {
  readonly maxProposalBytes?: number
  readonly maxPendingProposals?: number
}

/** Fail-loud validation and defaults for the proposal inbox bounds. */
export const ShortStoryConfig: z<ShortStoryConfig> = z.object({
  maxProposalBytes: z.number().step(1).min(1).default(2 * 1024 * 1024),
  maxPendingProposals: z.number().step(1).min(1).default(20),
})

/** Read-only Workspace resolution face used by the proposal-based serial-story tools. */
export interface ShortStoryWorkspaceRegistry {
  resolveByPath(path: string): Promise<Workspace | undefined>
}

const TARGET_KINDS = [
  'project',
  'characters',
  'world',
  'collection-blueprint',
  'collection-timeline',
  'chapter-blueprint',
  'chapter-draft',
] as const
const CREATIVE_STRATEGIES = ['auto', 'fluent-drafting', 'consistency-first', 'deep-planning'] as const

/**
 * Keep inherited host plugins out of every agent composed from the dedicated short-story preset.
 *
 * The agent entry is a separate bundle, so module-local state is not shared across Loader recompositions.
 * A registry symbol on the live Agent lets the dedicated preset surface persist without becoming
 * a Host service.
 */
function installDedicatedPresetSurface(
  ctx: Context,
  presetId: string,
  toolNames: ReadonlySet<string>,
  displayName: string,
): void {
  ctx.inject(['agentPresets'], (presetCtx) => {
    // `agentPresets` 由 dsh 的 preset 注册表提供。这里刻意只声明本插件用到的
    // 那一小块结构:`@deepseek-ai/dsh-agent-preset-registry` 的类型导入会带来
    // Schemastery 的全局增强,使本文件里的 `z<Config>` 注解失效。
    const presets = presetCtx.get('agentPresets') as DedicatedPresetRegistry | undefined
    if (presets === undefined) return
    const installed = new Map<Agent, () => void>()
    const owns = (agent: Agent | undefined): agent is Agent => agent !== undefined
      && presets.composedPreset(agent.ctx) === presetId
    const install = (agent: Agent): void => {
      if (installed.has(agent)) return
      const prior = dedicatedSurfaceInstallationFor(agent)
      if (prior?.presetId === presetId) return
      prior?.dispose()
      const disposeRestriction = agent.ctx.tools.restrict({ allow: [...toolNames] })
      let disposeOwner = (): void => undefined
      let agentDisposing = false
      const clearInstallation = (): void => {
        clearDedicatedSurfaceInstallation(agent, disposeOwner)
        installed.delete(agent)
      }
      const disposeAgentCleanup = agent.ctx.effect(() => () => {
        clearInstallation()
        agentDisposing = true
        try {
          disposeOwner()
        } finally {
          agentDisposing = false
        }
      }, 'dsh-serial-story.agent-surface-agent-lifecycle')
      disposeOwner = presetCtx.effect(() => () => {
        if (!agentDisposing) disposeAgentCleanup()
        disposeRestriction()
        clearInstallation()
      }, 'dsh-serial-story.agent-surface-isolation')
      installed.set(agent, disposeOwner)
      setDedicatedSurfaceInstallation(agent, { presetId, dispose: disposeOwner })
    }
    presetCtx.on('agent/created', ({ agent }) => {
      if (owns(agent)) install(agent)
    }, { global: true })
    presetCtx.on('agent-preset/selected', (sessionId: SessionId, agentPreset: string) => {
      const agent = presetCtx.agents.get(sessionId)
      if (agentPreset === presetId && agent !== undefined) install(agent)
    }, { global: true })
    presetCtx.on('tools/pre-execute', (exec, next) => {
      if (!owns(exec.agent) || toolNames.has(exec.name)) return next()
      return Promise.resolve({
        kind: 'deny',
        reason: `${displayName} is dedicated to ${[...toolNames].sort().join(' and ')}`,
      })
    }, { prepend: true, global: true })
  })
}

const readParameters = {
  kind: { type: 'string', enum: ['asset', 'world', 'appearances', 'threads', 'audit', 'chronicle', 'export'], required: true },
  targetKind: { type: 'string', enum: TARGET_KINDS },
  slug: {
    type: 'string',
    description: 'Required for kind="export". Optional for kind="world" and kind="threads": narrow the projection to one collection.',
  },
  chapter: { type: 'integer' },
  characterId: {
    type: 'string',
    description: 'Required for kind="appearances" and kind="chronicle".',
  },
} as const

const applyParameters = {
  kind: {
    type: 'string', enum: ['initialize', 'replace'], required: true,
    description: 'Use initialize only after serial_read reports NOT_INITIALIZED. Otherwise use replace.',
  },
  targetKind: {
    type: 'string', enum: TARGET_KINDS,
    description: 'Required only when kind is replace. Forbidden when kind is initialize.',
  },
  slug: {
    type: 'string',
    description: 'Required only when targetKind names a collection-scoped asset. Forbidden otherwise.',
  },
  chapter: {
    type: 'integer',
    description: 'Required only for a replace whose targetKind is chapter-blueprint or chapter-draft.',
  },
  worldId: { type: 'string', description: 'Required only when kind is initialize. Forbidden when kind is replace.' },
  worldName: { type: 'string', description: 'Required only when kind is initialize. Forbidden when kind is replace.' },
  language: { type: 'string', description: 'Required only when kind is initialize. Forbidden when kind is replace.' },
  tone: { type: 'string', description: 'Required only when kind is initialize. Forbidden when kind is replace.' },
  creativeStrategy: {
    type: 'string', enum: CREATIVE_STRATEGIES,
    description: 'Required only when kind is initialize. Forbidden when kind is replace.',
  },
  createdAt: { type: 'string', description: 'Required only when kind is initialize. Forbidden when kind is replace.' },
  updatedAt: { type: 'string', description: 'Required only when kind is initialize. Forbidden when kind is replace.' },
  baseRevision: {
    type: 'string',
    description: 'Required only when kind is replace. Copy the revision from serial_read; use absent for a missing non-manifest asset.',
  },
  replacement: {
    type: 'string',
    description: 'Required only when kind is replace. The complete replacement text for exactly one asset.',
  },
  summary: { type: 'string', description: 'Required only when kind is replace. A concise description for the approval diff.' },
} as const

const v2ReadParameters = {
  kind: { type: 'string', enum: ['state', 'asset', 'inbox'], required: true },
  targetKind: {
    type: 'string', enum: TARGET_KINDS,
    description: 'Required only when kind is asset.',
  },
  slug: { type: 'string', description: 'Required only for a collection-scoped assetKind.' },
  chapter: { type: 'integer', description: 'Required only for chapter-blueprint or chapter-draft.' },
} as const

const v2ProposeParameters = {
  changes: {
    type: 'array',
    required: true,
    description: 'Exactly one closed typed command from the proposal command set; the Host records session, call, and args identity.',
  },
  regenerationTicket: {
    type: 'string',
    description: 'Optional opaque Host ticket returned after a user requests regeneration of one prior proposal item.',
  },
} as const

function invalid(message: string): never {
  throw new ToolArgsError([message])
}

function requiredString(args: Record<string, unknown>, name: string): string {
  const value = args[name]
  return typeof value === 'string' ? value : invalid(`missing required property "${name}"`)
}

function requiredInteger(args: Record<string, unknown>, name: string): number {
  const value = args[name]
  return Number.isInteger(value) ? value as number : invalid(`missing required property "${name}"`)
}

function rejectUnexpected(args: Record<string, unknown>, allowed: readonly string[]): void {
  const unexpected = Object.keys(args).filter(key => !allowed.includes(key))
  if (unexpected.length > 0) invalid(`unexpected propert${unexpected.length === 1 ? 'y' : 'ies'} ${unexpected.map(key => `"${key}"`).join(', ')}`)
}

function targetFrom(args: Record<string, unknown>): AssetRef {
  const targetKind = requiredString(args, 'targetKind')
  if (targetKind === 'chapter-blueprint' || targetKind === 'chapter-draft') {
    return { kind: targetKind, slug: requiredString(args, 'slug'), chapter: requiredInteger(args, 'chapter') }
  }
  if (targetKind === 'collection-blueprint' || targetKind === 'collection-timeline') {
    if (args.chapter !== undefined) invalid('property "chapter" is only valid for chapter assets')
    return { kind: targetKind, slug: requiredString(args, 'slug') }
  }
  if (targetKind === 'project' || targetKind === 'characters' || targetKind === 'world') {
    if (args.slug !== undefined || args.chapter !== undefined) {
      invalid('properties "slug" and "chapter" are only valid for collection-scoped assets')
    }
    return { kind: targetKind }
  }
  invalid('property "targetKind" must name a supported serial-story asset')
}

function parseReadRequest(args: Record<string, unknown>): SerialReadRequest {
  if (args.kind === 'asset') {
    rejectUnexpected(args, ['kind', 'target'])
    if (typeof args.target !== 'object' || args.target === null || Array.isArray(args.target)) {
      invalid('property "target" must be a closed AssetRef object')
    }
    try {
      return { kind: 'asset', target: parseAssetRefInput(args.target) }
    } catch (error) {
      invalid((error as Error).message)
    }
  }
  if (args.kind === 'world') {
    rejectUnexpected(args, ['kind', 'slug'])
    if (args.slug === undefined) return { kind: 'world' }
    return { kind: 'world', slug: requiredString(args, 'slug') }
  }
  if (args.kind === 'appearances') {
    rejectUnexpected(args, ['kind', 'characterId'])
    return { kind: 'appearances', characterId: requiredString(args, 'characterId') }
  }
  if (args.kind === 'threads') {
    rejectUnexpected(args, ['kind', 'slug'])
    if (args.slug === undefined) return { kind: 'threads' }
    return { kind: 'threads', slug: requiredString(args, 'slug') }
  }
  if (args.kind === 'audit') {
    rejectUnexpected(args, ['kind'])
    return { kind: 'audit' }
  }
  if (args.kind === 'chronicle') {
    rejectUnexpected(args, ['kind', 'characterId'])
    return { kind: 'chronicle', characterId: requiredString(args, 'characterId') }
  }
  if (args.kind === 'export') {
    rejectUnexpected(args, ['kind', 'slug'])
    return { kind: 'export', slug: requiredString(args, 'slug') }
  }
  invalid('property "kind" must be "asset", "world", "appearances", "threads", "audit", "chronicle", or "export"')
}

function parseAssetRefInput(value: unknown): AssetRef {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    invalid('Asset reference must be an object')
  }
  const record = value as Record<string, unknown>
  const kind = requiredString(record, 'kind')
  switch (kind) {
    case 'project':
    case 'characters':
    case 'world':
      return { kind }
    case 'collection-blueprint':
    case 'collection-timeline':
      return { kind, slug: requiredString(record, 'slug') }
    case 'chapter-blueprint':
    case 'chapter-draft':
      return {
        kind,
        slug: requiredString(record, 'slug'),
        chapter: requiredInteger(record, 'chapter'),
      }
    default:
      invalid(`Unknown asset kind: ${kind}`)
  }
}

function parseApplyRequest(args: Record<string, unknown>): SerialApplyRequest {
  if (args.kind === 'initialize') {
    rejectUnexpected(args, [
      'kind', 'worldId', 'worldName', 'language', 'tone', 'creativeStrategy', 'createdAt', 'updatedAt',
    ])
    return {
      kind: 'initialize',
      worldId: requiredString(args, 'worldId') as WorldId,
      worldName: requiredString(args, 'worldName'),
      language: requiredString(args, 'language'),
      tone: requiredString(args, 'tone'),
      creativeStrategy: requiredString(args, 'creativeStrategy') as CreativeStrategy,
      createdAt: requiredString(args, 'createdAt'),
      updatedAt: requiredString(args, 'updatedAt'),
    }
  }
  if (args.kind === 'replace') {
    rejectUnexpected(args, [
      'kind', 'targetKind', 'slug', 'chapter', 'baseRevision', 'replacement', 'summary',
    ])
    return {
      kind: 'replace', target: targetFrom(args),
      baseRevision: requiredString(args, 'baseRevision') as Revision,
      replacement: requiredString(args, 'replacement'),
      summary: requiredString(args, 'summary'),
    }
  }
  invalid('property "kind" must be "initialize" or "replace"')
}

function parseProposalArgs(args: Record<string, unknown>): { readonly changes: readonly unknown[]; readonly regenerationTicket?: string } {
  rejectUnexpected(args, ['changes', 'regenerationTicket'])
  const changes = args.changes
  if (!Array.isArray(changes) || changes.length !== 1) {
    invalid('property "changes" must contain exactly one closed typed command')
  }
  const command = changes[0]
  if (typeof command !== 'object' || command === null || Array.isArray(command)) {
    invalid('each command must be a closed object')
  }
  const kind = (command as Record<string, unknown>).kind
  if (typeof kind !== 'string' || !['initialize', 'replaceAsset', 'newCollection', 'deleteCollection', 'markCollectionFinished'].includes(kind)) {
    invalid('command kind must be one of initialize, replaceAsset, newCollection, deleteCollection, markCollectionFinished')
  }
  return args as { readonly changes: readonly unknown[]; readonly regenerationTicket?: string }
}

function workspaceRoot(agent: Agent | undefined): string {
  const cwd = agent?.session.header.cwd
  if (cwd === undefined) throw new Error('Serial story tools require a session with a workspace cwd')
  return cwd
}

/** 把部署配置解析成项目层选项。 */
function resolvedOptions(config: Config): SerialProjectOptions {
  return {
    assetBytes: config.assetBytes ?? DEFAULT_ASSET_BYTES,
    workingSetBytes: config.workingSetBytes ?? DEFAULT_WORKING_SET_BYTES,
    queryMatches: config.queryMatches ?? DEFAULT_QUERY_MATCHES,
  }
}

/** 把部署配置解析成收件箱选项。 */
function resolvedInboxOptions(config: ShortStoryConfig): SerialProposalInboxOptions {
  return {
    maxProposalBytes: config.maxProposalBytes ?? DEFAULT_MAX_PROPOSAL_BYTES,
    maxPendingProposals: config.maxPendingProposals ?? DEFAULT_MAX_PENDING_PROPOSALS,
  }
}

/**
 * 项目清单是否存在。
 *
 * 直接用项目层的读取语义判定:它已经把"未初始化"收敛成稳定的 `NOT_INITIALIZED`,
 * 所以这里不另造一套存在性检查,免得两处判断漂移。
 *
 * @param project 已打开的项目。
 * @param signal 取消信号。
 * @returns 清单在盘上时为 true。
 */
async function readProjectExists(project: SerialProject, signal: AbortSignal): Promise<boolean> {
  try {
    await project.read({ kind: 'asset', target: { kind: 'project' } }, signal)
    return true
  } catch (error) {
    if (error instanceof SerialProjectError && error.code === 'NOT_INITIALIZED') return false
    throw error
  }
}

/** CRLF/CR 归一化为 LF,供审批卡片在规范化失败时兜底展示。 */
function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n?/g, '\n')
}

function commitReceiptMeta(value: JsonValue): JsonValue {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  const newRevision = (value as { newRevision?: unknown }).newRevision
  return typeof newRevision === 'string' && /^[0-9a-f]{64}$/.test(newRevision) ? { newRevision } : {}
}

/**
 * Render one proposed mutation as a deterministic Harness diff card.
 *
 * 卡片展示**规范化后的终态字节**,而不是模型提交的原始文本,因此审批人看到的
 * 就是即将落盘的内容;路径也来自同一个资产映射,不会与实际文件位置漂移。
 */
export function presentSerialChange(request: SerialApplyRequest) {
  if (request.kind === 'initialize') {
    const path = serialAssetSource({ kind: 'project' })
    return {
      card: 'diff' as const, title: `创建短篇集世界:${request.worldName}`,
      diffs: [{ path, oldText: null, newText: canonicalSerialInitialization(request) }],
      locations: [{ path }],
    }
  }
  const path = serialAssetSource(request.target)
  let next: string
  try {
    next = canonicalSerialAssetText(request.target, request.replacement)
  } catch {
    // 校验失败时仍展示原始文本,让审批人看到模型实际提交了什么。
    next = normalizeLineEndings(request.replacement)
  }
  return {
    card: 'diff' as const, title: request.summary,
    diffs: [{ path, oldText: null, newText: next }],
    locations: [{ path }],
  }
}

/** 工具调用参数在审批门处是 `unknown`;只接受普通对象,其余一律按空对象处理。 */
function asArgRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

/**
 * Require native approval for the mutation tool and delegate every other tool decision.
 *
 * 审批前**先把内容跑一遍规范化校验**。这一步很关键:非法内容在 `execute` 里必然
 * 失败,却已经消耗了审批人一次确认,而模型从中学到的只有"又被拒了"。改成直接
 * `deny` 之后,既不弹窗,也让模型立刻拿到含字段清单的精确原因。
 *
 * @param exec 待决的调用;只读取工具名与已解析参数。
 * @param next 后续决策。
 * @returns 非法内容为 `deny`,合法写入为 `ask`,其余工具原样下传。
 */
export function serialApprovalGate(
  exec: Pick<{ name: string; arguments?: unknown }, 'name' | 'arguments'>,
  next: () => Promise<PreToolDecision>,
): Promise<PreToolDecision> {
  if (exec.name !== 'serial_apply_change') return next()
  try {
    const request = parseApplyRequest(asArgRecord(exec.arguments))
    if (request.kind === 'replace') canonicalSerialAssetText(request.target, request.replacement)
    else canonicalSerialInitialization(request)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return Promise.resolve({
      kind: 'deny',
      reason: `这次写入通不过校验,已跳过审批(无需批准):${message}`,
    })
  }
  return Promise.resolve({ kind: 'ask', reason: '批准后仅修改这一个短篇集资产。' })
}

/**
 * Construct the two model-visible serial-story tool definitions.
 */
export function createSerialToolDefinitions(config: Config = {}): readonly [ToolDefinition, ToolDefinition] {
  const options = resolvedOptions(config)
  const read = defineTool({
    name: 'serial_read',
    description: [
      '读取当前短篇集项目的有界、带修订号的投影。参数直接传,不要嵌套或字符串化。',
      'kind="asset" 读一个资产(target 是闭合的 AssetRef 对象);',
      'kind="world" 返回共享人物档案与短篇集蓝图(这是**投影**:它不含 world.json 的正文与修订号);',
      'kind="appearances" 返回某个人物 id 在哪些短篇集/章节出场过;',
      'kind="threads" 返回故事线:每条线出自哪个短篇集,以及哪些章节推进过它;',
      'kind="audit" 跨集巡检,一次报出所有结构问题(缺蓝图/缺时间线/引用了未声明的人物或线/声明了却没人推进的线/建档却没人用的人物);',
      'kind="chronicle" 返回某个人物的跨集编年史:有时间锚的集按时间排序,没有锚的集单独列出 —— 它**不发明顺序,也不发明人物状态**。',
      'kind="export" 把一集装配成一份可直接交付的 Markdown(集名 + 题记 + 每章标题与正文,按章节号升序);没有正文的章保留标题并标出缺失,不会静默丢章。',
      'kind="world" 与 kind="threads" 都可选带 slug,只读那一个短篇集(投影过大时用它收窄)。',
      '出场与故事线的推进都**只来自章节蓝图**,正文不参与 —— 没写章节蓝图就查不到章级信息(用 kind="audit" 找出这些章)。',
      '要写任何资产之前,必须先用 kind="asset" 读它拿到 revision / absent —— 包括 world.json 与 characters.json,不要用 kind="world" 代替。',
      '项目未初始化时各类读取都以 NOT_INITIALIZED 失败,只有这时才应调用 initialize。',
      '缺失的非清单资产返回修订号为 absent 的空资产。',
    ].join(' '),
    parameters: readParameters,
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const request = parseReadRequest(args)
      return await openSerialProject(workspaceRoot(exec.agent), options).read(request, exec.signal) as unknown as JsonValue
    },
    presentCall: args => {
      const request = parseReadRequest(args)
      const title = request.kind === 'appearances'
        ? '查询人物出场'
        : request.kind === 'threads'
          ? '查询故事线'
          : request.kind === 'audit'
            ? '跨集巡检'
            : request.kind === 'chronicle'
              ? '查询人物编年史'
              : request.kind === 'export'
                ? '导出整集'
                : request.kind === 'world' ? '读取短篇集世界' : '读取短篇集资产'
      const search = request.kind === 'appearances' || request.kind === 'threads' || request.kind === 'chronicle'
      return {
        card: 'generic',
        title,
        kind: search || request.kind === 'audit' ? 'search' : 'read',
        rawInput: request,
      }
    },
  })
  const applyDefinition = defineTool({
    name: 'serial_apply_change',
    description: [
      '在原生审批后提交一次带回修订号的短篇集资产变更。参数直接传,不要嵌套或字符串化。',
      '只有 serial_read 报告 NOT_INITIALIZED 时才用 kind="initialize"(字段:worldId/worldName/language/tone/creativeStrategy/createdAt/updatedAt);',
      '项目已存在时一律用 kind="replace"(字段:targetKind、集合资产还需 slug、章节资产还需 chapter、baseRevision、replacement、summary)。',
      'replacement 是**完整**的下一版资产文本。JSON 资产必须**恰好**只含下列顶层字段——多一个字段会被拒,少一个必填字段也会被拒(标 ◇ 的除外,它们可省且有默认值):',
      'project = {worldId, worldName, language, tone, creativeStrategy, createdAt, updatedAt, ◇writingRules}(writingRules 是"我怎么写"的创作方针字符串数组,如现实向、单一限知视角;worldId **不可更改**,改它会被拒);',
      'characters = {items:[{id, name, role, summary, goal, voice, background}]}(人物档案;顶层键是 items;id 不得重复,形态 ^[a-z0-9][a-z0-9_-]{0,62}$);',
      'world = {setting, locations, notes, ◇era, ◇organizations, ◇rules, ◇glossary}(共享设定;locations/organizations/rules 是字符串数组;glossary 是 [{term, definition}] 术语表;era 是一句话时代背景。"世界如何运转"放 rules,"我怎么写"放 project.writingRules,不要混);',
      'collection-blueprint = {title, theme, summary, characterIds, targetWords, status, ◇threads}(threads 是 [{id, title, summary}] 故事线声明,id 形态同人物 id 且不得重复;characterIds 是人物 id 字符串数组;status 只能是 planned/in-progress/finished;文件里**不含** slug,读取时由目录名注入);',
      'collection-timeline = {season, startDate, endDate, keyDates}(keyDates 是字符串数组);',
      'chapter-blueprint = {chapter, title, keyBeats, characterIds, povCharacterId, notes, ◇threadIds}(threadIds 是本章推进的故事线 id 数组,必须先在 collection-blueprint.threads 里声明过;title/keyBeats/characterIds/povCharacterId 必填;chapter 可省,默认取目标章节,若给出必须一致;notes 可省,默认空串;keyBeats 是字符串数组);',
      'chapter-draft 是**纯 Markdown 正文**,不是 JSON——唯一一个不用 JSON 的资产。',
      '先写章节蓝图再写正文:出场与故事线推进都只从蓝图取,正文不参与。',
      'baseRevision 必须逐字复制最近一次 serial_read 返回的修订号;缺失的非清单资产用字符串 absent。',
      '内容非法时审批不会弹出:调用会以 deny 直接返回失败原因,照着原因改即可。',
      '不要混用两个分支的字段。执行前必须获得原生用户审批。',
    ].join(' '),
    parameters: applyParameters,
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
      presentationMeta: (_args, value) => commitReceiptMeta(value),
    },
    async execute(args, exec) {
      const request = parseApplyRequest(args)
      return await openSerialProject(workspaceRoot(exec.agent), options).apply(request, exec.signal) as unknown as JsonValue
    },
    presentCall: args => presentSerialChange(parseApplyRequest(args)),
    presentResult: (args, result) => result.isError
      ? { card: 'generic', content: result.content }
      : presentSerialChange(parseApplyRequest(args)),
  })
  return [read, applyDefinition]
}

/**
 * Construct the model-visible proposal-based serial-story tools.
 *
 * `serial_read` 已接到真实项目层,因此预设至少提供一个可用的读取面;
 * `serial_propose_change` 仍以显式的 NOT_IMPLEMENTED 失败 —— 非权威提案收件箱
 * 尚未落地,绝不能让模型误以为建议已被受理。
 */
export function createSerialV2ToolDefinitions(
  config: ShortStoryConfig,
  workspaces: ShortStoryWorkspaceRegistry,
): readonly [ToolDefinition, ToolDefinition] {
  const options = resolvedOptions(config)
  const resolveRoot = async (agent: Agent | undefined): Promise<string> => {
    const workspace = await workspaces.resolveByPath(workspaceRoot(agent))
    if (workspace === undefined) throw new Error('短篇集作家要求一个已注册的 Workspace')
    return workspace.path
  }
  const read = defineTool({
    name: 'serial_read',
    description: [
      '读取当前短篇集项目的有界、带修订号的投影。参数直接传,不要嵌套或字符串化。',
      'kind="state" 返回共享人物档案与全部短篇集蓝图;',
      'kind="asset" 读一个资产,用 targetKind 指定资产类型,集合资产还需 slug,章节资产还需 chapter。',
      'kind="inbox" 列出待审阅的**非权威**提案(它们是建议,不是已落盘的改动)。',
      '项目未初始化时以 NOT_INITIALIZED 失败。',
    ].join(' '),
    parameters: v2ReadParameters,
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const input = args as Record<string, unknown>
      const root = await resolveRoot(exec.agent)
      const project = openSerialProject(root, options)
      if (input.kind === 'state') {
        rejectUnexpected(input, ['kind'])
        return await project.read({ kind: 'world' }, exec.signal) as unknown as JsonValue
      }
      if (input.kind === 'asset') {
        rejectUnexpected(input, ['kind', 'targetKind', 'slug', 'chapter'])
        return await project.read({ kind: 'asset', target: targetFrom(input) }, exec.signal) as unknown as JsonValue
      }
      if (input.kind === 'inbox') {
        rejectUnexpected(input, ['kind'])
        const records = await openSerialInbox(root, resolvedInboxOptions(config)).list(exec.signal)
        // 只回模型需要用来判断"我是不是已经提过这条"的字段;身份是 Host 侧账目。
        return {
          kind: 'inbox',
          proposals: records.map(record => ({
            proposalId: record.proposalId,
            createdAt: record.createdAt,
            status: record.status,
            argumentHash: record.argumentHash,
            summary: record.summary,
            command: record.command,
          })),
        } as unknown as JsonValue
      }
      invalid('serial_read property "kind" must be "state", "asset", or "inbox"')
    },
    presentCall: () => ({ card: 'generic', title: '读取短篇集世界', kind: 'read', rawInput: { kind: 'state' } }),
  })
  const propose = defineTool({
    name: 'serial_propose_change',
    description: [
      '把**一条**修改建议记录进项目的非权威收件箱,等人审阅。它**不改变项目**。',
      'changes 必须恰好一条闭合命令:initialize / replaceAsset / newCollection / deleteCollection / markCollectionFinished。',
      '命令内容会走与真实写入完全相同的校验;不合格的建议在记录时就被拒。',
      '收据里 authoritative=false、status="pending" —— 绝不要把它说成已经改好了。',
      '同一个规范化命令重复提交不会产生第二条,只会返回既有收据;所以不要反复重提。',
      '要真的改项目,请让用户改用需要原生审批的写入路径。',
    ].join(' '),
    parameters: v2ProposeParameters,
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
      presentationMeta: (_args, value) => commitReceiptMeta(value),
    },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const parsed = parseProposalArgs(args as Record<string, unknown>)
      const root = await resolveRoot(exec.agent)
      const command = normalizeProposalCommand(parsed.changes[0])
      const project = openSerialProject(root, options)
      assertProposalProjectState(command, await readProjectExists(project, exec.signal))
      const receipt = await openSerialInbox(root, resolvedInboxOptions(config)).propose(
        command,
        proposalSummary(command),
        {
          // 身份由 Host 供给:模型既不能提供也不能猜。
          sessionId: String(exec.agent?.id ?? 'unknown-session'),
          callId: String(exec.callId),
        },
        exec.signal,
      )
      return receipt as unknown as JsonValue
    },
    presentCall: args => ({
      card: 'generic',
      title: '提交短篇集修改建议(非权威)',
      kind: 'read',
      rawInput: parseProposalArgsSafe(args as Record<string, unknown>),
    }),
  })
  return [read, propose]
}

/** Best-effort projection for the presentCall card; never throws on invalid shape. */
function parseProposalArgsSafe(args: Record<string, unknown>): { readonly changes: readonly unknown[]; readonly regenerationTicket?: string } {
  try {
    return parseProposalArgs(args)
  } catch {
    return { changes: [] }
  }
}

/** Stable Cordis plugin name. */
export const name = 'dsh-serial-story-agent'

/** Required host services for agent lookup, scoped tools, prompt projection, and policy. */
export const inject = ['agents', 'systemPrompt', 'tools']

/**
 * Register the two domain tools and their mandatory one-shot approval policy.
 *
 * The dedicated preset surface is installed here too so the V1 entry stays
 * usable when the bundle is mounted directly without the preset realm; the
 * narrow `allow` set is the only tool catalog the preset inherits from its
 * host environment.
 */
export function apply(ctx: Context, config: Config = {}): void {
  for (const definition of createSerialToolDefinitions(config)) ctx.tools.register(definition)
  ctx.on('tools/pre-execute', (exec, next) => serialApprovalGate(exec, next))
  installDedicatedPresetSurface(ctx, SERIAL_PRESET_ID, SERIAL_V1_TOOL_NAMES, '短篇集作家')
}

/** Register the proposal-based surface after the dedicated entry injects the Workspace registry. */
export function applyV2(ctx: Context, config: ShortStoryConfig = {}): void {
  const workspaces = ctx.get('workspaceRegistry') as ShortStoryWorkspaceRegistry | undefined
  if (workspaces === undefined) throw new Error('短篇集作家 requires the Workspace registry')
  for (const definition of createSerialV2ToolDefinitions(config, workspaces)) ctx.tools.register(definition)
  installDedicatedPresetSurface(ctx, SERIAL_PRESET_ID, SERIAL_V2_TOOL_NAMES, '短篇集作家')
}