/**
 * Keyless 端到端快照:一次完整的"写一本书"历程。
 *
 * ## 为什么叫 keyless
 *
 * 全程**没有模型**:不调 LLM、不需要 API key。用的是模型真正会用的那一层 ——
 * V1 的 `serial_read` / `serial_apply_change` 工具定义,以及它们背后的真实文件系统。
 * 因此它能在任何机器上确定性地重放,而 snapshot 把整条链路的**规范字节**钉住:
 * 序列化排版、修订号、审批决策、各投影的形状,任何一处漂移都会红。
 *
 * ## 它覆盖什么
 *
 * 从"未初始化"一路走到"一集写完并可巡检":
 * initialize → world(含步 3 新字段) → characters → collection-blueprint(含 threads)
 * → timeline → chapter-blueprint(含 threadIds) → chapter-draft
 * → 六种读取投影(world / appearances / threads / audit / chronicle / asset)。
 *
 * 同时在两侧留了钉子:每一次**合法**写入都必须弹原生审批(`ask`),而**非法**内容
 * 必须被直接拒绝且**不弹审批**(`deny`)—— 后者是曾经白烧用户审批的那个缺陷。
 */

import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createSerialToolDefinitions, serialApprovalGate } from '../src/agent.ts'
import { serialAssetSource } from '../src/serial-project.ts'

const WORLD_ID = '11111111-2222-4333-8444-555555555555'
const CREATED = '2026-10-03T09:00:00.000Z'
const SLUG = 'first-snow'

const WORLD = {
  setting: '海边小镇的旧剧场,冬天有雪。',
  locations: ['旧剧场', '站前通'],
  notes: '',
  era: '当代',
  organizations: ['剧场保存会'],
  rules: ['演出只在冬季', '一场戏一个视角'],
  glossary: [{ term: '初雪', definition: '本季开演的日子' }],
}

const CHARACTERS = {
  items: [
    { id: 'hiori', name: '灯织', role: '主角', summary: '怕生但认真', goal: '站上舞台', voice: '轻声', background: '剧场新人' },
    { id: 'shen', name: '沈奕', role: '配角', summary: '沉默的灯光师', goal: '守住旧剧场', voice: '少言', background: '本地人' },
  ],
}

const BLUEPRINT = {
  title: '初雪',
  theme: '第一次被看见',
  summary: '一个冬天里的一次演出。',
  characterIds: ['hiori', 'shen'],
  targetWords: 12000,
  status: 'in-progress',
  threads: [
    { id: 'first-snow', title: '初雪', summary: '开演那天的雪' },
    { id: 'silent-light', title: '沉默的灯', summary: '灯光师不肯说的话' },
  ],
}

const TIMELINE = { season: '冬', startDate: '2026-11-01', endDate: '2027-02-28', keyDates: ['11-01 首演'] }

const CHAPTER_ONE = {
  chapter: 1,
  title: '开场',
  keyBeats: ['雪先落下来', '灯亮'],
  characterIds: ['hiori'],
  povCharacterId: 'hiori',
  notes: '',
  threadIds: ['first-snow'],
}

const CHAPTER_ONE_DRAFT = '# 开场\r\n\r\n雪落在旧剧场的铁皮屋顶上。\r\n'

let root: string
let signal: AbortSignal

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'serial-journey-'))
  signal = new AbortController().signal
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

/** 工具执行上下文;只提供工具真正读取的字段。 */
function exec(): never {
  return {
    agent: { id: 'session-journey', session: { header: { cwd: root } } },
    signal,
    callId: 'call',
    arguments: {},
  } as never
}

/** 递归列出项目下的相对路径与字节数。 */
async function projectTree(): Promise<readonly string[]> {
  const walk = async (relative: string): Promise<string[]> => {
    const absolute = relative === '' ? root : join(root, relative)
    const entries = await readdir(absolute, { withFileTypes: true })
    const rows: string[] = []
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const child = relative === '' ? entry.name : `${relative}/${entry.name}`
      if (entry.isDirectory()) rows.push(...await walk(child))
      else rows.push(`${child} (${(await readFile(join(root, child))).byteLength} B)`)
    }
    return rows
  }
  return (await walk('')).filter(path => path.startsWith('.serial'))
}

describe('keyless 端到端:写一本书', () => {
  it('从零到一集可巡检,规范字节与各投影都被钉住', async () => {
    const [readTool, applyTool] = createSerialToolDefinitions({})
    const receipts: unknown[] = []
    const approvals: unknown[] = []
    const denials: unknown[] = []

    /** 走一次工具写入,并顺带记录审批门的判定 —— 合法内容必须弹审批。 */
    const write = async (args: Record<string, unknown>): Promise<Record<string, unknown>> => {
      approvals.push(await serialApprovalGate(
        { name: 'serial_apply_change', arguments: args },
        () => Promise.resolve({ kind: 'allow' }),
      ))
      const receipt = await applyTool.execute(args, exec()) as Record<string, unknown>
      receipts.push({ target: receipt.target, oldRevision: receipt.oldRevision, newRevision: receipt.newRevision, bytes: receipt.bytes })
      return receipt
    }

    // 1. 未初始化:所有读取都以 NOT_INITIALIZED 失败 —— 这是该不该 initialize 的唯一信号。
    const beforeInitialize = await readTool.execute({ kind: 'world' }, exec())
      .then(() => 'no-error', (error: { code?: string }) => error.code)
    expect(beforeInitialize).toBe('NOT_INITIALIZED')

    // 2. initialize
    await write({
      kind: 'initialize', worldId: WORLD_ID, worldName: '初雪', language: 'zh-CN', tone: '克制',
      creativeStrategy: 'consistency-first', createdAt: CREATED, updatedAt: CREATED,
    })

    // 3~5. 世界观、人物档案、短篇集蓝图(含故事线)
    await write({ kind: 'replace', targetKind: 'world', baseRevision: 'absent', replacement: JSON.stringify(WORLD), summary: '共享设定' })
    await write({ kind: 'replace', targetKind: 'characters', baseRevision: 'absent', replacement: JSON.stringify(CHARACTERS), summary: '人物档案' })
    await write({
      kind: 'replace', targetKind: 'collection-blueprint', slug: SLUG, baseRevision: 'absent',
      replacement: JSON.stringify(BLUEPRINT), summary: '建立《初雪》',
    })
    await write({
      kind: 'replace', targetKind: 'collection-timeline', slug: SLUG, baseRevision: 'absent',
      replacement: JSON.stringify(TIMELINE), summary: '《初雪》时间线',
    })

    // 6~7. 章节蓝图与正文。**先蓝图后正文** —— 出场与故事线推进只认蓝图(§6.8)。
    await write({
      kind: 'replace', targetKind: 'chapter-blueprint', slug: SLUG, chapter: 1, baseRevision: 'absent',
      replacement: JSON.stringify(CHAPTER_ONE), summary: '第 1 章蓝图',
    })
    await write({
      kind: 'replace', targetKind: 'chapter-draft', slug: SLUG, chapter: 1, baseRevision: 'absent',
      replacement: CHAPTER_ONE_DRAFT, summary: '第 1 章正文',
    })

    // 每次合法写入都必须经过原生审批。
    expect(approvals).toEqual(Array(7).fill({ kind: 'ask', reason: '批准后仅修改这一个短篇集资产。' }))

    // 8. 非法内容:直接被拒,且**不弹审批**(否则用户要为一次注定失败的写入点确认)。
    const illegalApproval = await serialApprovalGate(
      { name: 'serial_apply_change', arguments: { kind: 'replace', targetKind: 'world', baseRevision: 'absent', replacement: '{"setting":1}', summary: 's' } },
      () => Promise.resolve({ kind: 'allow' }),
    )
    denials.push(illegalApproval)

    // 9. 六种读取投影
    const projections = {
      assetCharacterWorld: await readTool.execute({ kind: 'asset', target: { kind: 'world' } }, exec()),
      world: await readTool.execute({ kind: 'world' }, exec()),
      appearances: await readTool.execute({ kind: 'appearances', characterId: 'hiori' }, exec()),
      threads: await readTool.execute({ kind: 'threads' }, exec()),
      audit: await readTool.execute({ kind: 'audit' }, exec()),
      chronicle: await readTool.execute({ kind: 'chronicle', characterId: 'hiori' }, exec()),
      export: await readTool.execute({ kind: 'export', slug: SLUG }, exec()),
    }

    // 10. 落盘字节:正文按 LF 归一化并补结尾换行;章节号补零。
    const draftOnDisk = await readFile(join(root, serialAssetSource({ kind: 'chapter-draft', slug: SLUG, chapter: 1 })), 'utf8')

    const snapshot = {
      tree: await projectTree(),
      canonicalAssets: {
        project: JSON.parse(await readFile(join(root, '.serial/project.json'), 'utf8')) as unknown,
        world: JSON.parse(await readFile(join(root, '.serial/world.json'), 'utf8')) as unknown,
        blueprint: JSON.parse(await readFile(join(root, `.serial/collections/${SLUG}/blueprint.json`), 'utf8')) as unknown,
        chapterBlueprint: JSON.parse(await readFile(join(root, `.serial/collections/${SLUG}/chapters/0001-blueprint.json`), 'utf8')) as unknown,
        draft: draftOnDisk,
      },
      receipts,
      approvals,
      denials,
      projections,
    }
    expect(snapshot).toMatchSnapshot()

    // 显式契约断言:即便快照是首次生成,这几条也必须成立。
    expect(draftOnDisk).toBe('# 开场\n\n雪落在旧剧场的铁皮屋顶上。\n')
    expect(beforeInitialize).toBe('NOT_INITIALIZED')
    expect(denials[0]).toMatchObject({ kind: 'deny' })
    expect((denials[0] as { reason: string }).reason).toContain('通不过校验')

    // 导出:模型 `kind="export"` 拿到的整集,结构与落盘内容一致。
    const exported = projections.export as { kind: string; text: string; chapters: number; truncated: boolean }
    expect(exported.kind).toBe('export')
    expect(exported.chapters).toBe(1)
    expect(exported.truncated).toBe(false)
    expect(exported.text).toContain('# 初雪')
    expect(exported.text).toContain('> 主题:第一次被看见')
    // 这一章的正文自带 `# 开场`,所以它被下沉到二级,且**不再**注入重复的章定位。
    expect(exported.text).toContain('## 开场')
    expect(exported.text).not.toContain('## 第 1 章')
    expect(exported.text).toContain('雪落在旧剧场的铁皮屋顶上。')
  })

  it('手改坏的资产在读取时以 INVALID_CONTENT 失败,而不是喂给模型', async () => {
    const [readTool, applyTool] = createSerialToolDefinitions({})
    await applyTool.execute({
      kind: 'initialize', worldId: WORLD_ID, worldName: '初雪', language: 'zh-CN', tone: '克制',
      creativeStrategy: 'consistency-first', createdAt: CREATED, updatedAt: CREATED,
    }, exec())
    // 绕过插件直接写坏字节 —— 模拟有人用编辑器改坏了文件。
    await writeFile(join(root, '.serial', 'characters.json'), '{ 这不是 JSON', 'utf8')

    const error = await readTool.execute({ kind: 'asset', target: { kind: 'characters' } }, exec())
      .then(() => undefined, (reason: { code?: string }) => reason)
    expect(error?.code).toBe('INVALID_CONTENT')
  })
})
