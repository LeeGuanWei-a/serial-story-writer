/**
 * 短篇集项目文件层的行为测试。
 *
 * 覆盖三条不变量:修订号即并发、单文件原子替换、落盘即规范字节;
 * 以及稳定的失败码(未初始化 / 过期修订 / 路径拒绝 / 内容非法 / 超限)。
 *
 * 最后两组是步 3 的领域模型扩容:新增字段一律**可选**,所以扩容不需要迁移 ——
 * 这一条由"旧字节仍然合法"的用例钉住。
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openSerialProject, serialAssetSource } from '../src/serial-project.ts'
import type { SerialProject } from '../src/serial-project.ts'
import { SerialProjectError, type AssetRef, type SerialInitializeRequest, type WorldId } from '../src/types.ts'

const OPTIONS = { assetBytes: 64 * 1024, workingSetBytes: 64 * 1024, queryMatches: 20 }

const INITIALIZE: SerialInitializeRequest = {
  kind: 'initialize',
  worldId: '11111111-2222-4333-8444-555555555555' as WorldId,
  worldName: '闪耀色彩',
  language: 'zh-CN',
  tone: 'warm',
  creativeStrategy: 'auto',
  createdAt: '2026-10-03T00:00:00.000Z',
  updatedAt: '2026-10-03T00:00:00.000Z',
}

const CHARACTERS = {
  items: [
    {
      id: 'hiori', name: '灯织', role: '主角', summary: '怕生但认真',
      goal: '站上舞台', voice: '轻声', background: '事务所新人',
    },
  ],
}

let root: string
let signal: AbortSignal

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'serial-story-'))
  signal = new AbortController().signal
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

/** 断言 Promise 以指定稳定码失败。 */
async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  await expect(promise).rejects.toBeInstanceOf(SerialProjectError)
  await promise.catch((error: SerialProjectError) => {
    expect(error.code).toBe(code)
  })
}

/** 读一个资产,并把联合类型窄化到资产结果(否则拿不到 `text` / `revision`)。 */
async function readAsset(project: SerialProject, target: AssetRef, abort: AbortSignal) {
  const result = await project.read({ kind: 'asset', target }, abort)
  if (result.kind !== 'asset') throw new Error(`期望资产读取结果,收到 ${result.kind}`)
  return result
}

/** 读故事线投影,并窄化类型。 */
async function readThreads(project: SerialProject, abort: AbortSignal) {
  const result = await project.read({ kind: 'threads' }, abort)
  if (result.kind !== 'threads') throw new Error(`期望故事线投影,收到 ${result.kind}`)
  return result
}

/** 建好项目并写入人物档案 —— 大多数用例的共同前置。 */
async function seedProject(): Promise<SerialProject> {
  const project = openSerialProject(root, OPTIONS)
  await project.apply(INITIALIZE, signal)
  await project.apply({
    kind: 'replace', target: { kind: 'characters' }, baseRevision: 'absent',
    replacement: JSON.stringify(CHARACTERS), summary: '建立人物档案',
  }, signal)
  return project
}

describe('未初始化', () => {
  it('任何读取都返回 NOT_INITIALIZED,而不是伪装成空资产', async () => {
    const project = openSerialProject(root, OPTIONS)
    await expectCode(project.read({ kind: 'asset', target: { kind: 'characters' } }, signal), 'NOT_INITIALIZED')
    await expectCode(project.read({ kind: 'world' }, signal), 'NOT_INITIALIZED')
    await expectCode(project.read({ kind: 'appearances', characterId: 'hiori' }, signal), 'NOT_INITIALIZED')
    await expectCode(project.read({ kind: 'threads' }, signal), 'NOT_INITIALIZED')
  })

  it('替换非清单资产也要求先初始化', async () => {
    const project = openSerialProject(root, OPTIONS)
    await expectCode(project.apply({
      kind: 'replace', target: { kind: 'characters' }, baseRevision: 'absent',
      replacement: JSON.stringify(CHARACTERS), summary: '建立人物档案',
    }, signal), 'NOT_INITIALIZED')
  })

  it('项目清单缺失时 replace 也要求先 initialize', async () => {
    const project = openSerialProject(root, OPTIONS)
    // 内容本身必须合法,否则先撞上内容校验(规范化早于身份守卫)。
    await expectCode(project.apply({
      kind: 'replace', target: { kind: 'project' }, baseRevision: 'absent',
      replacement: JSON.stringify({
        worldId: INITIALIZE.worldId, worldName: '闪耀色彩', language: 'zh-CN', tone: 'warm',
        creativeStrategy: 'auto', createdAt: INITIALIZE.createdAt, updatedAt: INITIALIZE.updatedAt,
      }), summary: '绕过 initialize',
    }, signal), 'NOT_INITIALIZED')
  })
})

describe('初始化', () => {
  it('写入规范化清单并返回带修订号的收据', async () => {
    const project = openSerialProject(root, OPTIONS)
    const receipt = await project.apply(INITIALIZE, signal)

    expect(receipt.target).toEqual({ kind: 'project' })
    expect(receipt.oldRevision).toBe('absent')
    expect(receipt.newRevision).toMatch(/^[0-9a-f]{64}$/)
    expect(receipt.worldId).toBe(INITIALIZE.worldId)

    const text = await readFile(join(root, serialAssetSource({ kind: 'project' })), 'utf8')
    expect(text.endsWith('\n')).toBe(true)
    expect(text).not.toContain('\r')
    expect(JSON.parse(text)).toMatchObject({ worldName: '闪耀色彩', language: 'zh-CN' })
  })

  it('重复初始化以 ALREADY_INITIALIZED 失败,不覆盖已有字节', async () => {
    const project = openSerialProject(root, OPTIONS)
    const first = await project.apply(INITIALIZE, signal)
    await expectCode(project.apply(INITIALIZE, signal), 'ALREADY_INITIALIZED')
    const reread = await readAsset(project, { kind: 'project' }, signal)
    expect(reread.revision).toBe(first.newRevision)
  })
})

describe('修订号即并发', () => {
  it('过期 baseRevision 以 STALE_REVISION 失败,且不写入', async () => {
    const project = await seedProject()
    const before = await readAsset(project, { kind: 'characters' }, signal)

    await expectCode(project.apply({
      kind: 'replace', target: { kind: 'characters' }, baseRevision: 'absent',
      replacement: JSON.stringify({ items: [] }), summary: '再次以 absent 提交',
    }, signal), 'STALE_REVISION')

    const after = await readAsset(project, { kind: 'characters' }, signal)
    expect(after.revision).toBe(before.revision)
  })

  it('正确 baseRevision 提交后修订号推进', async () => {
    const project = await seedProject()
    const before = await readAsset(project, { kind: 'characters' }, signal)
    const next = { items: [{ ...CHARACTERS.items[0], goal: '和同伴一起站上舞台' }] }

    const receipt = await project.apply({
      kind: 'replace', target: { kind: 'characters' }, baseRevision: before.revision,
      replacement: JSON.stringify(next), summary: '改写目标',
    }, signal)

    expect(receipt.oldRevision).toBe(before.revision)
    expect(receipt.newRevision).not.toBe(before.revision)
    expect(receipt.newRevision).toMatch(/^[0-9a-f]{64}$/)
  })

  it('落盘字节与模型提交的格式无关(规范化后修订号一致)', async () => {
    const project = await seedProject()
    const compact = await project.apply({
      kind: 'replace', target: { kind: 'world' }, baseRevision: 'absent',
      replacement: '{"setting":"海边小镇","locations":[],"notes":""}', summary: '建立世界观',
    }, signal)

    const pretty = await project.apply({
      kind: 'replace', target: { kind: 'world' }, baseRevision: compact.newRevision,
      replacement: '{\n  "setting": "海边小镇",\n  "locations": [],\n  "notes": ""\n}\n', summary: '换成另一种排版',
    }, signal)

    // 同样的语义内容 ⇒ 规范化后字节相同 ⇒ 修订号不变。
    expect(pretty.newRevision).toBe(compact.newRevision)
  })
})

describe('路径与内容校验', () => {
  it('非法 slug 以 PATH_REJECTED 失败,阻止路径穿越', async () => {
    const project = await seedProject()
    await expectCode(project.apply({
      kind: 'replace', target: { kind: 'collection-blueprint', slug: '../../etc' }, baseRevision: 'absent',
      replacement: '{}', summary: '越权路径',
    }, signal), 'PATH_REJECTED')
  })

  it('未知字段以 INVALID_CONTENT 失败', async () => {
    // 这里刻意只 initialize:人物档案仍然缺失,`absent` 才是它的真实修订号。
    // (若先写了档案,同一个请求会先撞上 STALE_REVISION —— 修订号检查早于内容校验。)
    const project = openSerialProject(root, OPTIONS)
    await project.apply(INITIALIZE, signal)
    await expectCode(project.apply({
      kind: 'replace', target: { kind: 'characters' }, baseRevision: 'absent',
      replacement: JSON.stringify({ items: [], extra: true }), summary: '含未知字段',
    }, signal), 'INVALID_CONTENT')
  })

  // 模型看不到 schema,只能从报错里学。所以"含未知字段"必须同时给出允许的字段名,
  // 否则它只能接着猜,而写入路径上每一次猜错都要花掉一次审批。
  it('未知字段的报错列出该资产允许的字段名', async () => {
    const project = await seedProject()
    const error = await project.apply({
      kind: 'replace', target: { kind: 'world' }, baseRevision: 'absent',
      replacement: JSON.stringify({ id: 'x', name: 'y', type: 'z' }), summary: '自创世界观字段',
    }, signal).then(() => undefined, (reason: unknown) => reason as Error)
    expect(error?.message).toContain('id, name, type')
    expect(error?.message).toContain('setting, locations, notes')
  })

  it('缺失必填字段的报错说明它是必填的', async () => {
    const project = await seedProject()
    const error = await project.apply({
      kind: 'replace', target: { kind: 'world' }, baseRevision: 'absent',
      replacement: JSON.stringify({ locations: [] }), summary: '漏了 setting 与 notes',
    }, signal).then(() => undefined, (reason: unknown) => reason as Error)
    expect(error?.message).toContain('setting 是必填字段')
  })

  it('initialize 的 creativeStrategy 枚举非法时立刻失败', async () => {
    const project = openSerialProject(root, OPTIONS)
    await expectCode(project.apply({
      ...INITIALIZE,
      creativeStrategy: 'stream-of-consciousness',
    } as never, signal), 'INVALID_CONTENT')
  })

  it('超过 assetBytes 的资产以 SIZE_LIMIT_EXCEEDED 失败', async () => {
    // 上限按"每个资产"生效,所以要选一个容得下项目清单(约 244 字节)、
    // 但容不下这份人物档案的值。
    const limited = openSerialProject(root, { ...OPTIONS, assetBytes: 400 })
    await limited.apply(INITIALIZE, signal)
    const bulky = {
      items: [{ ...CHARACTERS.items[0], background: '长'.repeat(600) }],
    }
    await expectCode(limited.apply({
      kind: 'replace', target: { kind: 'characters' }, baseRevision: 'absent',
      replacement: JSON.stringify(bulky), summary: '过大',
    }, signal), 'SIZE_LIMIT_EXCEEDED')
  })
})

describe('正文与章节文件名', () => {
  it('正文按 LF 归一化并补结尾换行', async () => {
    const project = await seedProject()
    await project.apply({
      kind: 'replace', target: { kind: 'collection-blueprint', slug: 'first' }, baseRevision: 'absent',
      replacement: JSON.stringify({
        title: '第一集', theme: '主题', summary: '梗概',
        characterIds: ['hiori'], targetWords: 8000, status: 'planned',
      }), summary: '建立短篇集',
    }, signal)
    await project.apply({
      kind: 'replace', target: { kind: 'chapter-draft', slug: 'first', chapter: 1 }, baseRevision: 'absent',
      replacement: '第一行\r\n第二行', summary: '第一章正文',
    }, signal)

    const text = await readFile(join(root, serialAssetSource({ kind: 'chapter-draft', slug: 'first', chapter: 1 })), 'utf8')
    expect(text).toBe('第一行\n第二行\n')
  })

  it('章节号补齐为 4 位文件名', async () => {
    const project = await seedProject()
    await project.apply({
      kind: 'replace', target: { kind: 'collection-blueprint', slug: 'first' }, baseRevision: 'absent',
      replacement: JSON.stringify({
        title: '第一集', theme: '主题', summary: '梗概',
        characterIds: ['hiori'], targetWords: 8000, status: 'planned',
      }), summary: '建立短篇集',
    }, signal)
    await project.apply({
      kind: 'replace', target: { kind: 'chapter-draft', slug: 'first', chapter: 7 }, baseRevision: 'absent',
      replacement: '第七章', summary: '第七章正文',
    }, signal)

    expect(serialAssetSource({ kind: 'chapter-draft', slug: 'first', chapter: 7 }))
      .toBe('.serial/collections/first/chapters/0007.md')
    const text = await readFile(join(root, '.serial', 'collections', 'first', 'chapters', '0007.md'), 'utf8')
    expect(text).toBe('第七章\n')
  })
})

describe('投影', () => {
  it('world 返回共享人物与短篇集蓝图', async () => {
    const project = await seedProject()
    await project.apply({
      kind: 'replace', target: { kind: 'collection-blueprint', slug: 'first' }, baseRevision: 'absent',
      replacement: JSON.stringify({
        title: '第一集', theme: '主题', summary: '梗概',
        characterIds: ['hiori'], targetWords: 8000, status: 'in-progress',
      }), summary: '建立短篇集',
    }, signal)

    const world = await project.read({ kind: 'world' }, signal)
    if (world.kind !== 'world') throw new Error('期望世界投影')
    expect(world.characters.map(character => character.id)).toEqual(['hiori'])
    expect(world.collections).toHaveLength(1)
    // 身份来自目录名,读取时注入 —— 文件里并不存 slug。
    expect(world.collections[0].slug).toBe('first')
    expect(world.collections[0].status).toBe('in-progress')
  })

  it('appearances 汇总某人物在哪些集与章节出场', async () => {
    const project = await seedProject()
    await project.apply({
      kind: 'replace', target: { kind: 'collection-blueprint', slug: 'first' }, baseRevision: 'absent',
      replacement: JSON.stringify({
        title: '第一集', theme: '主题', summary: '梗概',
        characterIds: ['hiori'], targetWords: 8000, status: 'planned',
      }), summary: '建立短篇集',
    }, signal)
    await project.apply({
      kind: 'replace', target: { kind: 'chapter-blueprint', slug: 'first', chapter: 2 }, baseRevision: 'absent',
      replacement: JSON.stringify({
        title: '第二章', keyBeats: ['转折'], characterIds: ['hiori'], povCharacterId: 'hiori',
      }), summary: '第二章蓝图',
    }, signal)

    const result = await project.read({ kind: 'appearances', characterId: 'hiori' }, signal)
    if (result.kind !== 'appearances') throw new Error('期望出场投影')
    // 集蓝图记一条 chapter 0(整集出场),章节蓝图再记章级 —— 正文不参与。
    expect(result.appearances).toEqual([
      { characterId: 'hiori', collectionSlug: 'first', chapter: 0 },
      { characterId: 'hiori', collectionSlug: 'first', chapter: 2 },
    ])
  })

  it('未出场的人物返回空数组,而不是报错', async () => {
    const project = await seedProject()
    const result = await project.read({ kind: 'appearances', characterId: 'hiori' }, signal)
    if (result.kind !== 'appearances') throw new Error('期望出场投影')
    expect(result.appearances).toEqual([])
  })
})

describe('缺失的非清单资产', () => {
  it('返回修订号为 absent 的空资产,而不是报错', async () => {
    const project = openSerialProject(root, OPTIONS)
    await project.apply(INITIALIZE, signal)
    const read = await readAsset(project, { kind: 'world' }, signal)
    expect(read.revision).toBe('absent')
    expect(read.text).toBe('')
    expect(read.bytes).toBe(0)
    expect(read.omitted).toBe(true)
    expect(read.truncated).toBe(false)
  })
})

describe('取消', () => {
  it('已取消的信号在读写前即失败', async () => {
    const project = await seedProject()
    const aborted = AbortSignal.abort()
    await expect(project.read({ kind: 'world' }, aborted)).rejects.toThrow()
    await expect(project.apply({
      kind: 'replace', target: { kind: 'characters' }, baseRevision: 'absent',
      replacement: JSON.stringify(CHARACTERS), summary: '已取消',
    }, aborted)).rejects.toThrow()
  })

  // 取消**不**用 SerialProjectErrorCode 表示:项目层直接让 harness 原生的
  // AbortError 冒出来。这条断言把这个契约钉住 —— 否则以后有人顺手包一层
  // 'CANCELLED',调用方就多一个必须判别的分支。
  it('取消抛的是原生 AbortError,不是 SerialProjectError', async () => {
    const project = await seedProject()
    const error = await project.read({ kind: 'world' }, AbortSignal.abort())
      .then(() => undefined, (reason: unknown) => reason as Error)
    expect(error?.name).toBe('AbortError')
    expect(error).not.toBeInstanceOf(SerialProjectError)
  })
})

describe('读取时校验既有字节', () => {
  it('手改坏的 JSON 资产显式失败,不把坏内容喂给模型', async () => {
    const project = await seedProject()
    await mkdir(join(root, '.serial'), { recursive: true })
    await writeFile(join(root, '.serial', 'characters.json'), '{ not json', 'utf8')
    await expectCode(project.read({ kind: 'asset', target: { kind: 'characters' } }, signal), 'INVALID_CONTENT')
  })
})

// ── 步 3:领域模型扩容 ──────────────────────────────────────────────────────
//
// 扩容的字段一律**可选**,所以已写好的项目不需要迁移。这一组先钉住"旧字节仍然
// 合法",再验证新字段、故事线投影与投影收窄。

/** 步 3 之前形状的世界观:只有三个字段。 */
const LEGACY_WORLD = { setting: '海边小镇', locations: ['车站'], notes: '' }

/** 步 3 之前形状的短篇集蓝图:没有 threads。 */
const LEGACY_BLUEPRINT = {
  title: '第一集', theme: '主题', summary: '梗概', characterIds: ['hiori'], targetWords: 8000, status: 'planned',
}

/** 步 3 之前形状的章节蓝图:没有 threadIds。 */
const LEGACY_CHAPTER = {
  title: '第一章', keyBeats: ['起'], characterIds: ['hiori'], povCharacterId: 'hiori',
}

const THREADS = [
  { id: 'shared-clock', title: '共同时钟', summary: '所有线钉在同一条时间轴上' },
  { id: 'misread-color', title: '认错的应援色', summary: '色号搞错这件事的余波' },
]

/** 直接落盘原始字节,绕开规范化 —— 用来模拟"扩容之前就存在的文件"。 */
async function writeRaw(relative: string, text: string): Promise<void> {
  const absolute = join(root, relative)
  await mkdir(join(absolute, '..'), { recursive: true })
  await writeFile(absolute, text, 'utf8')
}

describe('步 3 扩容:旧字节无需迁移', () => {
  it('扩容之前形状的世界观/蓝图/章节蓝图仍然合法', async () => {
    const project = openSerialProject(root, OPTIONS)
    await project.apply(INITIALIZE, signal)
    await writeRaw(join('.serial', 'world.json'), `${JSON.stringify(LEGACY_WORLD)}\n`)
    await writeRaw(join('.serial', 'collections', 'first', 'blueprint.json'), `${JSON.stringify(LEGACY_BLUEPRINT)}\n`)
    await writeRaw(join('.serial', 'collections', 'first', 'chapters', '0001-blueprint.json'), `${JSON.stringify(LEGACY_CHAPTER)}\n`)

    const world = await readAsset(project, { kind: 'world' }, signal)
    expect(world.revision).not.toBe('absent')
    // 读回的是**盘上原样**的字节:读取不物化新字段,物化只发生在写入时。
    expect(JSON.parse(world.text)).toEqual(LEGACY_WORLD)

    const blueprint = await readAsset(project, { kind: 'collection-blueprint', slug: 'first' }, signal)
    expect(blueprint.revision).not.toBe('absent')

    const chapter = await readAsset(project, { kind: 'chapter-blueprint', slug: 'first', chapter: 1 }, signal)
    expect(chapter.revision).not.toBe('absent')

    // 没有声明故事线时,故事线投影为空 —— 而不是报错。
    const threads = await readThreads(project, signal)
    expect(threads.threads).toEqual([])
  })
})

describe('步 3 扩容:世界观与项目清单的新字段', () => {
  it('era/organizations/rules/glossary 可写可读', async () => {
    const project = await seedProject()
    const replacement = {
      setting: '当代偶像行业', locations: ['三号练习室'], notes: '',
      era: '当代', organizations: ['星耀事务所'], rules: ['月度小考', '季度大考核'],
      glossary: [{ term: '应援色', definition: '粉丝为艺人约定的颜色' }],
    }
    await project.apply({
      kind: 'replace', target: { kind: 'world' }, baseRevision: 'absent',
      replacement: JSON.stringify(replacement), summary: '扩充世界观',
    }, signal)
    const read = await readAsset(project, { kind: 'world' }, signal)
    expect(JSON.parse(read.text)).toEqual(replacement)
  })

  it('只给三个必填字段时,新字段被物化为空值', async () => {
    const project = await seedProject()
    await project.apply({
      kind: 'replace', target: { kind: 'world' }, baseRevision: 'absent',
      replacement: JSON.stringify(LEGACY_WORLD), summary: '只给必填',
    }, signal)
    const read = await readAsset(project, { kind: 'world' }, signal)
    // 物化是刻意的:否则 `era: ""` 与省略 `era` 语义相同却字节不同,会算出两个
    // 修订号,制造假冲突。规范化必须幂等。
    expect(JSON.parse(read.text)).toEqual({ ...LEGACY_WORLD, era: '', organizations: [], rules: [], glossary: [] })
  })

  it('glossary 条目缺字段被拒', async () => {
    const project = await seedProject()
    await expectCode(project.apply({
      kind: 'replace', target: { kind: 'world' }, baseRevision: 'absent',
      replacement: JSON.stringify({ ...LEGACY_WORLD, glossary: [{ term: '应援色' }] }), summary: '缺 definition',
    }, signal), 'INVALID_CONTENT')
  })

  it('project 接受 writingRules,且 worldId 不可更改', async () => {
    const project = await seedProject()
    const projectText = await readAsset(project, { kind: 'project' }, signal)
    const current = JSON.parse(projectText.text) as Record<string, unknown>

    await project.apply({
      kind: 'replace', target: { kind: 'project' }, baseRevision: projectText.revision,
      replacement: JSON.stringify({ ...current, writingRules: ['现实向', '单一限知视角'] }), summary: '补创作方针',
    }, signal)
    const after = await readAsset(project, { kind: 'project' }, signal)
    expect(JSON.parse(after.text).writingRules).toEqual(['现实向', '单一限知视角'])

    await expectCode(project.apply({
      kind: 'replace', target: { kind: 'project' }, baseRevision: after.revision,
      replacement: JSON.stringify({ ...JSON.parse(after.text), worldId: 'another-world' }), summary: '改世界身份',
    }, signal), 'INVALID_CONTENT')
  })
})

describe('步 3 扩容:故事线', () => {
  /** 建立一集、声明两条线,并给若干章蓝图标记推进。 */
  async function seed(threadIdsByChapter: readonly (readonly string[])[]): Promise<SerialProject> {
    const project = await seedProject()
    await project.apply({
      kind: 'replace', target: { kind: 'collection-blueprint', slug: 'first' }, baseRevision: 'absent',
      replacement: JSON.stringify({ ...LEGACY_BLUEPRINT, threads: THREADS }), summary: '声明故事线',
    }, signal)
    for (const [index, threadIds] of threadIdsByChapter.entries()) {
      await project.apply({
        kind: 'replace', target: { kind: 'chapter-blueprint', slug: 'first', chapter: index + 1 }, baseRevision: 'absent',
        replacement: JSON.stringify({ ...LEGACY_CHAPTER, threadIds }), summary: `第 ${index + 1} 章蓝图`,
      }, signal)
    }
    return project
  }

  it('投影出每条线出自哪个集、哪些章节推进过它', async () => {
    const project = await seed([['shared-clock'], ['shared-clock', 'misread-color']])
    const result = await readThreads(project, signal)
    expect(result.threads).toEqual([
      { collectionSlug: 'first', id: 'shared-clock', title: '共同时钟', summary: '所有线钉在同一条时间轴上', advances: [1, 2] },
      { collectionSlug: 'first', id: 'misread-color', title: '认错的应援色', summary: '色号搞错这件事的余波', advances: [2] },
    ])
  })

  it('一条都没推进过的线 advances 为空,而不是消失', async () => {
    const project = await seed([])
    const result = await readThreads(project, signal)
    expect(result.threads.map(thread => thread.advances)).toEqual([[], []])
  })

  it('引用未声明线的 threadIds 被忽略,不会凭空造线', async () => {
    const project = await seed([['shared-clock', 'typo-line']])
    const result = await readThreads(project, signal)
    expect(result.threads.map(thread => thread.id)).toEqual(['shared-clock', 'misread-color'])
  })

  it('故事线 id 重复被拒', async () => {
    const project = await seedProject()
    await expectCode(project.apply({
      kind: 'replace', target: { kind: 'collection-blueprint', slug: 'first' }, baseRevision: 'absent',
      replacement: JSON.stringify({ ...LEGACY_BLUEPRINT, threads: [THREADS[0], THREADS[0]] }), summary: '重复线 id',
    }, signal), 'INVALID_CONTENT')
  })

  it('故事线 id 形态非法被拒', async () => {
    const project = await seedProject()
    await expectCode(project.apply({
      kind: 'replace', target: { kind: 'collection-blueprint', slug: 'first' }, baseRevision: 'absent',
      replacement: JSON.stringify({ ...LEGACY_BLUEPRINT, threads: [{ ...THREADS[0], id: 'Not Valid' }] }), summary: '非法线 id',
    }, signal), 'INVALID_CONTENT')
  })

  it('章节里重复的 threadIds 被拒', async () => {
    const project = await seedProject()
    await expectCode(project.apply({
      kind: 'replace', target: { kind: 'chapter-blueprint', slug: 'first', chapter: 1 }, baseRevision: 'absent',
      replacement: JSON.stringify({ ...LEGACY_CHAPTER, threadIds: ['shared-clock', 'shared-clock'] }), summary: '重复引用',
    }, signal), 'INVALID_CONTENT')
  })
})

describe('步 3 扩容:投影收窄', () => {
  it('kind="world" 带 slug 只返回该集蓝图,人物仍全给', async () => {
    const project = await seedProject()
    for (const slug of ['first', 'second']) {
      await project.apply({
        kind: 'replace', target: { kind: 'collection-blueprint', slug }, baseRevision: 'absent',
        replacement: JSON.stringify({ ...LEGACY_BLUEPRINT, title: slug }), summary: `${slug} 蓝图`,
      }, signal)
    }

    const all = await project.read({ kind: 'world' }, signal)
    if (all.kind !== 'world') throw new Error('期望世界投影')
    expect(all.collections.map(collection => collection.slug)).toEqual(['first', 'second'])

    const narrowed = await project.read({ kind: 'world', slug: 'second' }, signal)
    if (narrowed.kind !== 'world') throw new Error('期望世界投影')
    expect(narrowed.collections.map(collection => collection.slug)).toEqual(['second'])
    // 人物是世界观层共享的,收窄不影响它。
    expect(narrowed.characters.map(character => character.id)).toEqual(['hiori'])
  })

  it('kind="threads" 带 slug 只返回该集的故事线', async () => {
    const project = await seedProject()
    await project.apply({
      kind: 'replace', target: { kind: 'collection-blueprint', slug: 'first' }, baseRevision: 'absent',
      replacement: JSON.stringify({ ...LEGACY_BLUEPRINT, threads: [THREADS[0]] }), summary: '第一集的线',
    }, signal)
    await project.apply({
      kind: 'replace', target: { kind: 'collection-blueprint', slug: 'second' }, baseRevision: 'absent',
      replacement: JSON.stringify({ ...LEGACY_BLUEPRINT, threads: [THREADS[1]] }), summary: '第二集的线',
    }, signal)

    const all = await readThreads(project, signal)
    expect(all.threads.map(thread => thread.id)).toEqual(['shared-clock', 'misread-color'])

    const narrowed = await project.read({ kind: 'threads', slug: 'second' }, signal)
    if (narrowed.kind !== 'threads') throw new Error('期望故事线投影')
    expect(narrowed.threads.map(thread => thread.id)).toEqual(['misread-color'])
  })
})
