/**
 * 两端巡检**必须一致**。
 *
 * 巡检有两个调用方:Host 侧 `serial_read kind="audit"`(给模型)与面板(给人)。判定
 * 本身已经收敛成 `src/serial-audit.ts` 里的同一个纯函数,所以唯一可能分歧的地方是
 * **输入是怎么凑出来的** —— Host 从文件系统读,面板从 Remote 读。若面板漏掉一个字段
 * (例如 `hasTimeline` 或 `povCharacterId`),两边的结论就会不一样,而那时模型说"没问题"、
 * 面板说"有问题",两边都不算错。
 *
 * 这个测试因此不看"两边各自对不对",而是**把同一个真实项目同时喂给两条路径**,
 * 断言结论逐条相同。它也是面板侧那套输入构造唯一的端到端覆盖。
 */

import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openSerialProject } from '../src/serial-project.ts'
import {
  loadProject,
  type SerialRemoteResult,
  type SerialWorkspaceFileEntry,
  type SerialWorkspaceFiles,
} from '../src/client/serial-files.ts'
import type { SerialAuditResult, SerialInitializeRequest, WorldId } from '../src/types.ts'

const OPTIONS = { assetBytes: 64 * 1024, workingSetBytes: 64 * 1024, queryMatches: 40 }

const INITIALIZE: SerialInitializeRequest = {
  kind: 'initialize',
  worldId: '11111111-2222-4333-8444-555555555555' as WorldId,
  worldName: '初雪',
  language: 'zh-CN',
  tone: '克制',
  creativeStrategy: 'consistency-first',
  createdAt: '2026-10-03T00:00:00.000Z',
  updatedAt: '2026-10-03T00:00:00.000Z',
}

let root: string
let signal: AbortSignal

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'serial-audit-parity-'))
  signal = new AbortController().signal
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

/** 递归读出真实目录,造一个以它为后端的 `workspaceFiles` 替身。 */
async function filesOverRealDirectory(): Promise<SerialWorkspaceFiles> {
  return {
    async list(_sessionId, path): Promise<SerialRemoteResult<{ entries: readonly SerialWorkspaceFileEntry[]; truncated: boolean }>> {
      const absolute = join(root, path)
      try {
        const entries = await readdir(absolute, { withFileTypes: true })
        return {
          ok: true,
          value: {
            entries: await Promise.all(entries.map(async (entry): Promise<SerialWorkspaceFileEntry> => entry.isDirectory()
              ? { name: entry.name, type: 'directory' }
              : { name: entry.name, type: 'file', size: (await stat(join(absolute, entry.name))).size })),
            truncated: false,
          },
        }
      } catch {
        // 面板把"目录不存在"当作空清单,所以这里也返回 ok。
        return { ok: true, value: { entries: [], truncated: false } }
      }
    },
    async readBytes(_sessionId, path) {
      try {
        const data = await readFile(join(root, path))
        return {
          ok: true,
          value: { absolutePath: join(root, path), version: 'v1', bytes: data.byteLength, data: new Uint8Array(data), eof: true },
        }
      } catch {
        return { ok: false, error: { message: `missing ${path}` } }
      }
    },
  }
}

/** 造一个**到处是缺口**的项目:两端都应该逐条报出同样的问题。 */
async function seedGappedProject(): Promise<void> {
  const project = openSerialProject(root, OPTIONS)
  await project.apply(INITIALIZE, signal)
  await project.apply({
    kind: 'replace', target: { kind: 'characters' }, baseRevision: 'absent',
    replacement: JSON.stringify({
      items: [
        { id: 'hiori', name: '灯织', role: '主角', summary: 's', goal: 'g', voice: 'v', background: 'b' },
        { id: 'referenced', name: '被章引用', role: '配角', summary: 's', goal: 'g', voice: 'v', background: 'b' },
        { id: 'unused-person', name: '没人引用', role: '配角', summary: 's', goal: 'g', voice: 'v', background: 'b' },
      ],
    }), summary: '人物档案',
  }, signal)
  // 只声明一条线,另一条由章节引用却不声明 —— 制造 `thread.undeclared`。
  await project.apply({
    kind: 'replace', target: { kind: 'collection-blueprint', slug: 'first' }, baseRevision: 'absent',
    replacement: JSON.stringify({
      title: '初雪', theme: 't', summary: 's',
      characterIds: ['hiori', 'ghost'], targetWords: 8000, status: 'planned',
      threads: [
        { id: 'declared-never-advanced', title: '声明了没人推进', summary: 's' },
        { id: 'first-snow', title: '初雪', summary: 's' },
      ],
    }), summary: '第一集',
  }, signal)
  // 刻意**不写** timeline.json —— 制造 `collection.timeline.missing`。
  // 第 1 章:有正文没蓝图 —— 制造 `chapter.blueprint.missing`。
  await project.apply({
    kind: 'replace', target: { kind: 'chapter-draft', slug: 'first', chapter: 1 }, baseRevision: 'absent',
    replacement: '# 开场\n', summary: '第 1 章正文',
  }, signal)
  // 第 2 章:有蓝图没正文,且引用了未声明的人物与未声明的线,视角人物也没声明。
  await project.apply({
    kind: 'replace', target: { kind: 'chapter-blueprint', slug: 'first', chapter: 2 }, baseRevision: 'absent',
    replacement: JSON.stringify({
      title: '第二章', keyBeats: ['起'], characterIds: ['referenced'],
      povCharacterId: 'not-declared', threadIds: ['first-snow', 'never-declared'],
    }), summary: '第 2 章蓝图',
  }, signal)
}

/** 把巡检发现归一成可逐条比较的字符串(顺序也会被比到)。 */
function normalize(audit: SerialAuditResult): readonly string[] {
  return audit.findings.map(finding => `${finding.severity}|${finding.code}|${finding.where}|${finding.detail}`)
}

describe('两端巡检一致性', () => {
  it('同一个真实项目:Host 侧与面板侧逐条相同', async () => {
    await seedGappedProject()
    const project = openSerialProject(root, OPTIONS)

    const rawHostAudit = await project.read({ kind: 'audit' }, signal)
    if (rawHostAudit.kind !== 'audit') throw new Error('期望巡检结果')
    const hostAudit = rawHostAudit

    const clientSnapshot = await loadProject(await filesOverRealDirectory(), 'session-1', signal)
    if (clientSnapshot.kind !== 'ready') throw new Error('期望 ready')

    // 这个项目**确实**到处是缺口,否则这条测试会因为"两边都报空"而毫无意义。
    expect(hostAudit.findings.length).toBeGreaterThanOrEqual(6)
    expect(normalize(clientSnapshot.audit)).toEqual(normalize(hostAudit))
    expect(clientSnapshot.audit.collections).toBe(hostAudit.collections)
    expect(clientSnapshot.audit.chapters).toBe(hostAudit.chapters)
  })

  it('覆盖到每一类缺口(避免"两边都漏同一个字段"这种假一致)', async () => {
    await seedGappedProject()
    const project = openSerialProject(root, OPTIONS)
    const hostAudit = await project.read({ kind: 'audit' }, signal)
    if (hostAudit.kind !== 'audit') throw new Error('期望巡检结果')
    const codes = new Set(hostAudit.findings.map(finding => finding.code))

    // 逐类点名:少哪一类,就说明两端共用的输入构造在该字段上有个洞。
    for (const expected of [
      'collection.timeline.missing',
      'chapter.blueprint.missing',
      'chapter.draft.missing',
      'character.undeclared',
      'thread.undeclared',
      'thread.unadvanced',
      'character.unused',
    ]) {
      expect(codes, `缺少 ${expected}`).toContain(expected)
    }
  })

  it('干净项目两端同样一致(都只报真实存在的缺口)', async () => {
    const project = openSerialProject(root, OPTIONS)
    await project.apply(INITIALIZE, signal)
    await project.apply({
      kind: 'replace', target: { kind: 'world' }, baseRevision: 'absent',
      replacement: JSON.stringify({ setting: '海边小镇', locations: [], notes: '' }), summary: '设定',
    }, signal)
    await project.apply({
      kind: 'replace', target: { kind: 'characters' }, baseRevision: 'absent',
      replacement: JSON.stringify({
        items: [{ id: 'hiori', name: '灯织', role: '主角', summary: 's', goal: 'g', voice: 'v', background: 'b' }],
      }), summary: '人物档案',
    }, signal)
    await project.apply({
      kind: 'replace', target: { kind: 'collection-blueprint', slug: 'first' }, baseRevision: 'absent',
      replacement: JSON.stringify({
        title: '初雪', theme: 't', summary: 's', characterIds: ['hiori'], targetWords: 8000, status: 'in-progress',
        threads: [{ id: 'first-snow', title: '初雪', summary: 's' }],
      }), summary: '第一集',
    }, signal)
    await project.apply({
      kind: 'replace', target: { kind: 'collection-timeline', slug: 'first' }, baseRevision: 'absent',
      replacement: JSON.stringify({ season: '冬', startDate: '2026-11-01', endDate: '', keyDates: [] }), summary: '时间线',
    }, signal)
    await project.apply({
      kind: 'replace', target: { kind: 'chapter-blueprint', slug: 'first', chapter: 1 }, baseRevision: 'absent',
      replacement: JSON.stringify({
        title: '开场', keyBeats: ['雪'], characterIds: ['hiori'], povCharacterId: 'hiori', threadIds: ['first-snow'],
      }), summary: '第 1 章蓝图',
    }, signal)
    await project.apply({
      kind: 'replace', target: { kind: 'chapter-draft', slug: 'first', chapter: 1 }, baseRevision: 'absent',
      replacement: '# 开场\n', summary: '第 1 章正文',
    }, signal)

    const hostAudit = await project.read({ kind: 'audit' }, signal)
    if (hostAudit.kind !== 'audit') throw new Error('期望巡检结果')
    const clientSnapshot = await loadProject(await filesOverRealDirectory(), 'session-1', signal)
    if (clientSnapshot.kind !== 'ready') throw new Error('期望 ready')

    // 一个结构完整的项目:一条发现都不该有。
    expect(normalize(hostAudit)).toEqual([])
    expect(normalize(clientSnapshot.audit)).toEqual([])
  })
})
