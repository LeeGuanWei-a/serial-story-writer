/**
 * 短篇集项目的文件层。
 *
 * 一个项目就是工作区下的 `.serial/` 目录:世界观清单、共享人物档案、共享设定,
 * 以及若干互相独立的短篇集(每个短篇集有自己的蓝图、时间线与章节)。
 *
 * 三条不变量:
 * 1. **修订号即并发**。每个非空资产的修订号是规范化 UTF-8 字节的 SHA-256;
 *    替换请求只带"上次读到的修订号",模型永远不需要复述旧文本。
 * 2. **写入是单文件原子替换**。借助 `dsh-atomic-write` 的 rename 提交,
 *    读者只会看到替换前或替换后的完整内容。
 * 3. **落盘的是规范化字节**。JSON 资产经严格校验后按 2 空格缩进 + LF 重新序列化,
 *    正文按 LF 归一化,因此格式抖动不会产生假修订。
 */

import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import {
  SerialProjectError,
  type AssetRef,
  type CharacterAppearance,
  type CharacterRecord,
  type CollectionBlueprint,
  type CommitReceipt,
  type CreativeStrategy,
  type GlossaryEntry,
  type Revision,
  type SerialApplyRequest,
  type SerialAssetReadResult,
  type SerialAppearancesResult,
  type SerialAuditResult,
  type SerialChronicleResult,
  type SerialChronicleStop,
  type SerialExportResult,
  type SerialInitializeRequest,
  type SerialReadRequest,
  type SerialReadResult,
  type SerialReplaceRequest,
  type SerialThreadResult,
  type SerialThreadsResult,
  type SerialWorldResult,
  type StoryThread,
  type TimelineRecord,
  type WorldId,
} from './types.js'
import {
  CHAPTER_BLUEPRINT_SUFFIX,
  CHAPTER_DRAFT_SUFFIX,
  COLLECTIONS_DIR,
  SERIAL_DIR,
  chapterNumberOf,
  chapterSegment,
  chaptersDir,
  serialAssetPath,
} from './serial-layout.js'
import { auditWorld } from './serial-audit.js'
import { assembleCollectionMarkdown, type ExportChapterInput } from './serial-export.js'

/**
 * 校验短篇集 slug 并返回它。
 *
 * 导出给提案收件箱复用**同一套**约束:提案里带的 slug 与直接写入时走的是同一个
 * 形态检查,因此收件箱不可能存下一条将来落盘会被拒的路径。
 *
 * @param slug 待校验的 slug。
 * @returns 原样返回的 slug。
 */
export function assertSerialSlug(slug: string): string {
  return requireSlug(slug)
}

/** 落盘文件权限位。 */
const FILE_MODE = 0o644

/** 稳定 ID 与 slug 的严格形态,同时用于阻断路径穿越。 */
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/

/** 人物稳定 ID 的形态。 */
const CHARACTER_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,62}$/

/** 故事线稳定 ID 的形态(与人物 id 同一套约束)。 */
const THREAD_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,62}$/

const CREATIVE_STRATEGIES: readonly CreativeStrategy[] = [
  'auto', 'fluent-drafting', 'consistency-first', 'deep-planning',
]

const COLLECTION_STATUSES = ['planned', 'in-progress', 'finished'] as const

/** 部署相关的读取上限。 */
export interface SerialProjectOptions {
  /** 单个资产读取/写入的字节上限。 */
  readonly assetBytes: number
  /** 世界投影的字节上限。 */
  readonly workingSetBytes: number
  /** 出场投影的最大条目数。 */
  readonly queryMatches: number
}

/** 一个已打开的项目。 */
export interface SerialProject {
  /**
   * 读取一个有界的项目投影。
   *
   * @param request 资产、世界投影或出场投影。
   * @param signal 取消信号,在文件系统工作前后检查。
   * @returns 规范化文本、修订号与省略元数据。
   */
  read(request: SerialReadRequest, signal: AbortSignal): Promise<SerialReadResult>
  /**
   * 原子地初始化项目或比较并替换一个资产。
   *
   * @param request 初始化数据,或一次单资产、带回修订号的替换。
   * @param signal 取消信号,在原子替换开始前生效。
   * @returns 含项目身份与提交前后修订号的收据。
   */
  apply(request: SerialApplyRequest, signal: AbortSignal): Promise<CommitReceipt>
}

function fail(code: ConstructorParameters<typeof SerialProjectError>[0], message: string): never {
  throw new SerialProjectError(code, message)
}

/** CRLF/CR 归一化为 LF。 */
function normalizeText(text: string): string {
  return text.replace(/\r\n?/g, '\n')
}

/** 规范化 UTF-8 字节的 SHA-256。 */
function revisionOf(text: string): Revision {
  return createHash('sha256').update(normalizeText(text), 'utf8').digest('hex') as Revision
}

function byteLength(text: string): number {
  return Buffer.byteLength(text, 'utf8')
}

/** 校验 slug 并返回它。 */
function requireSlug(slug: string): string {
  if (!SLUG_PATTERN.test(slug)) {
    fail('PATH_REJECTED', `短篇集 slug 必须是 [a-z0-9-] 且以字母或数字开头:收到 ${JSON.stringify(slug)}`)
  }
  return slug
}

/** 校验人物 ID 并返回它。 */
function requireCharacterId(id: string): string {
  if (!CHARACTER_ID_PATTERN.test(id)) {
    fail('INVALID_CONTENT', `人物 id 形态非法:${JSON.stringify(id)}`)
  }
  return id
}

/** 校验故事线 ID 并返回它。 */
function requireThreadId(id: string): string {
  if (!THREAD_ID_PATTERN.test(id)) {
    fail('INVALID_CONTENT', `故事线 id 形态非法:${JSON.stringify(id)}`)
  }
  return id
}

/** 校验术语表。 */
function parseGlossary(value: unknown, where: string): readonly GlossaryEntry[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) fail('INVALID_CONTENT', `${where} 必须是数组`)
  return value.map((entry, index) => {
    const at = `${where}[${index}]`
    const item = requireObject(entry, at)
    rejectUnknownFields(item, ['term', 'definition'], at)
    return {
      term: requireString(item.term, `${at}.term`),
      definition: requireString(item.definition, `${at}.definition`),
    }
  })
}

/** 校验一个短篇集声明的故事线;id 必须唯一。 */
function parseThreads(value: unknown, where: string): readonly StoryThread[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) fail('INVALID_CONTENT', `${where} 必须是数组`)
  const seen = new Set<string>()
  return value.map((entry, index) => {
    const at = `${where}[${index}]`
    const item = requireObject(entry, at)
    rejectUnknownFields(item, ['id', 'title', 'summary'], at)
    const id = requireThreadId(requireString(item.id, `${at}.id`))
    if (seen.has(id)) fail('INVALID_CONTENT', `故事线 id 重复:${id}`)
    seen.add(id)
    return {
      id,
      title: requireString(item.title, `${at}.title`),
      summary: requireString(item.summary, `${at}.summary`),
    }
  })
}

/**
 * 把资产引用映射为项目内的相对 POSIX 路径。
 *
 * 路径本身来自共享的 {@link serialAssetPath};这里补上**调用点的形态校验**并把共享
 * 模块的原生异常翻译成本插件的稳定码 —— slug 越权是 `PATH_REJECTED`,章节号非法是
 * `INVALID_CONTENT`。共享模块刻意不依赖 `SerialProjectError`(见其文件头),所以这层
 * 翻译必须留在 Host 侧。
 */
function relativePathOf(target: AssetRef): string {
  if ('slug' in target) requireSlug(target.slug)
  if ('chapter' in target && (!Number.isSafeInteger(target.chapter) || target.chapter <= 0)) {
    fail('INVALID_CONTENT', `章节号必须是正整数:收到 ${JSON.stringify(target.chapter)}`)
  }
  try {
    return serialAssetPath(target)
  } catch (error) {
    if (error instanceof RangeError) fail('INVALID_CONTENT', error.message)
    throw error
  }
}

/** 该资产是否以 JSON 落盘。 */
function isJsonAsset(target: AssetRef): boolean {
  return target.kind !== 'chapter-draft'
}

/** 人类可读的资产名,用于错误信息。 */
function describe(target: AssetRef): string {
  switch (target.kind) {
    case 'collection-blueprint': return `短篇集 ${target.slug} 蓝图`
    case 'collection-timeline': return `短篇集 ${target.slug} 时间线`
    case 'chapter-blueprint': return `第 ${target.chapter} 章蓝图(${target.slug})`
    case 'chapter-draft': return `第 ${target.chapter} 章正文(${target.slug})`
    default: return target.kind
  }
}

function requireString(value: unknown, where: string): string {
  if (value === undefined) fail('INVALID_CONTENT', `${where} 是必填字段,但缺失了`)
  if (typeof value !== 'string') fail('INVALID_CONTENT', `${where} 必须是字符串,收到 ${typeof value}`)
  return value
}

function requireInteger(value: unknown, where: string): number {
  if (value === undefined) fail('INVALID_CONTENT', `${where} 是必填字段,但缺失了`)
  if (!Number.isSafeInteger(value)) fail('INVALID_CONTENT', `${where} 必须是整数,收到 ${JSON.stringify(value)}`)
  return value as number
}

function requireStringArray(value: unknown, where: string): readonly string[] {
  if (value === undefined) fail('INVALID_CONTENT', `${where} 是必填字段,但缺失了`)
  if (!Array.isArray(value)) fail('INVALID_CONTENT', `${where} 必须是字符串数组,收到 ${typeof value}`)
  for (const item of value) {
    if (typeof item !== 'string') fail('INVALID_CONTENT', `${where} 的每一项都必须是字符串,收到 ${JSON.stringify(item)}`)
  }
  return value as readonly string[]
}

function requireObject(value: unknown, where: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail('INVALID_CONTENT', `${where} 必须是 JSON 对象`)
  }
  return value as Record<string, unknown>
}

/**
 * 可选字符串:缺省为空串。
 *
 * 步 3 扩的字段一律**可选**。这是刻意的:已写好的项目(例如 `F:\Projects\serial-story`)
 * 不带这些字段也必须继续合法,于是扩容**不需要迁移** —— 老文件原样通过校验,只有
 * 下一次写入才会把它们物化成空值。
 */
function optionalString(value: unknown, where: string): string {
  return value === undefined ? '' : requireString(value, where)
}

/** 可选字符串数组:缺省为空数组。理由同 {@link optionalString}。 */
function optionalStringArray(value: unknown, where: string): readonly string[] {
  return value === undefined ? [] : requireStringArray(value, where)
}

/**
 * 解析既有 JSON 字节。
 *
 * 损坏的资产必须以稳定的 `INVALID_CONTENT` 失败:原生 `SyntaxError` 没有可判别的
 * code,模型与调用方都无从恢复。读取与替换两条路径都经过这里。
 */
function parseJsonObject(text: string, where: string): Record<string, unknown> {
  let parsed: unknown
  try {
    parsed = JSON.parse(text) as unknown
  } catch (error) {
    fail('INVALID_CONTENT', `${where} 不是合法 JSON:${(error as Error).message}`)
  }
  return requireObject(parsed, where)
}

/**
 * 拒绝未知字段,让"模型自创字段"在写盘前就失败。
 *
 * 报错必须**同时列出允许的字段名**:模型看不见 schema,只说"含未知字段"会让它
 * 只能接着猜,而每一次猜错在写入路径上都是一次无意义的审批。
 */
function rejectUnknownFields(value: Record<string, unknown>, allowed: readonly string[], where: string): void {
  const unexpected = Object.keys(value).filter(key => !allowed.includes(key))
  if (unexpected.length > 0) {
    fail(
      'INVALID_CONTENT',
      `${where} 含未知字段:${unexpected.join(', ')};该资产只接受这些字段:${allowed.join(', ')}`,
    )
  }
}

/** 规范化 JSON 文本:严格对象 + 2 空格缩进 + LF + 结尾换行。 */
function canonicalJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

/** 校验项目清单。 */
function parseProject(text: string): Record<string, unknown> {
  const raw = parseJsonObject(text, '项目清单')
  rejectUnknownFields(raw, [
    'worldId', 'worldName', 'language', 'tone', 'creativeStrategy', 'createdAt', 'updatedAt',
    'writingRules',
  ], '项目清单')
  const strategy = requireString(raw.creativeStrategy, 'creativeStrategy')
  if (!CREATIVE_STRATEGIES.includes(strategy as CreativeStrategy)) {
    fail('INVALID_CONTENT', `creativeStrategy 非法:${strategy}`)
  }
  return {
    worldId: requireString(raw.worldId, 'worldId'),
    worldName: requireString(raw.worldName, 'worldName'),
    language: requireString(raw.language, 'language'),
    tone: requireString(raw.tone, 'tone'),
    creativeStrategy: strategy,
    createdAt: requireString(raw.createdAt, 'createdAt'),
    updatedAt: requireString(raw.updatedAt, 'updatedAt'),
    // 创作方针(**不是**世界内事实):现实向、单一限知视角、不写金手指之类。
    // 放这里而不是 world.json,是为了把「世界如何运转」与「我怎么写」分开。
    writingRules: optionalStringArray(raw.writingRules, 'writingRules'),
  }
}

/** 校验人物档案集合。 */
function parseCharacters(text: string): { readonly items: readonly CharacterRecord[] } {
  const raw = parseJsonObject(text, '人物档案')
  rejectUnknownFields(raw, ['items'], '人物档案')
  if (!Array.isArray(raw.items)) fail('INVALID_CONTENT', '人物档案 items 必须是数组')
  const seen = new Set<string>()
  const items = raw.items.map((entry, index) => {
    const where = `人物档案 items[${index}]`
    const item = requireObject(entry, where)
    rejectUnknownFields(item, ['id', 'name', 'role', 'summary', 'goal', 'voice', 'background'], where)
    const id = requireCharacterId(requireString(item.id, `${where}.id`))
    if (seen.has(id)) fail('INVALID_CONTENT', `人物 id 重复:${id}`)
    seen.add(id)
    return {
      id,
      name: requireString(item.name, `${where}.name`),
      role: requireString(item.role, `${where}.role`),
      summary: requireString(item.summary, `${where}.summary`),
      goal: requireString(item.goal, `${where}.goal`),
      voice: requireString(item.voice, `${where}.voice`),
      background: requireString(item.background, `${where}.background`),
    }
  })
  return { items }
}

/**
 * 校验共享设定(世界观)。
 *
 * 只有 `setting` / `locations` / `notes` 三个是必填(步 3 之前的原样),其余是
 * 步 3 新增的**可选**字段 —— 所以老项目不需要迁移。它们的用意是把原本只能塞进
 * `notes` 散文里的东西分开:
 *
 * - `era` / `organizations` / `rules`:世界内的事实(时代、机构、世界如何运转);
 * - `glossary`:术语表,给"应援色""直拍"这类自造词一个可查询的位置。
 *
 * 「我怎么写」不属于这里,那是 `project.json` 的 `writingRules`。
 */
function parseWorld(text: string): Record<string, unknown> {
  const raw = parseJsonObject(text, '世界观')
  rejectUnknownFields(raw, [
    'setting', 'locations', 'notes',
    'era', 'organizations', 'rules', 'glossary',
  ], '世界观')
  return {
    setting: requireString(raw.setting, 'setting'),
    locations: requireStringArray(raw.locations, 'locations'),
    notes: requireString(raw.notes, 'notes'),
    era: optionalString(raw.era, 'era'),
    organizations: optionalStringArray(raw.organizations, 'organizations'),
    rules: optionalStringArray(raw.rules, 'rules'),
    glossary: parseGlossary(raw.glossary, 'glossary'),
  }
}

/** 校验短篇集蓝图(身份来自目录 slug,文件中不含 slug)。 */
function parseCollectionBlueprint(text: string, slug: string): Record<string, unknown> {
  const raw = parseJsonObject(text, `短篇集 ${slug} 蓝图`)
  rejectUnknownFields(raw, ['title', 'theme', 'summary', 'characterIds', 'targetWords', 'status', 'threads'], `短篇集 ${slug} 蓝图`)
  const status = requireString(raw.status, 'status')
  if (!(COLLECTION_STATUSES as readonly string[]).includes(status)) {
    fail('INVALID_CONTENT', `短篇集 status 非法:${status}`)
  }
  const characterIds = requireStringArray(raw.characterIds, 'characterIds').map(requireCharacterId)
  if (new Set(characterIds).size !== characterIds.length) {
    fail('INVALID_CONTENT', 'characterIds 必须唯一')
  }
  return {
    title: requireString(raw.title, 'title'),
    theme: requireString(raw.theme, 'theme'),
    summary: requireString(raw.summary, 'summary'),
    characterIds,
    targetWords: requireInteger(raw.targetWords, 'targetWords'),
    status,
    // 该集的故事线;缺省为空,因此步 3 之前的蓝图仍然合法。
    threads: parseThreads(raw.threads, 'threads'),
  }
}

/** 校验短篇集时间线。 */
function parseTimeline(text: string, slug: string): Record<string, unknown> {
  const raw = parseJsonObject(text, `短篇集 ${slug} 时间线`)
  rejectUnknownFields(raw, ['season', 'startDate', 'endDate', 'keyDates'], `短篇集 ${slug} 时间线`)
  return {
    season: requireString(raw.season, 'season'),
    startDate: requireString(raw.startDate, 'startDate'),
    endDate: requireString(raw.endDate, 'endDate'),
    keyDates: requireStringArray(raw.keyDates, 'keyDates'),
  }
}

/** 校验章节蓝图。 */
function parseChapterBlueprint(text: string, slug: string, chapter: number): Record<string, unknown> {
  const where = `第 ${chapter} 章蓝图(${slug})`
  const draft = parseJsonObject(text, where)
  rejectUnknownFields(draft, ['chapter', 'title', 'keyBeats', 'characterIds', 'povCharacterId', 'notes', 'threadIds'], where)
  const storedChapter = requireInteger(draft.chapter ?? chapter, `${where}.chapter`)
  if (storedChapter !== chapter) {
    fail('INVALID_CONTENT', `${where} 的 chapter 字段(${storedChapter})与目标章节(${chapter})不一致`)
  }
  // `threadIds` 只校验形态与唯一性,**不**校验线是否存在:与 characterIds 的现有
  // 做法保持一致(引用的存在性不在这里兜)。悬空引用被故事线投影忽略,不会报错。
  const threadIds = requireStringArray(draft.threadIds ?? [], `${where}.threadIds`).map(requireThreadId)
  if (new Set(threadIds).size !== threadIds.length) {
    fail('INVALID_CONTENT', `${where}.threadIds 必须唯一`)
  }
  return {
    chapter,
    title: requireString(draft.title, `${where}.title`),
    keyBeats: requireStringArray(draft.keyBeats, `${where}.keyBeats`),
    characterIds: requireStringArray(draft.characterIds, `${where}.characterIds`).map(requireCharacterId),
    povCharacterId: requireString(draft.povCharacterId, `${where}.povCharacterId`),
    notes: requireString(draft.notes ?? '', `${where}.notes`),
    threadIds,
  }
}

/**
 * 把一个资产替换文本规范化:
 * JSON 资产做严格校验并重新序列化;正文做 LF 归一化并保证结尾换行。
 *
 * @param target 目标资产。
 * @param replacement 模型提交的完整替换文本。
 * @returns 将要落盘的规范字节。
 */
function canonicalize(target: AssetRef, replacement: string): string {
  const normalized = normalizeText(replacement)
  if (!isJsonAsset(target)) {
    if (normalized.trim().length === 0) fail('INVALID_CONTENT', `${describe(target)} 不能为空`)
    return normalized.endsWith('\n') ? normalized : `${normalized}\n`
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(normalized) as unknown
  } catch (error) {
    fail('INVALID_CONTENT', `${describe(target)} 不是合法 JSON:${(error as Error).message}`)
  }
  switch (target.kind) {
    case 'project': return canonicalJson(parseProject(JSON.stringify(parsed)))
    case 'characters': return canonicalJson(parseCharacters(JSON.stringify(parsed)))
    case 'world': return canonicalJson(parseWorld(JSON.stringify(parsed)))
    case 'collection-blueprint': return canonicalJson(parseCollectionBlueprint(JSON.stringify(parsed), target.slug))
    case 'collection-timeline': return canonicalJson(parseTimeline(JSON.stringify(parsed), target.slug))
    case 'chapter-blueprint': return canonicalJson(parseChapterBlueprint(JSON.stringify(parsed), target.slug, target.chapter))
    default: return canonicalJson(parsed)
  }
}

/** 读取一个资产的当前文本,缺失返回 undefined。 */
async function readAssetText(absolute: string): Promise<string | undefined> {
  try {
    return await readFile(absolute, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    fail('WRITE_FAILED', `读取资产失败:${(error as Error).message}`)
  }
}

/**
 * 打开一个短篇集项目。
 *
 * @param root 工作区根目录(宿主已解析的规范路径)。
 * @param options 读取与写入上限。
 * @returns 该根目录下的项目句柄;文件在每次调用时按需读取,不做进程内缓存。
 */
export function openSerialProject(root: string, options: SerialProjectOptions): SerialProject {
  const absoluteOf = (target: AssetRef): string => join(root, relativePathOf(target))

  async function readProjectId(): Promise<WorldId> {
    const text = await readAssetText(absoluteOf({ kind: 'project' }))
    if (text === undefined) fail('NOT_INITIALIZED', '项目尚未初始化:缺少 .serial/project.json')
    return parseProject(text).worldId as WorldId
  }

  /**
   * 未初始化时让**所有**读取都返回稳定的 NOT_INITIALIZED。
   *
   * 这是模型判断"该不该调用 initialize"的唯一信号,不能让未初始化伪装成"资产为空"。
   */
  async function ensureInitialized(): Promise<void> {
    if (await readAssetText(absoluteOf({ kind: 'project' })) === undefined) {
      fail('NOT_INITIALIZED', '项目尚未初始化:缺少 .serial/project.json')
    }
  }

  async function readAsset(target: AssetRef, signal: AbortSignal): Promise<SerialAssetReadResult> {
    signal.throwIfAborted()
    await ensureInitialized()
    const absolute = absoluteOf(target)
    const text = await readAssetText(absolute)
    if (text === undefined) {
      return {
        kind: 'asset', target, source: relativePathOf(target), revision: 'absent',
        text: '', bytes: 0, truncated: false, omitted: true,
      }
    }
    signal.throwIfAborted()
    const normalized = normalizeText(text)
    // JSON 资产在读取时也校验:手改坏的文件应显式失败,而不是把坏内容喂给模型。
    if (isJsonAsset(target)) {
      switch (target.kind) {
        case 'project': parseProject(normalized); break
        case 'characters': parseCharacters(normalized); break
        case 'world': parseWorld(normalized); break
        case 'collection-blueprint': parseCollectionBlueprint(normalized, target.slug); break
        case 'collection-timeline': parseTimeline(normalized, target.slug); break
        case 'chapter-blueprint': parseChapterBlueprint(normalized, target.slug, target.chapter); break
        default: break
      }
    }
    const bytes = byteLength(normalized)
    const truncated = bytes > options.assetBytes
    const body = truncated ? Buffer.from(normalized, 'utf8').subarray(0, options.assetBytes).toString('utf8') : normalized
    return {
      kind: 'asset', target, source: relativePathOf(target), revision: revisionOf(text),
      text: body, bytes, truncated, omitted: false,
    }
  }

  /** 列出全部短篇集 slug(按目录名排序)。 */
  async function listCollectionSlugs(): Promise<readonly string[]> {
    const dir = join(root, SERIAL_DIR, COLLECTIONS_DIR)
    try {
      const entries = await readdir(dir, { withFileTypes: true })
      return entries
        .filter(entry => entry.isDirectory() && SLUG_PATTERN.test(entry.name))
        .map(entry => entry.name)
        .sort()
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
  }

  /** 索引里的一章。 */
  interface IndexedChapter {
    readonly chapter: number
    readonly hasBlueprint: boolean
    readonly hasDraft: boolean
    /** 蓝图里的 `characterIds`;没有蓝图时为空 —— 这正是"正文写了也不算"的落点。 */
    readonly characterIds: readonly string[]
    /** 蓝图里的 `threadIds`;没有蓝图时为空。 */
    readonly threadIds: readonly string[]
    readonly povCharacterId: string
  }

  /** 索引里的一集。 */
  interface IndexedCollection {
    readonly slug: string
    readonly blueprint: CollectionBlueprint | undefined
    readonly timeline: TimelineRecord | undefined
    readonly chapters: readonly IndexedChapter[]
  }

  /** 一次遍历得到的世界索引。 */
  interface WorldIndex {
    readonly characters: readonly CharacterRecord[]
    readonly charactersPresent: boolean
    readonly worldPresent: boolean
    readonly collections: readonly IndexedCollection[]
  }

  /**
   * 一次遍历读全世界的结构。
   *
   * 抽出来的理由不只是省 IO:`appearances` / `threads` / `audit` / `chronicle` 四个
   * 投影都要"遍历每一集、再看每一章的蓝图"。若各写一遍,**「出场与故事线推进只认
   * 蓝图、正文不参与」(§6.8)这条规则就会散落四份**,迟早有一份漂移。索引把章节的
   * `hasBlueprint` 与 `characterIds`/`threadIds` 绑在同一个结构里,规则就变成了
   * 结构性的:没有蓝图 ⇒ 那两项必然为空。
   *
   * @param signal 取消信号。
   * @returns 世界索引。
   */
  async function loadWorldIndex(signal: AbortSignal): Promise<WorldIndex> {
    const charactersText = await readAssetText(absoluteOf({ kind: 'characters' }))
    const worldText = await readAssetText(absoluteOf({ kind: 'world' }))
    const collections: IndexedCollection[] = []

    for (const slug of await listCollectionSlugs()) {
      signal.throwIfAborted()
      const blueprintText = await readAssetText(absoluteOf({ kind: 'collection-blueprint', slug }))
      const blueprint = blueprintText === undefined
        ? undefined
        : parseCollectionBlueprint(normalizeText(blueprintText), slug) as unknown as CollectionBlueprint
      const timelineText = await readAssetText(absoluteOf({ kind: 'collection-timeline', slug }))
      const timeline = timelineText === undefined
        ? undefined
        : parseTimeline(normalizeText(timelineText), slug) as unknown as TimelineRecord

      const chaptersPath = join(root, chaptersDir(slug))
      let names: readonly string[] = []
      try {
        // 只认共享布局定义的两个后缀,并用同一个解析器取章节号 —— 与写入侧同源。
        names = (await readdir(chaptersPath)).filter(name =>
          name.endsWith(CHAPTER_BLUEPRINT_SUFFIX) || name.endsWith(CHAPTER_DRAFT_SUFFIX))
      } catch {
        names = []
      }
      const numbers = new Set<number>()
      for (const name of names) {
        const chapter = chapterNumberOf(name)
        if (chapter !== undefined) numbers.add(chapter)
      }

      const chapters: IndexedChapter[] = []
      for (const chapter of [...numbers].sort((a, b) => a - b)) {
        signal.throwIfAborted()
        const blueprintRaw = await readAssetText(join(chaptersPath, `${chapterSegment(chapter)}${CHAPTER_BLUEPRINT_SUFFIX}`))
        const draftRaw = await readAssetText(join(chaptersPath, `${chapterSegment(chapter)}${CHAPTER_DRAFT_SUFFIX}`))
        const parsed = blueprintRaw === undefined
          ? undefined
          : parseChapterBlueprint(normalizeText(blueprintRaw), slug, chapter)
        chapters.push({
          chapter,
          hasBlueprint: blueprintRaw !== undefined,
          hasDraft: draftRaw !== undefined,
          characterIds: (parsed?.characterIds as readonly string[] | undefined) ?? [],
          threadIds: (parsed?.threadIds as readonly string[] | undefined) ?? [],
          povCharacterId: (parsed?.povCharacterId as string | undefined) ?? '',
        })
      }
      collections.push({ slug, blueprint, timeline, chapters })
    }

    return {
      characters: charactersText === undefined ? [] : parseCharacters(normalizeText(charactersText)).items,
      charactersPresent: charactersText !== undefined,
      worldPresent: worldText !== undefined,
      collections,
    }
  }

  /**
   * 世界投影:共享人物档案 + 全部短篇集蓝图。
   *
   * @param slug 给出时只返回该短篇集的蓝图(仍带回全部人物),用于投影过大时的收窄。
   * @param signal 取消信号。
   * @returns 有界投影。
   */
  async function readWorldProjection(slug: string | undefined, signal: AbortSignal): Promise<SerialWorldResult> {
    signal.throwIfAborted()
    await ensureInitialized()
    if (slug !== undefined) requireSlug(slug)
    const charactersText = await readAssetText(absoluteOf({ kind: 'characters' }))
    const characters = charactersText === undefined ? [] : parseCharacters(normalizeText(charactersText)).items

    const slugs = await listCollectionSlugs()
    const collections: CollectionBlueprint[] = []
    for (const candidate of slug === undefined ? slugs : slugs.filter(name => name === slug)) {
      signal.throwIfAborted()
      const blueprintText = await readAssetText(absoluteOf({ kind: 'collection-blueprint', slug: candidate }))
      if (blueprintText === undefined) continue
      const parsed = parseCollectionBlueprint(normalizeText(blueprintText), candidate)
      collections.push({ slug: candidate, ...parsed } as unknown as CollectionBlueprint)
    }

    const rendered = canonicalJson({ characters, collections })
    const truncated = byteLength(rendered) > options.workingSetBytes
    return { kind: 'world', characters, collections, truncated }
  }

  /**
   * 故事线投影:每条线声明出自哪个集,以及哪些章节推进过它。
   *
   * `advances` 只来自章节蓝图的 `threadIds`(索引里没有蓝图就没有 threadIds),
   * 因此引用到未声明线的 `threadIds` 被自然忽略,不会凭空造出线。
   *
   * @param slug 给出时只读该短篇集。
   * @param signal 取消信号。
   * @returns 有界投影。
   */
  async function readThreads(slug: string | undefined, signal: AbortSignal): Promise<SerialThreadsResult> {
    signal.throwIfAborted()
    await ensureInitialized()
    if (slug !== undefined) requireSlug(slug)

    const index = await loadWorldIndex(signal)
    const threads: SerialThreadResult[] = []
    let truncated = false
    for (const collection of index.collections) {
      if (slug !== undefined && collection.slug !== slug) continue
      signal.throwIfAborted()
      const declared = collection.blueprint?.threads ?? []
      if (declared.length === 0) continue
      for (const thread of declared) {
        if (threads.length >= options.queryMatches) { truncated = true; break }
        const advances = collection.chapters
          .filter(chapter => chapter.threadIds.includes(thread.id))
          .map(chapter => chapter.chapter)
        threads.push({
          collectionSlug: collection.slug,
          id: thread.id,
          title: thread.title,
          summary: thread.summary,
          advances: [...new Set(advances)].sort((a, b) => a - b),
        })
      }
      if (truncated) break
    }
    return { kind: 'threads', threads, truncated }
  }

  /**
   * 人物出场投影。
   *
   * @param characterId 人物稳定 id。
   * @param signal 取消信号。
   * @returns 有界投影;整集出场记为 `chapter: 0`。
   */
  async function readAppearances(characterId: string, signal: AbortSignal): Promise<SerialAppearancesResult> {
    signal.throwIfAborted()
    await ensureInitialized()
    requireCharacterId(characterId)
    const index = await loadWorldIndex(signal)
    const appearances: CharacterAppearance[] = []
    let truncated = false
    outer: for (const collection of index.collections) {
      signal.throwIfAborted()
      if ((collection.blueprint?.characterIds ?? []).includes(characterId)) {
        if (appearances.length >= options.queryMatches) { truncated = true } else {
          appearances.push({ characterId, collectionSlug: collection.slug, chapter: 0 })
        }
      }
      for (const chapter of collection.chapters) {
        if (!chapter.characterIds.includes(characterId)) continue
        if (appearances.length >= options.queryMatches) { truncated = true; break outer }
        appearances.push({ characterId, collectionSlug: collection.slug, chapter: chapter.chapter })
      }
    }
    return { kind: 'appearances', characterId, appearances, truncated }
  }

  /**
   * 跨集巡检:把规模一大就看不见的结构问题一次报出来。
   *
   * 只读。它是一份**报告**,不是一份校验器:发现的问题不会让读取失败 ——
   * 一份有缺口的手稿仍然应该能读。
   *
   * @param signal 取消信号。
   * @returns 有界报告。
   */
  async function readAudit(signal: AbortSignal): Promise<SerialAuditResult> {
    signal.throwIfAborted()
    await ensureInitialized()
    const index = await loadWorldIndex(signal)
    // 判定在 `src/serial-audit.ts` 里,与面板共用同一份 —— 这里只负责把文件系统的
    // 读数凑成它要的输入。
    return auditWorld({
      worldPresent: index.worldPresent,
      charactersPresent: index.charactersPresent,
      characters: index.characters.map(character => ({ id: character.id, name: character.name })),
      collections: index.collections.map(collection => ({
        slug: collection.slug,
        blueprint: collection.blueprint === undefined
          ? undefined
          : {
              characterIds: collection.blueprint.characterIds,
              threads: (collection.blueprint.threads ?? []).map(thread => ({ id: thread.id, title: thread.title })),
            },
        hasTimeline: collection.timeline !== undefined,
        chapters: collection.chapters.map(chapter => ({
          chapter: chapter.chapter,
          hasBlueprint: chapter.hasBlueprint,
          hasDraft: chapter.hasDraft,
          characterIds: chapter.characterIds,
          threadIds: chapter.threadIds,
          povCharacterId: chapter.povCharacterId,
        })),
      })),
    }, options.queryMatches)
  }

  /**
   * 把一集装配成一份 Markdown 文档。
   *
   * 装配本身在 `src/serial-export.ts` 里,与面板的导出按钮共用同一份 —— 两边各写一遍
   * 迟早会让"模型读到的整集"与"人下载到的整集"不一样。
   *
   * @param slug 短篇集 slug。
   * @param signal 取消信号。
   * @returns 有界导出结果(与读取一样受 `assetBytes` 限制)。
   */
  async function readExport(slug: string, signal: AbortSignal): Promise<SerialExportResult> {
    signal.throwIfAborted()
    await ensureInitialized()
    requireSlug(slug)
    const index = await loadWorldIndex(signal)
    const collection = index.collections.find(candidate => candidate.slug === slug)
    if (collection === undefined) {
      fail('NOT_INITIALIZED', `短篇集不存在:${slug}`)
    }

    const chapters: ExportChapterInput[] = []
    for (const chapter of collection.chapters) {
      signal.throwIfAborted()
      const raw = await readAssetText(absoluteOf({ kind: 'chapter-draft', slug, chapter: chapter.chapter }))
      const blueprintRaw = await readAssetText(absoluteOf({ kind: 'chapter-blueprint', slug, chapter: chapter.chapter }))
      chapters.push({
        chapter: chapter.chapter,
        title: blueprintRaw === undefined ? '' : optionalString(
          parseChapterBlueprint(normalizeText(blueprintRaw), slug, chapter.chapter).title, '章节标题',
        ) ?? '',
        text: raw === undefined ? '' : normalizeText(raw),
      })
    }

    const text = assembleCollectionMarkdown({
      slug,
      title: collection.blueprint?.title ?? '',
      theme: collection.blueprint?.theme ?? '',
      summary: collection.blueprint?.summary ?? '',
      status: collection.blueprint?.status ?? '',
      season: collection.timeline?.season ?? '',
      startDate: collection.timeline?.startDate ?? '',
      endDate: collection.timeline?.endDate ?? '',
      chapters,
    })
    const bytes = byteLength(text)
    const truncated = bytes > options.assetBytes
    return {
      kind: 'export',
      slug,
      text: truncated ? Buffer.from(text, 'utf8').subarray(0, options.assetBytes).toString('utf8') : text,
      bytes,
      chapters: chapters.length,
      truncated,
    }
  }

  /**
   * 跨集人物编年史。
   *
   * **不发明顺序、也不发明状态**:有时间锚的集按 `startDate` 升序,没有锚的集单独
   * 列出;人物"在这一集变成什么样"没有任何 schema 字段记录,所以这里不写。
   *
   * @param characterId 人物稳定 id。
   * @param signal 取消信号。
   * @returns 有界投影。
   */
  async function readChronicle(characterId: string, signal: AbortSignal): Promise<SerialChronicleResult> {
    signal.throwIfAborted()
    await ensureInitialized()
    requireCharacterId(characterId)
    const index = await loadWorldIndex(signal)

    const ordered: SerialChronicleStop[] = []
    const undated: SerialChronicleStop[] = []
    let truncated = false
    for (const collection of index.collections) {
      signal.throwIfAborted()
      const wholeCollection = (collection.blueprint?.characterIds ?? []).includes(characterId)
      const chapters = collection.chapters
        .filter(chapter => chapter.characterIds.includes(characterId))
        .map(chapter => chapter.chapter)
      if (!wholeCollection && chapters.length === 0) continue
      if (ordered.length + undated.length >= options.queryMatches) { truncated = true; break }
      const stop: SerialChronicleStop = {
        collectionSlug: collection.slug,
        title: collection.blueprint?.title ?? collection.slug,
        season: collection.timeline?.season ?? '',
        startDate: collection.timeline?.startDate ?? '',
        endDate: collection.timeline?.endDate ?? '',
        chapters,
        pov: collection.chapters.some(
          chapter => chapter.povCharacterId === characterId && chapter.characterIds.includes(characterId),
        ),
        wholeCollection,
      }
      if (stop.startDate === '') undated.push(stop)
      else ordered.push(stop)
    }

    // 只按作者写下的时间锚排序;字符串比较对 ISO 日期/YYYY-MM-DD 都成立,对其它
    // 写法退化成一个稳定但无意义的顺序 —— 所以同锚的集保持目录名顺序,不假装分先后。
    ordered.sort((a, b) => a.startDate.localeCompare(b.startDate) || a.collectionSlug.localeCompare(b.collectionSlug))
    return { kind: 'chronicle', characterId, ordered, undated, truncated }
  }

  async function initialize(request: SerialInitializeRequest, signal: AbortSignal): Promise<CommitReceipt> {
    signal.throwIfAborted()
    if (await readAssetText(absoluteOf({ kind: 'project' })) !== undefined) {
      fail('ALREADY_INITIALIZED', '项目已经初始化:.serial/project.json 已存在')
    }
    if (!CREATIVE_STRATEGIES.includes(request.creativeStrategy)) {
      fail('INVALID_CONTENT', `creativeStrategy 非法:${request.creativeStrategy}`)
    }
    const text = canonicalJson({
      worldId: request.worldId,
      worldName: request.worldName,
      language: request.language,
      tone: request.tone,
      creativeStrategy: request.creativeStrategy,
      createdAt: request.createdAt,
      updatedAt: request.updatedAt,
    })
    const bytes = byteLength(text)
    if (bytes > options.assetBytes) {
      fail('SIZE_LIMIT_EXCEEDED', `项目清单 ${bytes} 字节,超过上限 ${options.assetBytes}`)
    }
    signal.throwIfAborted()
    await writeFileAtomic(absoluteOf({ kind: 'project' }), text, { mode: FILE_MODE, dirMode: 0o755 })
    return {
      worldId: request.worldId, target: { kind: 'project' },
      oldRevision: 'absent', newRevision: revisionOf(text), bytes,
    }
  }

  async function replace(request: SerialReplaceRequest, signal: AbortSignal): Promise<CommitReceipt> {
    signal.throwIfAborted()
    const target = request.target
    if (target.kind !== 'project') {
      const projectText = await readAssetText(absoluteOf({ kind: 'project' }))
      if (projectText === undefined) fail('NOT_INITIALIZED', '项目尚未初始化:请先创建 .serial/project.json')
    }
    const absolute = absoluteOf(target)
    const existing = await readAssetText(absolute)
    const actual: Revision = existing === undefined ? 'absent' : revisionOf(existing)
    const expected = request.baseRevision
    if (expected !== actual) {
      fail(
        'STALE_REVISION',
        `${describe(target)} 的修订号已变化:期望 ${expected},实际 ${actual}。请重新读取后再提交。`,
      )
    }
    const canonical = canonicalize(target, request.replacement)
    const bytes = byteLength(canonical)
    if (bytes > options.assetBytes) {
      fail('SIZE_LIMIT_EXCEEDED', `${describe(target)} ${bytes} 字节,超过上限 ${options.assetBytes}`)
    }
    // 项目清单**可以**替换(创作方针会随写作演化),但世界身份不行:跨集与跨修订
    // 引用的都是这个 id,改它等于把项目指向另一个世界。
    if (target.kind === 'project' && existing !== undefined) {
      const before = parseProject(normalizeText(existing)).worldId as string
      const after = parseProject(canonical).worldId as string
      if (before !== after) {
        fail('INVALID_CONTENT', `worldId 不可更改:当前 ${before},提交的是 ${after}`)
      }
    }
    // 项目清单不存在时必须走 initialize:否则 replace 会绕过 ALREADY_INITIALIZED 的语义。
    if (target.kind === 'project' && existing === undefined) {
      fail('NOT_INITIALIZED', '项目尚未初始化:请先用 kind="initialize" 创建 .serial/project.json')
    }
    const worldId = await readProjectId()
    signal.throwIfAborted()
    await writeFileAtomic(absolute, canonical, { mode: FILE_MODE, dirMode: 0o755 })
    return { worldId, target, oldRevision: actual, newRevision: revisionOf(canonical), bytes }
  }

  return {
    async read(request, signal) {
      switch (request.kind) {
        case 'asset': return readAsset(request.target, signal)
        case 'world': return readWorldProjection(request.slug, signal)
        case 'appearances': return readAppearances(request.characterId, signal)
        case 'threads': return readThreads(request.slug, signal)
        case 'audit': return readAudit(signal)
        case 'chronicle': return readChronicle(request.characterId, signal)
        case 'export': return readExport(request.slug, signal)
      }
    },
    async apply(request, signal) {
      return request.kind === 'initialize'
        ? initialize(request, signal)
        : replace(request, signal)
    },
  }
}

/** 供工具层做审批卡片预览:把一个替换渲染成规范终态文本。 */
export function canonicalSerialAssetText(target: AssetRef, replacement: string): string {
  return canonicalize(target, replacement)
}

/**
 * 供工具层做审批卡片预览:渲染初始化后的项目清单。
 *
 * 这里也校验 `creativeStrategy` 枚举:审批卡片与审批门都调用它,若它放行一个
 * 非法策略,审批人就会为一次注定失败的初始化点确认。
 */
export function canonicalSerialInitialization(request: SerialInitializeRequest): string {
  if (!CREATIVE_STRATEGIES.includes(request.creativeStrategy)) {
    fail('INVALID_CONTENT', `creativeStrategy 非法:${request.creativeStrategy};只能是 ${CREATIVE_STRATEGIES.join(' / ')}`)
  }
  return canonicalJson({
    worldId: request.worldId,
    worldName: request.worldName,
    language: request.language,
    tone: request.tone,
    creativeStrategy: request.creativeStrategy,
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
  })
}

/** 资产在项目内的相对路径,供审批卡片的 diff 路径使用。 */
export function serialAssetSource(target: AssetRef): string {
  return relativePathOf(target)
}
