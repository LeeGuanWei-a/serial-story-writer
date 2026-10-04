/**
 * 整集装配的契约。
 *
 * 这份函数有两个调用方(模型的 `kind="export"` 与面板的导出按钮),所以它值得被直接
 * 钉住:它输出的就是"交付给人读的那份文稿",排版错乱或静默丢章都属于失真。
 */

import { describe, expect, it } from 'vitest'
import { assembleCollectionMarkdown, type ExportCollectionInput } from '../src/serial-export.ts'

/** 一集的基线内容。 */
function collection(overrides: Partial<ExportCollectionInput> = {}): ExportCollectionInput {
  return {
    slug: 'first-snow',
    title: '初雪',
    theme: '第一次被看见',
    summary: '一个冬天里的一次演出。',
    status: 'in-progress',
    season: '冬',
    startDate: '2026-11-01',
    endDate: '2027-02-28',
    chapters: [
      { chapter: 1, title: '开场', text: '# 开场\n\n雪落在铁皮屋顶上。' },
      { chapter: 2, title: '灯亮', text: '# 灯亮\n\n她走上台。' },
    ],
    ...overrides,
  }
}

describe('装配整集', () => {
  it('集名作一级标题,题记进引用块', () => {
    const text = assembleCollectionMarkdown(collection())
    expect(text.startsWith('# 初雪\n')).toBe(true)
    expect(text).toContain('> 主题:第一次被看见')
    expect(text).toContain('> 状态:in-progress')
    expect(text).toContain('> 时间:冬 · 2026-11-01 · 2027-02-28')
    expect(text).toContain('> 一个冬天里的一次演出。')
  })

  it('每章一个二级标题,按章节号升序', () => {
    const text = assembleCollectionMarkdown(collection({
      chapters: [
        { chapter: 3, title: '第三', text: '丙' },
        { chapter: 1, title: '第一', text: '甲' },
        { chapter: 2, title: '第二', text: '乙' },
      ],
    }))
    const positions = ['## 第 1 章 第一', '## 第 2 章 第二', '## 第 3 章 第三'].map(heading => text.indexOf(heading))
    expect(positions.every(at => at >= 0)).toBe(true)
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
  })

  it('没有正文的章保留标题并标出缺失 —— 绝不静默丢章', () => {
    const text = assembleCollectionMarkdown(collection({
      chapters: [
        { chapter: 1, title: '开场', text: '' },
        { chapter: 2, title: '灯亮', text: '正文在' },
      ],
    }))
    expect(text).toContain('## 第 1 章 开场')
    expect(text).toContain('（本章还没有正文）')
    expect(text).toContain('## 第 2 章 灯亮')
  })

  it('没有标题的章也不崩(还没有章节蓝图)', () => {
    const text = assembleCollectionMarkdown(collection({ chapters: [{ chapter: 1, title: '', text: '正文' }] }))
    expect(text).toContain('## 第 1 章\n')
  })

  it('标题缺失时退回 slug,不让文档没有名字', () => {
    expect(assembleCollectionMarkdown(collection({ title: '' })).startsWith('# first-snow\n')).toBe(true)
  })

  it('元信息缺失时不留下空的引用行', () => {
    const text = assembleCollectionMarkdown(collection({ theme: '', summary: '', status: '', season: '', startDate: '', endDate: '' }))
    expect(text).not.toContain('>')
    // 仍然有集名与正文。
    expect(text).toContain('# 初雪')
    expect(text).toContain('雪落在铁皮屋顶上。')
  })

  it('正文的 CRLF 归一化为 LF,且不留多余空行', () => {
    const text = assembleCollectionMarkdown(collection({ chapters: [{ chapter: 1, title: 'A', text: '第一行\r\n第二行\r\n\r\n\r\n' }] }))
    expect(text).toContain('第一行\n第二行')
    expect(text).not.toContain('\r')
    expect(text.endsWith('\n')).toBe(true)
    expect(text.endsWith('\n\n')).toBe(false)
  })

  it('没有章时也产出一份合法文档', () => {
    const text = assembleCollectionMarkdown(collection({ chapters: [] }))
    expect(text.startsWith('# 初雪\n')).toBe(true)
    expect(text).not.toContain('## ')
  })

  // 导出不该带时间戳之类的易变字段:否则同一集两次导出字节不同,快照钉不住,人也没法
  // 判断两份导出是否真的不同。
  it('是确定性的:同样输入两次得到逐字节相同的结果', () => {
    const input = collection()
    expect(assembleCollectionMarkdown(input)).toBe(assembleCollectionMarkdown(input))
  })
})

/**
 * 标题层级归一化。
 *
 * 这一组来自真实项目:作者在每章正文里自己写了 `# 暮山紫` 这样的 H1。若直接注入
 * `## 第 1 章`,导出文档里就会出现"更小的标题下面套着更大的标题" —— 层级是倒的。
 * 处理办法是**结构归一化**(只动井号个数,不动散文),而不是让人回去改稿。
 */
describe('标题层级', () => {
  it('正文自带 H1 时:下沉到 H2,且不再注入重复的章标题', () => {
    const text = assembleCollectionMarkdown(collection({
      chapters: [{ chapter: 1, title: '开场', text: '# 暮山紫\n\n正文。' }],
    }))
    expect(text).toContain('## 暮山紫')
    // 作者已经写了章名,注入只会得到两份标题。
    expect(text).not.toContain('## 第 1 章')
    // 集名仍是唯一的 H1。
    expect(text.match(/^# /gm)?.length).toBe(1)
  })

  it('正文里的次级标题跟着一起下沉', () => {
    const text = assembleCollectionMarkdown(collection({
      chapters: [{ chapter: 1, title: '开场', text: '# 一\n\n## 一节\n\n### 一小节\n\n正文。' }],
    }))
    expect(text).toContain('## 一')
    expect(text).toContain('### 一节')
    expect(text).toContain('#### 一小节')
  })

  it('正文只从 H2 开始时不动它', () => {
    const text = assembleCollectionMarkdown(collection({
      chapters: [{ chapter: 1, title: '开场', text: '## 已经是二级\n\n正文。' }],
    }))
    expect(text).toContain('## 已经是二级')
    expect(text).not.toContain('### 已经是二级')
    expect(text).not.toContain('## 第 1 章')
  })

  it('正文没有标题时仍注入章定位', () => {
    const text = assembleCollectionMarkdown(collection({
      chapters: [{ chapter: 1, title: '开场', text: '只是正文。' }],
    }))
    expect(text).toContain('## 第 1 章 开场')
  })

  it('围栏代码里的井号不算标题,也不被下沉', () => {
    const text = assembleCollectionMarkdown(collection({
      chapters: [{ chapter: 1, title: '开场', text: '# 真标题\n\n```\n# 注释\n```\n' }],
    }))
    expect(text).toContain('## 真标题')
    // 代码块内原样。
    expect(text).toContain('# 注释')
  })

  it('最深层级也不会被推到 6 级以上', () => {
    const text = assembleCollectionMarkdown(collection({
      chapters: [{ chapter: 1, title: '开场', text: '# 一\n\n###### 六\n' }],
    }))
    expect(text).toContain('## 一')
    expect(text).toContain('###### 六')
    expect(text).not.toContain('####### 六')
  })
})
