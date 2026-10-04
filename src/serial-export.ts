/**
 * 把一集装配成**一份** Markdown 文档。
 *
 * ## 为什么是一个共享纯函数
 *
 * "导出这一集"是**一个操作、两个调用方**:
 * - 模型走 `serial_read kind="export"` 拿到整集文本;
 * - 面板给人同一份文本并允许下载。
 *
 * 两边各写一遍装配逻辑,迟早会出现"模型读到的整集"与"人下载到的整集"不一样 ——
 * 而这种差异极难被发现。所以装配只有这一份实现,两个调用方只负责把数据凑成
 * {@link ExportCollectionInput}。
 *
 * ## 它必须零运行时依赖
 *
 * 面板那一侧要引它(客户端打包),因此只做 `import type`。
 *
 * ## 刻意不写时间戳
 *
 * 导出结果里**没有**"导出时间"之类的字段:那会让同一集在两次导出时字节不同,测试无法
 * 用快照钉住,人也无法判断两份导出是否真的不同。
 */

/** 参与装配的一章。 */
export interface ExportChapterInput {
  readonly chapter: number
  /** 章节标题;没有蓝图时为空串。 */
  readonly title: string
  /** 正文;还没有正文时为空串。 */
  readonly text: string
}

/** 参与装配的一集。 */
export interface ExportCollectionInput {
  readonly slug: string
  readonly title: string
  readonly theme: string
  readonly summary: string
  readonly status: string
  readonly season: string
  readonly startDate: string
  readonly endDate: string
  readonly chapters: readonly ExportChapterInput[]
}

/** 没有正文的章在导出里留下的标记。 */
const MISSING_DRAFT = '（本章还没有正文）'

/** 章标题在导出文档里的层级。 */
const CHAPTER_HEADING_LEVEL = 2

/** 一个 ATX 标题行。 */
const ATX = /^(#{1,6})(\s+.*)$/
const FENCE = /^\s*```/

/**
 * 正文里最浅的标题层级。
 *
 * 扫描时跳过围栏代码块 —— 代码里的 `#` 是注释,不是标题。
 *
 * @param text 正文。
 * @returns 最浅层级(1~6);正文里没有标题时为 undefined。
 */
function shallowestHeadingLevel(text: string): number | undefined {
  let inFence = false
  let shallowest: number | undefined
  for (const line of text.split('\n')) {
    if (FENCE.test(line)) { inFence = !inFence; continue }
    if (inFence) continue
    const match = ATX.exec(line)
    if (match === null) continue
    const level = match[1].length
    if (shallowest === undefined || level < shallowest) shallowest = level
  }
  return shallowest
}

/**
 * 把正文里的标题整体下沉,使最浅的那个落在 `level`。
 *
 * 这是**结构归一化**,不是改写内容:散文一个字节都不动,只有标题行的井号个数变化。
 * 不这么做的话,作者的 `# 暮山紫` 会出现在导出的 `## 第 1 章` **下面**,层级是倒的。
 *
 * @param text 正文。
 * @param level 目标层级。
 * @returns 归一化后的正文。
 */
function shiftHeadings(text: string, level: number): string {
  const shallowest = shallowestHeadingLevel(text)
  if (shallowest === undefined || shallowest >= level) return text
  const delta = level - shallowest
  let inFence = false
  return text.split('\n').map(line => {
    if (FENCE.test(line)) { inFence = !inFence; return line }
    if (inFence) return line
    const match = ATX.exec(line)
    if (match === null) return line
    const hashes = '#'.repeat(Math.min(match[1].length + delta, 6))
    return `${hashes}${match[2]}`
  }).join('\n')
}

/**
 * 装配整集 Markdown。
 *
 * 结构:一级标题(集名)→ 可选的题记 → 分隔线 → 每章。
 *
 * 每一章按它自己的形态落位:
 * - 正文**自带标题**时,整体下沉到 {@link CHAPTER_HEADING_LEVEL} 之下,并不再注入
 *   "第 N 章"标题 —— 作者已经写了章名,注入只会得到两份标题,而且层级是倒的。
 * - 正文**没有标题**时,注入 `## 第 N 章 …` 作为定位。
 * - 正文**缺失**时保留注入的标题并标出缺失:静默丢章会让导出看起来比实际完整。
 *
 * 章按章节号升序。
 *
 * @param input 一集的内容。
 * @returns 完整的 Markdown 文本(以换行结尾)。
 */
export function assembleCollectionMarkdown(input: ExportCollectionInput): string {
  const lines: string[] = [`# ${input.title === '' ? input.slug : input.title}`, '']

  const meta: string[] = []
  if (input.theme !== '') meta.push(`主题:${input.theme}`)
  if (input.status !== '') meta.push(`状态:${input.status}`)
  const period = [input.season, input.startDate, input.endDate].filter(part => part !== '')
  if (period.length > 0) meta.push(`时间:${period.join(' · ')}`)
  if (input.summary !== '') meta.push(input.summary)
  if (meta.length > 0) {
    lines.push(...meta.map(line => `> ${line}`), '')
  }

  const ordered = [...input.chapters].sort((a, b) => a.chapter - b.chapter)
  for (const chapter of ordered) {
    const body = chapter.text.replace(/\r\n?/g, '\n').replace(/\n+$/, '')
    lines.push('---', '')
    if (body.trim() === '') {
      lines.push(renderLocator(chapter), '', MISSING_DRAFT, '')
      continue
    }
    if (shallowestHeadingLevel(body) === undefined) {
      lines.push(renderLocator(chapter), '')
    }
    lines.push(shiftHeadings(body, CHAPTER_HEADING_LEVEL), '')
  }
  return `${lines.join('\n').replace(/\n+$/, '')}\n`
}

/**
 * 注入的章定位标题。
 *
 * @param chapter 一章。
 * @returns 标题行。
 */
function renderLocator(chapter: ExportChapterInput): string {
  return `${'#'.repeat(CHAPTER_HEADING_LEVEL)} 第 ${chapter.chapter} 章${chapter.title === '' ? '' : ` ${chapter.title}`}`
}
