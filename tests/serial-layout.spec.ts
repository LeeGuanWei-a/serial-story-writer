/**
 * 共享布局模块的契约。
 *
 * 这个模块是 Host 与浏览器**共用的同一份路径定义**,所以它值得被直接钉住,而不是只
 * 通过两端的行为间接覆盖:一旦 `chapterSegment` 与 `chapterNumberOf` 不再互逆,Host
 * 会写一个文件、面板会去找另一个名字,而且**不会报错**,只会显示空白。
 */

import { describe, expect, it } from 'vitest'
import {
  CHAPTER_BLUEPRINT_SUFFIX,
  CHAPTER_DRAFT_SUFFIX,
  SERIAL_DIR,
  chapterBlueprintPath,
  chapterDraftPath,
  chapterNumberOf,
  chapterSegment,
  chaptersDir,
  collectionBlueprintPath,
  collectionTimelinePath,
  inboxDir,
  projectPath,
  serialAssetPath,
  worldPath,
} from '../src/serial-layout.ts'

describe('章节号与文件名', () => {
  it('补零到 4 位', () => {
    expect(chapterSegment(1)).toBe('0001')
    expect(chapterSegment(42)).toBe('0042')
    expect(chapterSegment(9999)).toBe('9999')
  })

  it('超过 4 位时不截断', () => {
    expect(chapterSegment(12345)).toBe('12345')
  })

  it('非正整数抛 RangeError(Host 侧翻成 INVALID_CONTENT)', () => {
    for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => chapterSegment(bad)).toThrow(RangeError)
    }
  })

  // 这一条是重点:两端必须对"文件名 ↔ 章节号"有完全一致的看法。
  it('生成的名字都能被解析回来(互逆)', () => {
    for (const chapter of [1, 7, 42, 365, 9999]) {
      expect(chapterNumberOf(`${chapterSegment(chapter)}${CHAPTER_DRAFT_SUFFIX}`)).toBe(chapter)
      expect(chapterNumberOf(`${chapterSegment(chapter)}${CHAPTER_BLUEPRINT_SUFFIX}`)).toBe(chapter)
    }
  })

  it('不是章节文件的名字解析为 undefined', () => {
    for (const name of ['notes.md', '0001-notes.md', '0001.txt', 'timeline.json', 'readme']) {
      expect(chapterNumberOf(name)).toBeUndefined()
    }
  })
})

describe('路径', () => {
  it('都落在项目命名空间之下', () => {
    expect(projectPath().startsWith(`${SERIAL_DIR}/`)).toBe(true)
    expect(worldPath().startsWith(`${SERIAL_DIR}/`)).toBe(true)
    expect(inboxDir().startsWith(`${SERIAL_DIR}/`)).toBe(true)
    expect(chaptersDir('first').startsWith(`${SERIAL_DIR}/`)).toBe(true)
  })

  it('章节路径带补零的章节号', () => {
    expect(chapterDraftPath('first-snow', 7)).toBe('.serial/collections/first-snow/chapters/0007.md')
    expect(chapterBlueprintPath('first-snow', 7)).toBe('.serial/collections/first-snow/chapters/0007-blueprint.json')
    expect(chaptersDir('first-snow')).toBe('.serial/collections/first-snow/chapters')
  })

  it('集合资产路径', () => {
    expect(collectionBlueprintPath('a')).toBe(`${SERIAL_DIR}/collections/a/blueprint.json`)
    expect(collectionTimelinePath('a')).toBe(`${SERIAL_DIR}/collections/a/timeline.json`)
  })

  // serialAssetPath 是 Host 侧 relativePathOf 的底座:它必须与逐个路径函数完全一致,
  // 否则"按资产引用写"与"按路径读"会走到两个地方。
  it('serialAssetPath 与逐个路径函数一致', () => {
    expect(serialAssetPath({ kind: 'project' })).toBe(projectPath())
    expect(serialAssetPath({ kind: 'world' })).toBe(worldPath())
    expect(serialAssetPath({ kind: 'collection-blueprint', slug: 'a' })).toBe(collectionBlueprintPath('a'))
    expect(serialAssetPath({ kind: 'collection-timeline', slug: 'a' })).toBe(collectionTimelinePath('a'))
    expect(serialAssetPath({ kind: 'chapter-blueprint', slug: 'a', chapter: 3 })).toBe(chapterBlueprintPath('a', 3))
    expect(serialAssetPath({ kind: 'chapter-draft', slug: 'a', chapter: 3 })).toBe(chapterDraftPath('a', 3))
  })

  it('只用 POSIX 分隔符(两端拼 join 时都不该出现反斜杠)', () => {
    for (const path of [projectPath(), worldPath(), inboxDir(), chaptersDir('a'), chapterDraftPath('a', 1)]) {
      expect(path).not.toContain('\\')
    }
  })
})
