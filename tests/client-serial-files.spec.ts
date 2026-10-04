/**
 * 只读工作台数据层的行为测试。
 *
 * 这一层是浏览器侧唯一的真相来源:它算的修订号必须和 Host 逐字节一致(否则用户
 * 在工作台看到的号对不上模型读到的号),它算的出场与故事线推进必须和 Host 的
 * `appearances` / `threads` 投影同一套规则。所以这里既不 mock 也不放宽。
 */

import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  chapterBlueprintPath,
  chapterDraftPath,
  collectCharacterAppearances,
  collectThreadAdvances,
  jsonField,
  loadProject,
  serialRevision,
  stringArrayField,
  type SerialRemoteResult,
  type SerialWorkspaceFileEntry,
  type SerialWorkspaceFiles,
} from '../src/client/serial-files.ts'

/** Host 侧 `revisionOf` 的独立实现,用来交叉验证浏览器那一边。 */
function hostRevision(text: string): string {
  return createHash('sha256').update(text.replace(/\r\n?/g, '\n'), 'utf8').digest('hex')
}

/** 内存文件树:`相对路径 -> 文本`。 */
type Tree = Readonly<Record<string, string>>

/**
 * 造一个假的 `workspaceFiles`。
 *
 * @param tree 内存文件树。
 * @returns Remote 切片,并记录被读过的路径。
 */
function fakeFiles(tree: Tree): SerialWorkspaceFiles & { readonly reads: string[] } {
  const reads: string[] = []
  const paths = Object.keys(tree)
  return {
    reads,
    async list(_sessionId, path): Promise<SerialRemoteResult<{ entries: readonly SerialWorkspaceFileEntry[]; truncated: boolean }>> {
      const prefix = `${path}/`
      const names = new Set<string>()
      for (const candidate of paths) {
        if (!candidate.startsWith(prefix)) continue
        const rest = candidate.slice(prefix.length)
        const slash = rest.indexOf('/')
        names.add(slash === -1 ? rest : rest.slice(0, slash))
      }
      if (names.size === 0) return { ok: false, error: { message: 'not found' } }
      const entries = [...names].sort().map((name): SerialWorkspaceFileEntry => {
        const full = `${prefix}${name}`
        const isDirectory = paths.some(candidate => candidate.startsWith(`${full}/`))
        return isDirectory
          ? { name, type: 'directory' }
          : { name, type: 'file', size: Buffer.byteLength(tree[full] ?? '', 'utf8') }
      })
      return { ok: true, value: { entries, truncated: false } }
    },
    async readBytes(_sessionId, path) {
      reads.push(path)
      const text = tree[path]
      if (text === undefined) return { ok: false, error: { message: `missing ${path}` } }
      const data = new TextEncoder().encode(text)
      return {
        ok: true,
        value: {
          absolutePath: `C:/ws/${path}`,
          version: 'v1',
          bytes: data.byteLength,
          data,
          eof: true,
        },
      }
    },
  }
}

describe('修订号与 Host 一致', () => {
  it('同一份文本算出同一个摘要', async () => {
    const text = '{\n  "setting": "海边小镇"\n}\n'
    expect(await serialRevision(new TextEncoder().encode(text))).toBe(hostRevision(text))
  })

  it('CRLF 与 CR 都按 LF 归一化 —— 排版不同不会算出两个修订号', async () => {
    const lf = 'a\nb\nc\n'
    const crlf = 'a\r\nb\r\nc\r\n'
    const cr = 'a\rb\rc\r'
    expect(await serialRevision(new TextEncoder().encode(crlf))).toBe(hostRevision(lf))
    expect(await serialRevision(new TextEncoder().encode(cr))).toBe(hostRevision(lf))
  })

  it('结尾换行参与摘要 —— 所以必须按整文件字节算,不能用分页文本', async () => {
    const withNewline = '{"a":1}\n'
    const without = '{"a":1}'
    expect(await serialRevision(new TextEncoder().encode(withNewline)))
      .not.toBe(await serialRevision(new TextEncoder().encode(without)))
  })
})

describe('文件路径', () => {
  it('章节号补零到 4 位', () => {
    expect(chapterDraftPath('first', 7)).toBe('.serial/collections/first/chapters/0007.md')
    expect(chapterBlueprintPath('first', 12)).toBe('.serial/collections/first/chapters/0012-blueprint.json')
  })
})

describe('JSON 字段读取是宽容的', () => {
  it('坏 JSON、缺失字段、类型不对都返回空而不是抛错', () => {
    expect(stringArrayField('{ not json', 'items')).toEqual([])
    expect(stringArrayField('{}', 'items')).toEqual([])
    expect(stringArrayField('{"items":"nope"}', 'items')).toEqual([])
    expect(stringArrayField('{"items":["a",1,"b"]}', 'items')).toEqual(['a', 'b'])
    expect(jsonField('{ not json', 'x')).toBeUndefined()
  })
})

const THREAD_BLUEPRINT = JSON.stringify({
  title: '第一集', theme: '主题', summary: '梗概', characterIds: ['hiori', 'shen'],
  targetWords: 8000, status: 'planned',
  threads: [
    { id: 'clock', title: '共同时钟', summary: '同一条时间轴' },
    { id: 'color', title: '认错的应援色', summary: '色号搞错的余波' },
  ],
})

function chapterBlueprint(characterIds: readonly string[], threadIds: readonly string[]): string {
  return JSON.stringify({ title: '章', keyBeats: ['起'], characterIds, povCharacterId: 'hiori', threadIds })
}

describe('故事线推进轨迹', () => {
  it('推进来自章节蓝图,并升序去重', async () => {
    const files = fakeFiles({
      '.serial/project.json': JSON.stringify({ worldId: 'w', worldName: '应援色', language: 'zh-CN', tone: 't', creativeStrategy: 'auto', createdAt: 'a', updatedAt: 'a' }),
      '.serial/world.json': JSON.stringify({ setting: 's', locations: [], notes: '' }),
      '.serial/characters.json': JSON.stringify({ items: [] }),
      '.serial/collections/first/blueprint.json': THREAD_BLUEPRINT,
      '.serial/collections/first/chapters/0001-blueprint.json': chapterBlueprint(['hiori'], ['clock']),
      '.serial/collections/first/chapters/0002-blueprint.json': chapterBlueprint(['hiori'], ['clock', 'color']),
    })
    const snapshot = await loadProject(files, 'session-1', new AbortController().signal)
    if (snapshot.kind !== 'ready') throw new Error(`期望 ready,收到 ${snapshot.kind}`)
    const collection = snapshot.collections[0]
    expect(collectThreadAdvances(collection)).toEqual([
      { id: 'clock', title: '共同时钟', summary: '同一条时间轴', advances: [1, 2] },
      { id: 'color', title: '认错的应援色', summary: '色号搞错的余波', advances: [2] },
    ])
  })

  it('引用未声明线的 threadIds 被忽略,不会凭空造线', async () => {
    const files = fakeFiles({
      '.serial/project.json': JSON.stringify({ worldId: 'w', worldName: 'w', language: 'zh-CN', tone: 't', creativeStrategy: 'auto', createdAt: 'a', updatedAt: 'a' }),
      '.serial/collections/first/blueprint.json': THREAD_BLUEPRINT,
      '.serial/collections/first/chapters/0001-blueprint.json': chapterBlueprint([], ['typo-line']),
    })
    const snapshot = await loadProject(files, 'session-1', new AbortController().signal)
    if (snapshot.kind !== 'ready') throw new Error('期望 ready')
    expect(collectThreadAdvances(snapshot.collections[0]).map(thread => thread.id)).toEqual(['clock', 'color'])
  })
})

describe('人物出场', () => {
  it('整集出场与章级出场分开给', async () => {
    const files = fakeFiles({
      '.serial/project.json': JSON.stringify({ worldId: 'w', worldName: 'w', language: 'zh-CN', tone: 't', creativeStrategy: 'auto', createdAt: 'a', updatedAt: 'a' }),
      '.serial/collections/first/blueprint.json': THREAD_BLUEPRINT,
      '.serial/collections/first/chapters/0002-blueprint.json': chapterBlueprint(['hiori'], []),
    })
    const snapshot = await loadProject(files, 'session-1', new AbortController().signal)
    if (snapshot.kind !== 'ready') throw new Error('期望 ready')
    expect(collectCharacterAppearances(snapshot.collections, 'hiori')).toEqual([
      { slug: 'first', wholeCollection: true, chapters: [2] },
    ])
    // 只在集蓝图中出现、从未进过章节蓝图的人物:章级为空,这是事实而不是缺陷。
    expect(collectCharacterAppearances(snapshot.collections, 'shen')).toEqual([
      { slug: 'first', wholeCollection: true, chapters: [] },
    ])
    expect(collectCharacterAppearances(snapshot.collections, 'nobody')).toEqual([])
  })
})

describe('加载项目', () => {
  it('没有 project.json 时是 absent,不是错误', async () => {
    const snapshot = await loadProject(fakeFiles({}), 'session-1', new AbortController().signal)
    expect(snapshot.kind).toBe('absent')
  })

  it('可选资产缺失归成 absent 视图,不中断加载', async () => {
    const files = fakeFiles({
      '.serial/project.json': JSON.stringify({ worldId: 'w', worldName: '应援色', language: 'zh-CN', tone: 't', creativeStrategy: 'auto', createdAt: 'a', updatedAt: 'a' }),
      '.serial/collections/first/blueprint.json': THREAD_BLUEPRINT,
      '.serial/collections/first/chapters/0001.md': '# 第一章\n',
    })
    const snapshot = await loadProject(files, 'session-1', new AbortController().signal)
    if (snapshot.kind !== 'ready') throw new Error('期望 ready')
    // world.json / characters.json / timeline.json 都不存在,但不影响其它部分。
    expect(snapshot.world.revision).toBe('absent')
    expect(snapshot.characters.revision).toBe('absent')
    expect(snapshot.collections[0].timeline.revision).toBe('absent')
    expect(snapshot.collections[0].chapters).toEqual([
      {
        chapter: 1,
        blueprint: expect.objectContaining({ revision: 'absent' }),
        characterIds: [],
        threadIds: [],
        povCharacterId: '',
        hasDraft: true,
        draftBytes: 12,
      },
    ])
  })

  it('章节号来自文件名,蓝图与正文各自记录存在性', async () => {
    const files = fakeFiles({
      '.serial/project.json': JSON.stringify({ worldId: 'w', worldName: 'w', language: 'zh-CN', tone: 't', creativeStrategy: 'auto', createdAt: 'a', updatedAt: 'a' }),
      '.serial/collections/first/blueprint.json': THREAD_BLUEPRINT,
      '.serial/collections/first/chapters/0003.md': '正文',
      '.serial/collections/first/chapters/0003-blueprint.json': chapterBlueprint(['hiori'], ['clock']),
    })
    const snapshot = await loadProject(files, 'session-1', new AbortController().signal)
    if (snapshot.kind !== 'ready') throw new Error('期望 ready')
    expect(snapshot.collections[0].chapters).toHaveLength(1)
    expect(snapshot.collections[0].chapters[0].chapter).toBe(3)
    expect(snapshot.collections[0].chapters[0].hasDraft).toBe(true)
    expect(snapshot.collections[0].chapters[0].threadIds).toEqual(['clock'])
  })

  it('不读正文 —— 只有结构需要时才发 Remote 读', async () => {
    const files = fakeFiles({
      '.serial/project.json': JSON.stringify({ worldId: 'w', worldName: 'w', language: 'zh-CN', tone: 't', creativeStrategy: 'auto', createdAt: 'a', updatedAt: 'a' }),
      '.serial/collections/first/blueprint.json': THREAD_BLUEPRINT,
      '.serial/collections/first/chapters/0001.md': '很长的正文',
    })
    await loadProject(files, 'session-1', new AbortController().signal)
    expect(files.reads.some(path => path.endsWith('.md'))).toBe(false)
  })
})

// ── 提案收件箱的只读面 ─────────────────────────────────────────────────────
//
// 面板有责任让"建议"与"已落盘的改动"在视觉上就是两件事,所以这里也钉住:提案
// 出现在快照里,但项目资产依然是 absent。

const PROJECT_MANIFEST = JSON.stringify({
  worldId: 'w', worldName: '应援色', language: 'zh-CN', tone: 't',
  creativeStrategy: 'auto', createdAt: 'a', updatedAt: 'a',
})

/** 一条提案文件的落盘内容。 */
function proposalFile(argumentHash: string, summary: string, command: unknown): string {
  return JSON.stringify({
    version: 1,
    createdAt: '2026-10-03T00:00:00.000Z',
    identity: { sessionId: 's', callId: 'c' },
    argumentHash,
    status: 'pending',
    summary,
    command,
  })
}

describe('待审阅提案', () => {
  it('提案出现在快照里,但不改变任何资产状态', async () => {
    const files = fakeFiles({
      '.serial/project.json': PROJECT_MANIFEST,
      '.serial/inbox/00000000000001-aaaaaaaa.json': proposalFile('a'.repeat(64), '建立共享设定', {
        kind: 'replaceAsset', target: { kind: 'world' }, baseRevision: 'absent', nextValue: '{}', summary: '建立共享设定',
      }),
    })
    const snapshot = await loadProject(files, 'session-1', new AbortController().signal)
    if (snapshot.kind !== 'ready') throw new Error('期望 ready')
    expect(snapshot.proposals.map(proposal => proposal.summary)).toEqual(['建立共享设定'])
    expect(snapshot.proposals[0].commandKind).toBe('replaceAsset')
    expect(snapshot.proposals[0].status).toBe('pending')
    // 关键:世界观依然是 absent —— 提案没有写任何项目资产。
    expect(snapshot.world.revision).toBe('absent')
  })

  it('未初始化时的 initialize 建议也能被看到', async () => {
    const files = fakeFiles({
      '.serial/inbox/00000000000001-bbbbbbbb.json': proposalFile('b'.repeat(64), '初始化项目:应援色', {
        kind: 'initialize', nextValue: { worldId: 'w' },
      }),
    })
    const snapshot = await loadProject(files, 'session-1', new AbortController().signal)
    expect(snapshot.kind).toBe('absent')
    if (snapshot.kind !== 'absent') throw new Error('期望 absent')
    expect(snapshot.proposals).toHaveLength(1)
  })

  it('坏掉的提案文件被如实标出,而不是让整个面板垮掉', async () => {
    const files = fakeFiles({
      '.serial/project.json': PROJECT_MANIFEST,
      '.serial/inbox/00000000000001-cccccccc.json': '{ not json',
    })
    const snapshot = await loadProject(files, 'session-1', new AbortController().signal)
    if (snapshot.kind !== 'ready') throw new Error('期望 ready')
    expect(snapshot.proposals[0].status).toBe('invalid')
    expect(snapshot.proposals[0].summary).toContain('不是合法 JSON')
  })

  it('没有 inbox 目录时提案为空,不影响项目读取', async () => {
    const files = fakeFiles({ '.serial/project.json': PROJECT_MANIFEST })
    const snapshot = await loadProject(files, 'session-1', new AbortController().signal)
    if (snapshot.kind !== 'ready') throw new Error('期望 ready')
    expect(snapshot.proposals).toEqual([])
  })
})
