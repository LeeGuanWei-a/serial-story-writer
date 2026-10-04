/**
 * 非权威提案收件箱的行为测试。
 *
 * 这一层最要紧的两件事:
 * 1. **提案不改变项目**。"记录了一条建议"与"项目变了"必须能被区分开,否则
 *    模型会把 pending 说成已落盘 —— 那是这个功能最容易撒的谎。
 * 2. **幂等**。同一个规范化命令重复提交不产生第二条,否则收件箱会被同一堆
 *    建议灌满。
 */

import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createSerialV2ToolDefinitions } from '../src/agent.ts'
import {
  assertProposalProjectState,
  normalizeProposalCommand,
  openSerialInbox,
  proposalSummary,
  type SerialProposalInboxOptions,
} from '../src/proposal-inbox.ts'
import { openSerialProject } from '../src/serial-project.ts'
import {
  SerialProjectError,
  type SerialInitializeRequest,
  type SerialProposalCommand,
  type WorldId,
} from '../src/types.ts'

const INBOX: SerialProposalInboxOptions = { maxProposalBytes: 64 * 1024, maxPendingProposals: 3 }

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

const IDENTITY = { sessionId: 'session-1', callId: 'call-1' }

let root: string
let signal: AbortSignal

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'serial-inbox-'))
  signal = new AbortController().signal
  await openSerialProject(root, { assetBytes: 1 << 20, workingSetBytes: 1 << 20, queryMatches: 20 })
    .apply(INITIALIZE, signal)
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

/** 一条内容合法的 world 替换建议。 */
function worldProposal(notes = '海边小镇'): SerialProposalCommand {
  return normalizeProposalCommand({
    kind: 'replaceAsset',
    target: { kind: 'world' },
    baseRevision: 'absent',
    nextValue: JSON.stringify({ setting: '当代偶像行业', locations: [], notes }),
    summary: '建立共享设定',
  })
}

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  await expect(promise).rejects.toBeInstanceOf(SerialProjectError)
  await promise.catch((error: SerialProjectError) => {
    expect(error.code).toBe(code)
  })
}

describe('记录提案', () => {
  it('收据明确说明它不是写入', async () => {
    const inbox = openSerialInbox(root, INBOX)
    const receipt = await inbox.propose(worldProposal(), '建立共享设定', IDENTITY, signal)

    expect(receipt.authoritative).toBe(false)
    expect(receipt.status).toBe('pending')
    expect(receipt.created).toBe(true)
    expect(receipt.changeSetId).toMatch(/^[0-9a-f]{64}$/)
    expect(receipt.pendingCount).toBe(1)
  })

  it('落地之后项目本身一个字节都没变', async () => {
    const before = await readdir(join(root, '.serial'))
    const inbox = openSerialInbox(root, INBOX)
    await inbox.propose(worldProposal(), '建立共享设定', IDENTITY, signal)

    const after = await readdir(join(root, '.serial'))
    expect(after.sort()).toEqual([...before, 'inbox'].sort())
    // world.json 依然不存在 —— 提案没有写任何项目资产。
    await expect(readFile(join(root, '.serial', 'world.json'), 'utf8')).rejects.toThrow()
  })

  it('身份由 Host 落盘,不来自模型', async () => {
    const inbox = openSerialInbox(root, INBOX)
    const receipt = await inbox.propose(worldProposal(), '建立共享设定', IDENTITY, signal)
    const stored = JSON.parse(await readFile(join(root, '.serial', 'inbox', `${receipt.proposalId}.json`), 'utf8')) as {
      identity: { sessionId: string; callId: string }
    }
    expect(stored.identity).toEqual(IDENTITY)
  })

  it('list 按时间升序返回', async () => {
    const inbox = openSerialInbox(root, INBOX)
    await inbox.propose(worldProposal('第一版'), '第一条', IDENTITY, signal)
    await inbox.propose(worldProposal('第二版'), '第二条', IDENTITY, signal)
    const records = await inbox.list(signal)
    expect(records.map(record => record.summary)).toEqual(['第一条', '第二条'])
  })
})

describe('幂等', () => {
  it('同一个命令重复提交不产生第二条,返回既有收据', async () => {
    const inbox = openSerialInbox(root, INBOX)
    const first = await inbox.propose(worldProposal(), '建立共享设定', IDENTITY, signal)
    const second = await inbox.propose(worldProposal(), '建立共享设定', IDENTITY, signal)

    expect(second.created).toBe(false)
    expect(second.proposalId).toBe(first.proposalId)
    expect(second.pendingCount).toBe(1)
    expect(await inbox.list(signal)).toHaveLength(1)
  })

  it('排版不同但语义相同 ⇒ 同一个幂等键', async () => {
    const inbox = openSerialInbox(root, INBOX)
    const compact = normalizeProposalCommand({
      kind: 'replaceAsset',
      target: { kind: 'world' },
      baseRevision: 'absent',
      nextValue: '{"setting":"海边","locations":[],"notes":""}',
      summary: 'a',
    })
    const pretty = normalizeProposalCommand({
      kind: 'replaceAsset',
      target: { kind: 'world' },
      baseRevision: 'absent',
      nextValue: '{\n  "setting": "海边",\n  "locations": [],\n  "notes": ""\n}\n',
      summary: 'b',
    })

    await inbox.propose(compact, 'a', IDENTITY, signal)
    const second = await inbox.propose(pretty, 'b', IDENTITY, signal)
    expect(second.created).toBe(false)
    expect(await inbox.list(signal)).toHaveLength(1)
  })

  // baseRevision 是并发令牌而不是措辞,所以它**参与**幂等键:否则重提会命中一条
  // 带着旧令牌的条目,将来谁按它落盘都会撞 STALE_REVISION。
  it('同样的内容配不同的 baseRevision 算两条', async () => {
    const inbox = openSerialInbox(root, INBOX)
    const atAbsent = normalizeProposalCommand({
      kind: 'replaceAsset', target: { kind: 'world' }, baseRevision: 'absent',
      nextValue: '{"setting":"海边","locations":[],"notes":""}', summary: 'a',
    })
    const atSomeRevision = normalizeProposalCommand({
      kind: 'replaceAsset', target: { kind: 'world' }, baseRevision: 'a'.repeat(64),
      nextValue: '{"setting":"海边","locations":[],"notes":""}', summary: 'a',
    })
    await inbox.propose(atAbsent, 'a', IDENTITY, signal)
    expect((await inbox.propose(atSomeRevision, 'a', IDENTITY, signal)).created).toBe(true)
    expect(await inbox.list(signal)).toHaveLength(2)
  })

  it('内容不同则是两条', async () => {
    const inbox = openSerialInbox(root, INBOX)
    await inbox.propose(worldProposal('甲'), '甲', IDENTITY, signal)
    const second = await inbox.propose(worldProposal('乙'), '乙', IDENTITY, signal)
    expect(second.created).toBe(true)
    expect(await inbox.list(signal)).toHaveLength(2)
  })
})

describe('上限', () => {
  it('待审阅条数达上限后拒绝新提案', async () => {
    const inbox = openSerialInbox(root, INBOX)
    for (const note of ['甲', '乙', '丙']) {
      await inbox.propose(worldProposal(note), note, IDENTITY, signal)
    }
    await expectCode(inbox.propose(worldProposal('丁'), '丁', IDENTITY, signal), 'SIZE_LIMIT_EXCEEDED')
    // 达上限时,重复提交既有提案仍然走幂等分支,不该被上限挡住。
    const duplicate = await inbox.propose(worldProposal('甲'), '甲', IDENTITY, signal)
    expect(duplicate.created).toBe(false)
  })

  it('单条提案超过 maxProposalBytes 被拒', async () => {
    const inbox = openSerialInbox(root, { maxProposalBytes: 200, maxPendingProposals: 10 })
    await expectCode(inbox.propose(worldProposal('长'.repeat(400)), '过大', IDENTITY, signal), 'SIZE_LIMIT_EXCEEDED')
  })
})

describe('建议必须先合法', () => {
  it('未知字段在记录时就被拒(与写入路径同一套校验)', () => {
    expect(() => normalizeProposalCommand({
      kind: 'replaceAsset',
      target: { kind: 'world' },
      baseRevision: 'absent',
      nextValue: JSON.stringify({ setting: 'x', locations: [], notes: '', era: 'y', 未知名: 1 }),
      summary: 's',
    })).toThrow(SerialProjectError)
  })

  it('未知命令 kind 被拒', () => {
    expect(() => normalizeProposalCommand({ kind: 'renameWorld' })).toThrow(SerialProjectError)
  })

  it('越权 slug 以 PATH_REJECTED 失败', () => {
    try {
      normalizeProposalCommand({ kind: 'deleteCollection', slug: '../../etc', summary: 's' })
      throw new Error('应当被拒')
    } catch (error) {
      expect((error as SerialProjectError).code).toBe('PATH_REJECTED')
    }
  })

  it('newCollection 校验蓝图与时间线,并允许 blueprint 不带 slug 之外的字段', () => {
    const command = normalizeProposalCommand({
      kind: 'newCollection',
      blueprint: {
        slug: 'cheer-color', title: '应援色', theme: '主题', summary: '梗概',
        characterIds: ['hiori'], targetWords: 8000, status: 'planned',
      },
      timeline: { season: '冬', startDate: '2026-11-01', endDate: '2027-03-01', keyDates: ['十一月小考'] },
      summary: '新开一集',
    })
    expect(command.kind).toBe('newCollection')

    // 蓝图里少一个必填字段就该被拒 —— 校验用的是写入路径那一套。
    expect(() => normalizeProposalCommand({
      kind: 'newCollection',
      blueprint: { slug: 'x', title: 't' },
      timeline: { season: '冬', startDate: 'a', endDate: 'b', keyDates: [] },
      summary: 's',
    })).toThrow(SerialProjectError)
  })

  it('坏字节的既有提案以稳定的 INVALID_CONTENT 失败', async () => {
    const dir = join(root, '.serial', 'inbox')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, '00000000000001-deadbeef.json'), '{ not json', 'utf8')
    await expectCode(openSerialInbox(root, INBOX).list(signal), 'INVALID_CONTENT')
  })
})

describe('项目状态守卫', () => {
  it('只有 initialize 建议允许在未初始化时提出', () => {
    const initialize = normalizeProposalCommand({ kind: 'initialize', nextValue: INITIALIZE })
    expect(() => assertProposalProjectState(initialize, false)).not.toThrow()
    expect(() => assertProposalProjectState(initialize, true)).toThrow(SerialProjectError)
    expect(() => assertProposalProjectState(worldProposal(), false)).toThrow(SerialProjectError)
    expect(() => assertProposalProjectState(worldProposal(), true)).not.toThrow()
  })
})

describe('供人看的一句话', () => {
  it('每种命令都有一句 summary', () => {
    expect(proposalSummary(normalizeProposalCommand({ kind: 'initialize', nextValue: INITIALIZE }))).toContain('应援色')
    expect(proposalSummary(worldProposal())).toBe('建立共享设定')
    expect(proposalSummary(normalizeProposalCommand({ kind: 'deleteCollection', slug: 'a', summary: '删掉 a' }))).toBe('删掉 a')
    expect(proposalSummary(normalizeProposalCommand({ kind: 'markCollectionFinished', slug: 'a', summary: '完结' }))).toBe('完结')
  })
})

// ── 走真实工具的那条路 ─────────────────────────────────────────────────────
//
// 上面测的是收件箱本身;这一组测模型真的能用的东西:V2 的
// `serial_propose_change` 与 `serial_read kind="inbox"`。

describe('V2 工具面', () => {
  const workspaces = { resolveByPath: async () => ({ path: root }) } as never

  /** 一次 V2 工具调用所需的最小执行上下文。 */
  function exec(callId = 'call-1'): never {
    return {
      agent: { id: 'session-1', session: { header: { cwd: root } } },
      callId,
      signal,
      arguments: {},
    } as never
  }

  /** 一条内容合法的 replaceAsset 命令参数。 */
  const proposeArgs = {
    changes: [{
      kind: 'replaceAsset',
      target: { kind: 'world' },
      baseRevision: 'absent',
      nextValue: JSON.stringify({ setting: '当代偶像行业', locations: [], notes: '' }),
      summary: '建立共享设定',
    }],
  }

  it('提交建议后拿到非权威收据,项目没有被写', async () => {
    const [readTool, proposeTool] = createSerialV2ToolDefinitions({}, workspaces)
    const receipt = await proposeTool.execute(proposeArgs, exec()) as {
      authoritative: boolean; status: string; created: boolean; proposalId: string
    }

    expect(receipt.authoritative).toBe(false)
    expect(receipt.status).toBe('pending')
    expect(receipt.created).toBe(true)

    // 项目资产一个都没动。
    await expect(readTool.execute({ kind: 'asset', targetKind: 'world' }, exec()))
      .resolves.toMatchObject({ revision: 'absent' })

    // 但建议确实可读回来了。
    const inbox = await readTool.execute({ kind: 'inbox' }, exec()) as {
      kind: string; proposals: readonly { proposalId: string; summary: string }[]
    }
    expect(inbox.kind).toBe('inbox')
    expect(inbox.proposals.map(entry => entry.summary)).toEqual(['建立共享设定'])
    expect(inbox.proposals[0].proposalId).toBe(receipt.proposalId)
  })

  it('重复提交同一条建议得到既有收据,不新增条目', async () => {
    const [, proposeTool] = createSerialV2ToolDefinitions({}, workspaces)
    await proposeTool.execute(proposeArgs, exec('call-1'))
    const again = await proposeTool.execute(proposeArgs, exec('call-2')) as { created: boolean }
    expect(again.created).toBe(false)
    expect(await openSerialInbox(root, INBOX).list(signal)).toHaveLength(1)
  })

  it('内容非法的建议以 INVALID_CONTENT 失败,收件箱保持空白', async () => {
    const [, proposeTool] = createSerialV2ToolDefinitions({}, workspaces)
    await expectCode(proposeTool.execute({
      changes: [{
        kind: 'replaceAsset',
        target: { kind: 'world' },
        baseRevision: 'absent',
        nextValue: JSON.stringify({ 世界观: '自创字段' }),
        summary: '非法内容',
      }],
    }, exec()), 'INVALID_CONTENT')
    expect(await openSerialInbox(root, INBOX).list(signal)).toEqual([])
  })

  it('未初始化时只有 initialize 建议能被接受', async () => {
    const fresh = await mkdtemp(join(tmpdir(), 'serial-inbox-fresh-'))
    try {
      const freshWorkspaces = { resolveByPath: async () => ({ path: fresh }) } as never
      const [, proposeTool] = createSerialV2ToolDefinitions({}, freshWorkspaces)
      const freshExec = {
        agent: { id: 'session-1', session: { header: { cwd: fresh } } },
        callId: 'call-1',
        signal,
        arguments: {},
      } as never

      await expectCode(proposeTool.execute(proposeArgs, freshExec), 'NOT_INITIALIZED')

      const receipt = await proposeTool.execute({
        changes: [{ kind: 'initialize', nextValue: INITIALIZE }],
      }, freshExec) as { created: boolean; authoritative: boolean }
      expect(receipt.created).toBe(true)
      expect(receipt.authoritative).toBe(false)

      // 未初始化也读得到收件箱 —— 它是项目命名空间的一部分,不是项目内容。
      expect(await openSerialInbox(fresh, INBOX).list(signal)).toHaveLength(1)
    } finally {
      await rm(fresh, { recursive: true, force: true })
    }
  })

  it('合法则通过,未知命令 kind 被拒', async () => {
    const [, proposeTool] = createSerialV2ToolDefinitions({}, workspaces)
    await expect(proposeTool.execute({
      changes: [{ kind: 'renameWorld', summary: 's' }],
    }, exec())).rejects.toBeInstanceOf(Error)
  })
})
