/**
 * 跨集巡检与人物编年史(步 6)。
 *
 * 两个投影都是**只读派生视图**:它们存在的意义是把"集一多就看不见"的结构问题报
 * 出来,以及把"人物跨集走过了哪些站"排出来。两条底线在这里被钉住:
 *
 * - 巡检只报告,不改任何东西,也不因为发现问题就让读取失败;
 * - 编年史**不发明顺序、不发明状态** —— 没有时间锚的集不会被硬塞进时间线。
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openSerialProject } from '../src/serial-project.ts'
import type { SerialProject } from '../src/serial-project.ts'
import type { SerialInitializeRequest, WorldId } from '../src/types.ts'

const OPTIONS = { assetBytes: 64 * 1024, workingSetBytes: 64 * 1024, queryMatches: 40 }

const INITIALIZE: SerialInitializeRequest = {
  kind: 'initialize',
  worldId: '11111111-2222-4333-8444-555555555555' as WorldId,
  worldName: '应援色',
  language: 'zh-CN',
  tone: '克制',
  creativeStrategy: 'consistency-first',
  createdAt: '2026-10-03T00:00:00.000Z',
  updatedAt: '2026-10-03T00:00:00.000Z',
}

const CHARACTERS = {
  items: [
    { id: 'tingwan', name: '周听晚', role: '练习生', summary: 's', goal: 'g', voice: 'v', background: 'b' },
    { id: 'unused', name: '没人用', role: '练习生', summary: 's', goal: 'g', voice: 'v', background: 'b' },
  ],
}

let root: string
let signal: AbortSignal

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'serial-cross-'))
  signal = new AbortController().signal
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

/** 建好项目并写入人物档案(刻意**不**写 world.json,以便观察 world.missing)。 */
async function seed(): Promise<SerialProject> {
  const project = openSerialProject(root, OPTIONS)
  await project.apply(INITIALIZE, signal)
  await project.apply({
    kind: 'replace', target: { kind: 'characters' }, baseRevision: 'absent',
    replacement: JSON.stringify(CHARACTERS), summary: '人物档案',
  }, signal)
  return project
}

async function audit(project: SerialProject) {
  const result = await project.read({ kind: 'audit' }, signal)
  if (result.kind !== 'audit') throw new Error('期望巡检结果')
  return result
}

async function chronicle(project: SerialProject, characterId: string) {
  const result = await project.read({ kind: 'chronicle', characterId }, signal)
  if (result.kind !== 'chronicle') throw new Error('期望编年史')
  return result
}

/** 取某条稳定码的全部位置。 */
function codes(result: { readonly findings: readonly { readonly code: string; readonly where: string }[] }, code: string): string[] {
  return result.findings.filter(finding => finding.code === code).map(finding => finding.where)
}

describe('跨集巡检', () => {
  it('干净的项目只报"缺世界观""声明了却没人用"和"集里没有章"', async () => {
    const project = await seed()
    await project.apply({
      kind: 'replace', target: { kind: 'collection-blueprint', slug: 'first' }, baseRevision: 'absent',
      replacement: JSON.stringify({
        title: '第一集', theme: 't', summary: 's', characterIds: ['tingwan'], targetWords: 8000, status: 'planned',
      }), summary: '第一集',
    }, signal)
    await project.apply({
      kind: 'replace', target: { kind: 'collection-timeline', slug: 'first' }, baseRevision: 'absent',
      replacement: JSON.stringify({ season: '冬', startDate: '2026-11-01', endDate: '2027-03-01', keyDates: [] }),
      summary: '第一集时间线',
    }, signal)

    const result = await audit(project)
    // 三件都是事实:seed() 没写 world.json;这一集还没章节蓝图;`unused` 人物没人引。
    expect(result.findings.map(finding => finding.code).sort())
      .toEqual(['character.unused', 'collection.chapters.missing', 'world.missing'])
    expect(codes(result, 'character.unused')).toEqual(['unused'])
    expect(result.collections).toBe(1)
    expect(result.chapters).toBe(0)
  })

  it('有正文没蓝图的那一章被点名 —— 这正是 §6.8 的缺口', async () => {
    const project = await seed()
    await project.apply({
      kind: 'replace', target: { kind: 'collection-blueprint', slug: 'first' }, baseRevision: 'absent',
      replacement: JSON.stringify({
        title: '第一集', theme: 't', summary: 's', characterIds: ['tingwan'], targetWords: 8000, status: 'planned',
      }), summary: '第一集',
    }, signal)
    await project.apply({
      kind: 'replace', target: { kind: 'chapter-draft', slug: 'first', chapter: 1 }, baseRevision: 'absent',
      replacement: '正文写好了,蓝图没写', summary: '第一章正文',
    }, signal)

    const result = await audit(project)
    const finding = result.findings.find(entry => entry.code === 'chapter.blueprint.missing')
    expect(finding?.where).toBe('first#1')
    expect(finding?.detail).toContain('有正文没有章节蓝图')
    expect(result.chapters).toBe(1)
  })

  it('引用了未声明的人物 / 未声明的线都是 error', async () => {
    const project = await seed()
    await project.apply({
      kind: 'replace', target: { kind: 'collection-blueprint', slug: 'first' }, baseRevision: 'absent',
      replacement: JSON.stringify({
        title: '第一集', theme: 't', summary: 's',
        characterIds: ['tingwan', 'ghost'], targetWords: 8000, status: 'planned',
        threads: [{ id: 'clock', title: '时钟', summary: 's' }],
      }), summary: '第一集',
    }, signal)
    await project.apply({
      kind: 'replace', target: { kind: 'chapter-blueprint', slug: 'first', chapter: 2 }, baseRevision: 'absent',
      replacement: JSON.stringify({
        title: '第二章', keyBeats: ['起'], characterIds: ['nobody'], povCharacterId: 'tingwan',
        threadIds: ['typo-line'],
      }), summary: '第二章蓝图',
    }, signal)

    const findings = (await audit(project)).findings
    const errors = findings.filter(finding => finding.severity === 'error')
    expect(errors.map(finding => finding.code).sort()).toEqual([
      'character.undeclared', 'character.undeclared', 'thread.undeclared',
    ])
    expect(errors.every(finding => finding.where.startsWith('first'))).toBe(true)
    // 声明了却没被推进的线仍是 warning。
    expect(findings.some(finding => finding.code === 'thread.unadvanced')).toBe(true)
  })

  it('缺时间线的集被指出无法进编年史,而不是被静默排序', async () => {
    const project = await seed()
    await project.apply({
      kind: 'replace', target: { kind: 'collection-blueprint', slug: 'no-date' }, baseRevision: 'absent',
      replacement: JSON.stringify({
        title: '没有时间锚', theme: 't', summary: 's', characterIds: [], targetWords: 8000, status: 'planned',
      }), summary: '缺时间线的一集',
    }, signal)

    const finding = (await audit(project)).findings.find(entry => entry.code === 'collection.timeline.missing')
    expect(finding?.where).toBe('no-date')
    expect(finding?.detail).toContain('无时间锚')
  })

  it('巡检不修改任何文件', async () => {
    const project = await seed()
    const before = await project.read({ kind: 'world' }, signal)
    await audit(project)
    const after = await project.read({ kind: 'world' }, signal)
    expect(after).toEqual(before)
  })

  it('发现数受 queryMatches 限制,并如实标记截断', async () => {
    const limited = openSerialProject(root, { ...OPTIONS, queryMatches: 1 })
    await limited.apply(INITIALIZE, signal)
    await limited.apply({
      kind: 'replace', target: { kind: 'characters' }, baseRevision: 'absent',
      replacement: JSON.stringify(CHARACTERS), summary: '人物档案',
    }, signal)
    const result = await audit(limited)
    expect(result.findings).toHaveLength(1)
    expect(result.truncated).toBe(true)
  })
})

describe('跨集人物编年史', () => {
  /** 造一集:蓝图 + 可选时间线 + 可选章节蓝图。 */
  async function collection(
    project: SerialProject,
    slug: string,
    options: { startDate?: string; chapters?: readonly { chapter: number; characterIds: readonly string[]; pov: string }[] },
  ): Promise<void> {
    await project.apply({
      kind: 'replace', target: { kind: 'collection-blueprint', slug }, baseRevision: 'absent',
      replacement: JSON.stringify({
        title: `集 ${slug}`, theme: 't', summary: 's', characterIds: ['tingwan'], targetWords: 8000, status: 'planned',
      }), summary: `${slug} 蓝图`,
    }, signal)
    if (options.startDate !== undefined) {
      await project.apply({
        kind: 'replace', target: { kind: 'collection-timeline', slug }, baseRevision: 'absent',
        replacement: JSON.stringify({ season: '冬', startDate: options.startDate, endDate: '', keyDates: [] }),
        summary: `${slug} 时间线`,
      }, signal)
    }
    for (const chapter of options.chapters ?? []) {
      await project.apply({
        kind: 'replace', target: { kind: 'chapter-blueprint', slug, chapter: chapter.chapter }, baseRevision: 'absent',
        replacement: JSON.stringify({
          title: `第 ${chapter.chapter} 章`, keyBeats: ['起'],
          characterIds: chapter.characterIds, povCharacterId: chapter.pov,
        }), summary: `${slug} 第 ${chapter.chapter} 章蓝图`,
      }, signal)
    }
  }

  it('有时间锚的集按时间升序,没锚的集单独列出', async () => {
    const project = await seed()
    await collection(project, 'later', { startDate: '2027-03-01', chapters: [{ chapter: 2, characterIds: ['tingwan'], pov: 'tingwan' }] })
    await collection(project, 'earlier', { startDate: '2026-11-01', chapters: [{ chapter: 1, characterIds: ['tingwan'], pov: 'tingwan' }] })
    await collection(project, 'undated', {})

    const result = await chronicle(project, 'tingwan')
    expect(result.ordered.map(stop => stop.collectionSlug)).toEqual(['earlier', 'later'])
    // 没有时间锚的集**不会**被塞进 ordered,也不会被丢掉。
    expect(result.undated.map(stop => stop.collectionSlug)).toEqual(['undated'])
  })

  it('station 上带章号与视角标记', async () => {
    const project = await seed()
    await collection(project, 'first', {
      startDate: '2026-11-01',
      chapters: [
        { chapter: 1, characterIds: ['tingwan'], pov: 'tingwan' },
        { chapter: 2, characterIds: [], pov: 'tingwan' },
      ],
    })

    const result = await chronicle(project, 'tingwan')
    const stop = result.ordered[0]
    expect(stop.chapters).toEqual([1])
    expect(stop.pov).toBe(true)
    expect(stop.wholeCollection).toBe(true)
    expect(stop.startDate).toBe('2026-11-01')
    expect(stop.title).toBe('集 first')
  })

  it('整集声明但章级从未出现的人物:wholeCollection 为真、chapters 为空', async () => {
    const project = await seed()
    await collection(project, 'first', { startDate: '2026-11-01' })

    const result = await chronicle(project, 'tingwan')
    expect(result.ordered[0]).toEqual({
      collectionSlug: 'first', title: '集 first', season: '冬', startDate: '2026-11-01', endDate: '',
      chapters: [], pov: false, wholeCollection: true,
    })
  })

  it('完全没出现过的人物:两栏都空', async () => {
    const project = await seed()
    await collection(project, 'first', { startDate: '2026-11-01' })
    const result = await chronicle(project, 'unused')
    expect(result.ordered).toEqual([])
    expect(result.undated).toEqual([])
  })

  it('缺人物档案不影响编年史读取(仍按蓝图给出站点)', async () => {
    const project = openSerialProject(root, OPTIONS)
    await project.apply(INITIALIZE, signal)
    await collection(project, 'first', { startDate: '2026-11-01' })
    const result = await chronicle(project, 'tingwan')
    expect(result.ordered.map(stop => stop.collectionSlug)).toEqual(['first'])
  })
})
