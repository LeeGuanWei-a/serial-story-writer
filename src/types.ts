import type { Branded } from '@deepseek-ai/dsh-brand'
import { HarnessError } from '@deepseek-ai/dsh-llm'

/** Stable identity stored in one serial-story world manifest. */
export type WorldId = Branded<'WorldId'>

/** SHA-256 revision of normalized file bytes, or the explicit missing value. */
export type Revision = Branded<'Revision'> | 'absent'

/** Project-level writing policy. It does not configure provider reasoning. */
export type CreativeStrategy = 'auto' | 'fluent-drafting' | 'consistency-first' | 'deep-planning'

/** One world-scoped character; collections reference these by id. */
export interface CharacterRecord {
  readonly id: string
  readonly name: string
  readonly role: string
  readonly summary: string
  readonly goal: string
  readonly voice: string
  readonly background: string
}

/** One glossary entry in the shared setting. */
export interface GlossaryEntry {
  readonly term: string
  readonly definition: string
}

/**
 * One story thread declared by a collection.
 *
 * 「线」与「集」同寿:一个短篇集是独立作品,它的线不与其它集共享 —— 跨集的连续性
 * 由**人物**承担(稳定 id 引用),不由线承担。
 */
export interface StoryThread {
  readonly id: string
  readonly title: string
  readonly summary: string
}

/** One short-story collection's blueprint. */
export interface CollectionBlueprint {
  readonly slug: string
  readonly title: string
  readonly theme: string
  readonly summary: string
  readonly characterIds: readonly string[]
  readonly targetWords: number
  readonly status: 'planned' | 'in-progress' | 'finished'
  /** 该集声明的故事线;缺省为空。 */
  readonly threads: readonly StoryThread[]
}

/** One story thread beside the chapters that advance it. */
export interface SerialThreadResult extends StoryThread {
  readonly collectionSlug: string
  /** 推进过这条线的章节号(升序、去重)。 */
  readonly advances: readonly number[]
}

/** A read-only projection that records which characters appear where. */
export interface CharacterAppearance {
  readonly characterId: string
  readonly collectionSlug: string
  readonly chapter: number
}

/** Discriminated asset reference for one project-owned file. */
export type AssetRef =
  | { readonly kind: 'project' }
  | { readonly kind: 'characters' }  | { readonly kind: 'world' }
  | { readonly kind: 'collection-blueprint'; readonly slug: string }
  | { readonly kind: 'collection-timeline'; readonly slug: string }
  | { readonly kind: 'chapter-blueprint'; readonly slug: string; readonly chapter: number }
  | { readonly kind: 'chapter-draft'; readonly slug: string; readonly chapter: number }

/** Every bounded read accepted by a Serial Project. */
export type SerialReadRequest =
  | { readonly kind: 'asset'; readonly target: AssetRef }
  | { readonly kind: 'world'; readonly slug?: string }
  | { readonly kind: 'appearances'; readonly characterId: string }
  | { readonly kind: 'threads'; readonly slug?: string }
  | { readonly kind: 'audit' }
  | { readonly kind: 'chronicle'; readonly characterId: string }
  | { readonly kind: 'export'; readonly slug: string }

/** Initialization data for a brand-new world. */
export interface SerialInitializeRequest {
  readonly kind: 'initialize'
  readonly worldId: WorldId
  readonly worldName: string
  readonly language: string
  readonly tone: string
  readonly creativeStrategy: CreativeStrategy
  readonly createdAt: string
  readonly updatedAt: string
}

/** Replace one asset with the same revision-checked compare-and-replace rule. */
export interface SerialReplaceRequest {
  readonly kind: 'replace'
  readonly target: AssetRef
  readonly baseRevision: Revision
  readonly replacement: string
  readonly summary: string
}

/** Every mutation accepted by a Serial Project. */
export type SerialApplyRequest = SerialInitializeRequest | SerialReplaceRequest

/** One exact asset read. */
export interface SerialAssetReadResult {
  readonly kind: 'asset'
  readonly target: AssetRef
  readonly source: string
  readonly revision: Revision
  readonly text: string
  readonly bytes: number
  readonly truncated: boolean
  readonly omitted: boolean
}

/** A bounded world projection: world.json + characters.json + collection list. */
export interface SerialWorldResult {
  readonly kind: 'world'
  readonly characters: readonly CharacterRecord[]
  readonly collections: readonly CollectionBlueprint[]
  readonly truncated: boolean
}

/** Bounded appearance projection for one character. */
export interface SerialAppearancesResult {
  readonly kind: 'appearances'
  readonly characterId: string
  readonly appearances: readonly CharacterAppearance[]
  readonly truncated: boolean
}

/**
 * 故事线投影:每条线声明出自哪个集,以及哪些章节推进过它。
 *
 * `advances` 只来自**章节蓝图**的 `threadIds` —— 与 `appearances` 同理,正文不参与。
 * 引用到未声明线的 `threadIds` 会被忽略(见 §6.10),因此这里不会出现孤儿线。
 */
export interface SerialThreadsResult {
  readonly kind: 'threads'
  readonly threads: readonly SerialThreadResult[]
  readonly truncated: boolean
}

/** 巡检发现的一条问题。 */
export interface SerialAuditFinding {
  /** `error` 表示引用不成立;`warning` 表示结构缺口。 */
  readonly severity: 'error' | 'warning'
  /** 稳定码,便于程序判断;文案可变。 */
  readonly code: string
  /** 问题所在位置的短标识,如 `cheer-color#2`。 */
  readonly where: string
  /** 一句人话。 */
  readonly detail: string
}

/**
 * 跨集巡检:把"规模一大就看不见的结构问题"一次报出来。
 *
 * 它只读、只报告,从不改任何东西。存在的理由是 §6.8 与 §6.10 那两条:出场与故事线
 * 推进**只**认蓝图,所以"有正文没蓝图""引用了不存在的人物/线"这类问题不会自己
 * 冒出来 —— 只有主动巡检才看得见。
 */
export interface SerialAuditResult {
  readonly kind: 'audit'
  readonly findings: readonly SerialAuditFinding[]
  /** 巡视了多少集 / 多少章,便于判断"没问题"是真的没问题还是根本没看。 */
  readonly collections: number
  readonly chapters: number
  readonly truncated: boolean
}

/** 编年史里的一站:某人物在某一集的登场。 */
export interface SerialChronicleStop {
  readonly collectionSlug: string
  readonly title: string
  readonly season: string
  readonly startDate: string
  readonly endDate: string
  /** 章级登场(来自章节蓝图);整集登场但无章级记录时为空。 */
  readonly chapters: readonly number[]
  /** 是否在这些章里担任视角人物。 */
  readonly pov: boolean
  /** 该集蓝图是否整体声明了这个人物。 */
  readonly wholeCollection: boolean
}

/**
 * 跨集人物编年史。
 *
 * **不发明顺序**:有时间锚(该集时间线的 `startDate`)的集按时间升序排进
 * `ordered`;没有锚的集单独放进 `undated`,绝不按 slug 硬塞进时间线 ——
 * "短篇集之间没有隐含顺序"这条不变量不能被一个投影偷偷推翻。
 *
 * 这里也**不发明状态**:没有任何 schema 字段记录"人物在这一集变成什么样",所以
 * 编年史只报告"在哪一集、哪些章、以什么身份出现",不编造人物状态。
 */
export interface SerialChronicleResult {
  readonly kind: 'chronicle'
  readonly characterId: string
  readonly ordered: readonly SerialChronicleStop[]
  readonly undated: readonly SerialChronicleStop[]
  readonly truncated: boolean
}

/**
 * 整集导出。
 *
 * 装配与面板的导出按钮**共用同一个纯函数**(`src/serial-export.ts`),所以模型读到的
 * 整集与人下载到的整集必然一致。像其它读取一样受 `assetBytes` 限制,并如实标记截断。
 */
export interface SerialExportResult {
  readonly kind: 'export'
  readonly slug: string
  /** 装配好的完整 Markdown。 */
  readonly text: string
  /** 截断前的字节数。 */
  readonly bytes: number
  /** 装配进去的章数(含没有正文的章)。 */
  readonly chapters: number
  readonly truncated: boolean
}

/** Canonical read result. */
export type SerialReadResult =
  | SerialAssetReadResult
  | SerialWorldResult
  | SerialAppearancesResult
  | SerialThreadsResult
  | SerialAuditResult
  | SerialChronicleResult
  | SerialExportResult

/** Evidence that one asset replacement committed. */
export interface CommitReceipt {
  readonly worldId: WorldId
  readonly target: AssetRef
  readonly oldRevision: Revision
  readonly newRevision: Revision
  readonly bytes: number
}

/** Closed proposal command set. */
export type SerialProposalCommand =
  | { readonly kind: 'initialize'; readonly nextValue: SerialInitializeRequest }
  | { readonly kind: 'replaceAsset'; readonly target: AssetRef; readonly baseRevision: Revision; readonly nextValue: string; readonly summary: string }
  | { readonly kind: 'newCollection'; readonly blueprint: CollectionBlueprint; readonly timeline: TimelineRecord; readonly summary: string }
  | { readonly kind: 'deleteCollection'; readonly slug: string; readonly summary: string }
  | { readonly kind: 'markCollectionFinished'; readonly slug: string; readonly summary: string }

/** One proposed mutation, paired with its Host-supplied identity. */
export interface SerialProposalChange {
  readonly changeSetId: string
  readonly command: SerialProposalCommand
}

/** A collection timeline record. */
export interface TimelineRecord {
  readonly season: string
  readonly startDate: string
  readonly endDate: string
  readonly keyDates: readonly string[]
}

/**
 * Stable domain failure codes for serial-project operations.
 *
 * 这里只列**项目层真的会抛**的码。曾经的 `UNSUPPORTED_FORMAT` / `ASSET_NOT_FOUND` /
 * `APPROVAL_REJECTED` / `CANCELLED` 已删除,理由分别是:
 *
 * - 缺失的资产不是错误:非清单资产缺失返回 `revision: 'absent'` 的空资产,清单缺失
 *   返回 `NOT_INITIALIZED` —— 因此不需要 `ASSET_NOT_FOUND`;
 * - 格式版本尚无第二种,`UNSUPPORTED_FORMAT` 无抛出点;
 * - 原生审批被拒发生在项目层之外,由 Harness 自己处理(见 §6.4);
 * - **取消不在这里表示**。项目层在每步文件系统工作前后调用 `signal.throwIfAborted()`,
 *   抛的是 Harness 原生 `AbortError`,与 `TOOL_ABORTED` 那套终止语义同源;自行发明一个
 *   `CANCELLED` 只会让调用方多一个需要判别的分支。取消的契约由
 *   `tests/serial-project.spec.ts` 的「取消」用例钉住。
 *
 * (loopback 信封另有一套小写码,其中 `'cancelled'` 属于信封自己,与本类型无关。)
 */
export type SerialProjectErrorCode =
  | 'NOT_INITIALIZED'
  | 'ALREADY_INITIALIZED'
  | 'INVALID_CONTENT'
  | 'PATH_REJECTED'
  | 'SIZE_LIMIT_EXCEEDED'
  | 'STALE_REVISION'
  | 'WRITE_FAILED'
  | 'NOT_IMPLEMENTED'

/** Error carrying a stable machine-readable serial-project code. */
export class SerialProjectError extends HarnessError {
  declare readonly code: SerialProjectErrorCode

  constructor(code: SerialProjectErrorCode, message: string, options?: ErrorOptions) {
    super(message, code, options)
  }
}