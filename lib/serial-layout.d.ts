/**
 * 项目内布局的**唯一事实源**:目录名、文件名、章节号与路径。
 *
 * ## 为什么必须共享
 *
 * Host 侧按这些路径读写文件,浏览器侧的工作台按这些路径**读同一批文件**。两边各写
 * 一份字符串拼接,就等于把"`chapters/0007-blueprint.json` 到底长什么样"这条知识存了
 * 两份 —— 任何一次改名都有一侧静默失配:Host 写对了、面板什么都读不到,而且不会
 * 报错,只会显示空白。
 *
 * 所以这里只有纯函数与常量:不带 IO、不依赖宿主,Host 与 Client 半边都能引,且可
 * 以被测试直接钉住。
 *
 * **它必须零运行时依赖**:Client 半边也会引它,而 `./types.ts` 会牵出 `dsh-brand` /
 * `dsh-llm` 这类**只在 Host 侧存在**的包 —— 那些在浏览器模块表里没有,一旦成为
 * 打包外部依赖,插件在浏览器里就起不来。因此这里只做 `import type`,连异常都用
 * 原生 `RangeError`(由 Host 侧的调用点翻译成稳定的 `INVALID_CONTENT`)。
 */
import type { AssetRef } from './types.js';
/** 项目目录名。 */
export declare const SERIAL_DIR = ".serial";
/** 短篇集目录。 */
export declare const COLLECTIONS_DIR = "collections";
/** 章节目录。 */
export declare const CHAPTERS_DIR = "chapters";
/** 提案收件箱目录(位于项目命名空间之下)。 */
export declare const INBOX_DIR = "inbox";
/** 项目清单文件名。 */
export declare const PROJECT_FILE = "project.json";
/** 共享人物档案文件名。 */
export declare const CHARACTERS_FILE = "characters.json";
/** 共享设定文件名。 */
export declare const WORLD_FILE = "world.json";
/** 短篇集蓝图文件名。 */
export declare const COLLECTION_BLUEPRINT_FILE = "blueprint.json";
/** 短篇集时间线文件名。 */
export declare const COLLECTION_TIMELINE_FILE = "timeline.json";
/** 章节蓝图文件后缀。 */
export declare const CHAPTER_BLUEPRINT_SUFFIX = "-blueprint.json";
/** 章节正文文件后缀。 */
export declare const CHAPTER_DRAFT_SUFFIX = ".md";
/** 章节号在文件名里占的位数。 */
export declare const CHAPTER_DIGITS = 4;
/**
 * 章节号转文件名片段。
 *
 * @param chapter 章节号,必须是正整数。
 * @returns 补零到 {@link CHAPTER_DIGITS} 位的片段。
 * @throws RangeError 当章节号不是正整数。Host 侧的调用点会把它翻成 `INVALID_CONTENT`。
 */
export declare function chapterSegment(chapter: number): string;
/**
 * 从章节文件名里取章节号。
 *
 * 与 {@link chapterSegment} 是一对:能被前者生成的名字,都能被这里解析回来。
 *
 * @param fileName 章节目录下的一个文件名。
 * @returns 章节号;不是章节文件时为 undefined。
 */
export declare function chapterNumberOf(fileName: string): number | undefined;
/** 项目清单的路径。 */
export declare function projectPath(): string;
/** 共享人物档案的路径。 */
export declare function charactersPath(): string;
/** 共享设定的路径。 */
export declare function worldPath(): string;
/** 全部短篇集所在目录。 */
export declare function collectionsDir(): string;
/** 某短篇集的目录。 */
export declare function collectionDir(slug: string): string;
/** 某短篇集的章节目录。 */
export declare function chaptersDir(slug: string): string;
/** 某短篇集的蓝图路径。 */
export declare function collectionBlueprintPath(slug: string): string;
/** 某短篇集的时间线路径。 */
export declare function collectionTimelinePath(slug: string): string;
/** 某一章正文的路径。 */
export declare function chapterDraftPath(slug: string, chapter: number): string;
/** 某一章蓝图的路径。 */
export declare function chapterBlueprintPath(slug: string, chapter: number): string;
/** 提案收件箱的目录。 */
export declare function inboxDir(): string;
/**
 * 把一个资产引用映射为项目内的相对路径(POSIX 分隔符)。
 *
 * @param target 资产引用;调用方负责 slug/chapter 已通过形态校验。
 * @returns 相对路径。
 */
export declare function serialAssetPath(target: AssetRef): string;
