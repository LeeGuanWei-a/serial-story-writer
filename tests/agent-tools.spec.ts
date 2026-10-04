/**
 * 模型面工具的参数解析与端到端行为。
 *
 * 这一层是"模型可见契约"所在:`presentSerialChange` 决定审批卡片展示什么,
 * `parseReadRequest` / `parseApplyRequest` 决定哪些参数组合被接受。
 * 两处出错都会让模型看到与真实落盘不一致的东西。
 */

import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createSerialToolDefinitions, presentSerialChange } from '../src/agent.ts'
import { serialAssetSource } from '../src/serial-project.ts'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'serial-story-agent-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

/** 构造工具执行上下文;只提供工具真正读取的字段。 */
function exec(): never {
  return {
    agent: { session: { header: { cwd: root } } },
    signal: new AbortController().signal,
    callId: 'call-1',
    arguments: {},
  } as never
}

const [readTool, applyTool] = createSerialToolDefinitions({})

describe('serial_read 的参数解析', () => {
  it('拒绝嵌套的 target 对象(旧契约的写法)', async () => {
    await expect(readTool.execute({ kind: 'asset', target: { kind: 'project' } }, exec())).rejects.toThrow()
  })

  it('拒绝未知 kind', async () => {
    await expect(readTool.execute({ kind: 'everything' }, exec())).rejects.toThrow()
  })

  it('拒绝 asset 分支上的多余字段', async () => {
    await expect(readTool.execute({ kind: 'world', slug: 'x', chapter: 1 }, exec())).rejects.toThrow()
  })

  // `slug` 对 export 是必填(规则写在参数描述上,解析器也必须真的强制它)。
  it('export 缺 slug 时被拒', async () => {
    await expect(readTool.execute({ kind: 'export' }, exec())).rejects.toThrow()
  })

  it('export 分支上不许带 characterId', async () => {
    await expect(readTool.execute({ kind: 'export', slug: 'x', characterId: 'y' }, exec())).rejects.toThrow()
  })

  it('chronicle 缺 characterId 时被拒', async () => {
    await expect(readTool.execute({ kind: 'chronicle' }, exec())).rejects.toThrow()
  })
})

describe('端到端:初始化 → 读取 → 替换', () => {
  it('未初始化时读取以 NOT_INITIALIZED 失败,initialize 后可用', async () => {
    await expect(readTool.execute({ kind: 'world' }, exec())).rejects.toMatchObject({ code: 'NOT_INITIALIZED' })

    const receipt = await applyTool.execute({
      kind: 'initialize',
      worldId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      worldName: '闪耀色彩',
      language: 'zh-CN',
      tone: 'warm',
      creativeStrategy: 'auto',
      createdAt: '2026-10-03T00:00:00.000Z',
      updatedAt: '2026-10-03T00:00:00.000Z',
    }, exec()) as { newRevision: string; target: unknown }

    expect(receipt.target).toEqual({ kind: 'project' })
    expect(receipt.newRevision).toMatch(/^[0-9a-f]{64}$/)

    const world = await readTool.execute({ kind: 'world' }, exec()) as { kind: string; characters: unknown[] }
    expect(world.kind).toBe('world')
    expect(world.characters).toEqual([])
  })

  it('initialize 分支拒绝 replace 字段', async () => {
    await expect(applyTool.execute({
      kind: 'initialize', worldId: 'x', worldName: 'y', language: 'zh-CN', tone: 'warm',
      creativeStrategy: 'auto', createdAt: 'a', updatedAt: 'a', baseRevision: 'absent',
    }, exec())).rejects.toThrow()
  })

  it('章节资产的 targetKind 必须带 slug 与 chapter', async () => {
    await expect(applyTool.execute({
      kind: 'replace', targetKind: 'chapter-draft', baseRevision: 'absent',
      replacement: '正文', summary: '缺 slug/chapter',
    }, exec())).rejects.toThrow()
  })

  it('集合资产带上 chapter 会被拒绝', async () => {
    await expect(applyTool.execute({
      kind: 'replace', targetKind: 'collection-blueprint', slug: 'a', chapter: 1,
      baseRevision: 'absent', replacement: '{}', summary: '多余 chapter',
    }, exec())).rejects.toThrow()
  })
})

describe('审批卡片', () => {
  it('展示规范化后的终态字节与真实落盘路径', () => {
    const card = presentSerialChange({
      kind: 'replace',
      target: { kind: 'chapter-draft', slug: 'first-snow', chapter: 3 },
      baseRevision: 'absent',
      replacement: '第一行\r\n第二行',
      summary: '第三章正文',
    })
    expect(card.card).toBe('diff')
    if (card.card !== 'diff') throw new Error('expected diff card')
    expect(card.diffs[0].path).toBe(serialAssetSource({ kind: 'chapter-draft', slug: 'first-snow', chapter: 3 }))
    // 展示的是即将落盘的字节,而不是模型提交的原始文本。
    expect(card.diffs[0].newText).toBe('第一行\n第二行\n')
  })

  it('JSON 资产按规范化排版展示,并把可选字段物化成空值', () => {
    const card = presentSerialChange({
      kind: 'replace',
      target: { kind: 'world' },
      baseRevision: 'absent',
      replacement: '{"setting":"海边","locations":[],"notes":""}',
      summary: '建立世界观',
    })
    if (card.card !== 'diff') throw new Error('expected diff card')
    // 步 3 加的可选字段被物化成空值,这是**刻意**的:否则 `era: ""` 与省略 `era`
    // 语义相同却字节不同,会算出两个修订号,制造假冲突。规范化必须幂等。
    expect(card.diffs[0].newText).toBe([
      '{',
      '  "setting": "海边",',
      '  "locations": [],',
      '  "notes": "",',
      '  "era": "",',
      '  "organizations": [],',
      '  "rules": [],',
      '  "glossary": []',
      '}',
      '',
    ].join('\n'))
  })

  it('内容非法时退回展示原始文本,让审批人看到模型实际提交了什么', () => {
    const card = presentSerialChange({
      kind: 'replace',
      target: { kind: 'characters' },
      baseRevision: 'absent',
      replacement: '{ 这不是 JSON',
      summary: '坏内容',
    })
    if (card.card !== 'diff') throw new Error('expected diff card')
    expect(card.diffs[0].newText).toBe('{ 这不是 JSON')
  })
})

describe('落盘可读回', () => {
  it('替换后文件字节与审批卡片展示的一致', async () => {
    await applyTool.execute({
      kind: 'initialize', worldId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      worldName: '闪耀色彩', language: 'zh-CN', tone: 'warm', creativeStrategy: 'auto',
      createdAt: '2026-10-03T00:00:00.000Z', updatedAt: '2026-10-03T00:00:00.000Z',
    }, exec())

    const replacement = JSON.stringify({ setting: '海边小镇', locations: ['车站'], notes: '' })
    const card = presentSerialChange({
      kind: 'replace', target: { kind: 'world' }, baseRevision: 'absent',
      replacement, summary: '建立世界观',
    })
    if (card.card !== 'diff') throw new Error('expected diff card')

    await applyTool.execute({
      kind: 'replace', targetKind: 'world', baseRevision: 'absent', replacement, summary: '建立世界观',
    }, exec())

    const onDisk = await readFile(join(root, serialAssetSource({ kind: 'world' })), 'utf8')
    expect(onDisk).toBe(card.diffs[0].newText)
  })
})
