/**
 * 迷你 Markdown 解析器的行为测试。
 *
 * 这个解析器在浏览器里渲染正文,而这个环境没有浏览器控制 —— 所以把它的**语义**在
 * 这里钉死。它渲染出来的样子仍然只能在浏览器里看,但"这段文本被理解成什么"是纯函数,
 * 可以在这里完全确定。
 */

import { describe, expect, it } from 'vitest'
import { parseInline, parseMarkdown } from '../src/client/markdown.ts'

describe('块级', () => {
  it('标题的级数来自井号个数', () => {
    expect(parseMarkdown('# 开场\n### 第三节')).toEqual([
      { kind: 'heading', level: 1, text: '开场' },
      { kind: 'heading', level: 3, text: '第三节' },
    ])
  })

  it('七个井号不是标题', () => {
    expect(parseMarkdown('####### 太长了')).toEqual([
      { kind: 'paragraph', text: '####### 太长了' },
    ])
  })

  it('段落内的换行原样保留(中文里折成空格会凭空多出空格)', () => {
    expect(parseMarkdown('第一行\n第二行')).toEqual([
      { kind: 'paragraph', text: '第一行\n第二行' },
    ])
  })

  it('空行分段', () => {
    expect(parseMarkdown('甲\n\n乙')).toEqual([
      { kind: 'paragraph', text: '甲' },
      { kind: 'paragraph', text: '乙' },
    ])
  })

  it('无序与有序列表各自合并,相邻时不被吞成一个', () => {
    expect(parseMarkdown('- 甲\n- 乙\n\n1. 一\n2. 二')).toEqual([
      { kind: 'list', ordered: false, items: ['甲', '乙'] },
      { kind: 'list', ordered: true, items: ['一', '二'] },
    ])
  })

  it('有序列表接受 "1." 与 "1)" 两种写法', () => {
    expect(parseMarkdown('1) 甲\n2) 乙')).toEqual([{ kind: 'list', ordered: true, items: ['甲', '乙'] }])
  })

  it('连续引用行合成一个引用块', () => {
    expect(parseMarkdown('> 甲\n> 乙')).toEqual([{ kind: 'quote', text: '甲\n乙' }])
  })

  it('分隔线', () => {
    expect(parseMarkdown('---')).toEqual([{ kind: 'rule' }])
    expect(parseMarkdown('***')).toEqual([{ kind: 'rule' }])
    // 两个连字符不是分隔线。
    expect(parseMarkdown('--')).toEqual([{ kind: 'paragraph', text: '--' }])
  })

  it('围栏代码块整段原样收,内部不做行内解析', () => {
    expect(parseMarkdown('```\n**不解析**\n# 也不是标题\n```')).toEqual([
      { kind: 'code', text: '**不解析**\n# 也不是标题' },
    ])
  })

  it('未闭合的围栏吃到末尾(写到一半的稿子很常见)', () => {
    expect(parseMarkdown('正文\n\n```\n还在写')).toEqual([
      { kind: 'paragraph', text: '正文' },
      { kind: 'code', text: '还在写' },
    ])
  })

  it('块级结构与真实的一章开头', () => {
    const blocks = parseMarkdown('# 开场\n\n雪落在铁皮屋顶上。\n\n- 灯亮\n- 人静\n\n> 她没说话。\n\n```\n舞台指示\n```\n\n---\n')
    expect(blocks.map(block => block.kind)).toEqual([
      'heading', 'paragraph', 'list', 'quote', 'code', 'rule',
    ])
  })
})

describe('行内', () => {
  it('没有标记时是一整段文字', () => {
    expect(parseInline('普通的一句话')).toEqual([{ kind: 'text', text: '普通的一句话' }])
  })

  it('粗体、斜体、行内代码', () => {
    expect(parseInline('**粗**')).toEqual([{ kind: 'strong', text: '粗' }])
    expect(parseInline('*斜*')).toEqual([{ kind: 'em', text: '斜' }])
    expect(parseInline('_斜_')).toEqual([{ kind: 'em', text: '斜' }])
    expect(parseInline('`码`')).toEqual([{ kind: 'code', text: '码' }])
  })

  it('链接拆出文字与地址', () => {
    expect(parseInline('见 [讨论](https://example.com/a) 一文')).toEqual([
      { kind: 'text', text: '见 ' },
      { kind: 'link', text: '讨论', href: 'https://example.com/a' },
      { kind: 'text', text: ' 一文' },
    ])
  })

  it('混合标记的顺序正确', () => {
    expect(parseInline('前 **粗** 中 `码` 后')).toEqual([
      { kind: 'text', text: '前 ' },
      { kind: 'strong', text: '粗' },
      { kind: 'text', text: ' 中 ' },
      { kind: 'code', text: '码' },
      { kind: 'text', text: ' 后' },
    ])
  })

  it('孤立的星号不算斜体(乘号与强调符号在中文里都会出现)', () => {
    expect(parseInline('3 * 4 = 12')).toEqual([{ kind: 'text', text: '3 * 4 = 12' }])
    expect(parseInline('* 开头是空格')).toEqual([{ kind: 'text', text: '* 开头是空格' }])
  })

  it('代码里的星号不被当作强调', () => {
    expect(parseInline('`**x**`')).toEqual([{ kind: 'code', text: '**x**' }])
  })

  // 安全属性:正文是模型写的,HTML 必须当文字,不能被当成标签。
  it('HTML 原样当文字,不透传', () => {
    expect(parseInline('<script>alert(1)</script>')).toEqual([
      { kind: 'text', text: '<script>alert(1)</script>' },
    ])
    expect(parseMarkdown('<img src=x onerror=y>')).toEqual([
      { kind: 'paragraph', text: '<img src=x onerror=y>' },
    ])
  })
})
