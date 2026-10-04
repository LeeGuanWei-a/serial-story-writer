/**
 * 只读数据层:把 dsh 的 `workspaceFiles` Remote 包装成本插件需要的那一小块。
 *
 * ## 为什么走这个 Remote
 *
 * 上游 `dsh 0.2.0-rc.2` 有一个缺陷:第三方插件注册 HTTP 通道会撞上
 * `cannot get property "webServer" without inject`(§6.1)。但那只堵住"注册新通道"
 * 这一种做法 —— dsh 原生的 Typert Remote 是通的,而 `workspaceFiles` 正好满足只读
 * 工作台的全部需要:
 *
 * - 它**不暴露任何 mutation 操作**,天然满足「浏览器侧不暴露 mutation RPC」;
 * - 路径以**会话工作区根**为基准,面板只传 `.serial/world.json` 这类相对路径,
 *   不携带宿主绝对路径;
 * - `list` / `readBytes` / `stat` / `changes` 覆盖浏览、资产视图与实时刷新。
 *
 * 这里刻意声明**结构化最小接口**而不是导入 dsh 的类型:与 `src/client/index.ts`
 * 里的 `SerialSlotsService` 同一套做法,避免把宿主包的模块身份拖进本插件。
 */
import type { SerialAuditResult } from '../types.js';
/** Remote 调用的返回封装。 */
export type SerialRemoteResult<T> = {
    readonly ok: true;
    readonly value: T;
} | {
    readonly ok: false;
    readonly error?: unknown;
};
/** `workspaceFiles.list` 的条目。 */
export interface SerialWorkspaceFileEntry {
    readonly name: string;
    readonly type: 'file' | 'directory' | 'other';
    readonly size?: number;
}
/** `workspaceFiles` 命名空间中本插件用到的方法。 */
export interface SerialWorkspaceFiles {
    list(sessionId: string, path: string, signal: AbortSignal): Promise<SerialRemoteResult<{
        readonly entries: readonly SerialWorkspaceFileEntry[];
        readonly truncated: boolean;
    }>>;
    readBytes(sessionId: string, path: string, options: Record<string, never>, signal: AbortSignal): Promise<SerialRemoteResult<{
        readonly absolutePath: string;
        readonly version: string;
        readonly bytes?: number;
        readonly data: Uint8Array;
        readonly eof: boolean;
    }>>;
    /**
     * 订阅变更的**流方法**,与 `list`/`readBytes` 同属一个命名空间。
     *
     * 它只是一代物理流:断线不会自己重开,所以必须交给 `ctx.remote.$stream` 监督器
     * 包裹(见 `change-watch.ts`)。声明成可选 —— 缺它时面板不自动刷新,其余照常。
     */
    changes?(sessionId: string, path: string, signal: AbortSignal): AsyncIterable<{
        readonly kind: string;
    }>;
}
export { SERIAL_DIR, chapterBlueprintPath, chapterDraftPath, collectionBlueprintPath, collectionTimelinePath, chapterNumberOf, chaptersDir, inboxDir, serialAssetPath, } from '../serial-layout.js';
/** 一个资产的只读视图。`revision: 'absent'` 表示文件不存在。 */
export interface SerialAssetView {
    /** 项目内相对路径,用于展示。 */
    readonly path: string;
    /** 与 Host 完全一致的修订号:规范化 UTF-8 字节的 SHA-256;不存在时为 `absent`。 */
    readonly revision: string;
    /** 盘上字节数。 */
    readonly bytes: number;
    /** 文件文本;不存在时为空串。 */
    readonly text: string;
}
export interface SerialChapterView {
    readonly chapter: number;
    /**
     * 章节蓝图资产。
     *
     * 蓝图**必须**读进来:`appearances` 与故事线的推进只来自蓝图,正文不参与
     * (§6.8)。只判断"文件在不在"不够 —— 界面要能算出"这一章推进了哪几条线"。
     */
    readonly blueprint: SerialAssetView;
    /** 蓝图里的 `characterIds`(章级出场事实)。 */
    readonly characterIds: readonly string[];
    /** 蓝图里的 `threadIds`(这一章推进了哪几条线)。 */
    readonly threadIds: readonly string[];
    /** 蓝图里的 `povCharacterId`;没有时为空串。 */
    readonly povCharacterId: string;
    readonly hasDraft: boolean;
    readonly draftBytes: number;
}
export interface SerialCollectionView {
    readonly slug: string;
    readonly blueprint: SerialAssetView;
    readonly timeline: SerialAssetView;
    /** 该集蓝图声明的出场人物。 */
    readonly characterIds: readonly string[];
    /** 该集蓝图声明的人物(只取巡检与展示要用的字段)。 */
    readonly characterList: readonly {
        readonly id: string;
        readonly name: string;
        readonly role: string;
    }[];
    /** 该集蓝图声明的故事线。 */
    readonly threadList: readonly {
        readonly id: string;
        readonly title: string;
    }[];
    readonly chapters: readonly SerialChapterView[];
}
/** 一条待审阅提案的只读视图(只带列表需要的字段)。 */
export interface SerialProposalView {
    readonly proposalId: string;
    readonly createdAt: string;
    readonly summary: string;
    readonly status: string;
    /** 命令 kind,用于分组显示。 */
    readonly commandKind: string;
    /** 命令的规范 JSON,展开时看。 */
    readonly commandText: string;
}
/** 加载成功的项目快照。 */
export interface SerialProjectView {
    readonly kind: 'ready';
    readonly project: SerialAssetView;
    readonly world: SerialAssetView;
    readonly characters: SerialAssetView;
    /** 人物档案的稳定 id 与显示名。 */
    readonly characterList: readonly {
        readonly id: string;
        readonly name: string;
        readonly role: string;
    }[];
    readonly collections: readonly SerialCollectionView[];
    readonly proposals: readonly SerialProposalView[];
    /**
     * 巡检结果。
     *
     * 判定来自 `src/serial-audit.ts` —— **和 Host 侧 `serial_read kind="audit"` 是同一个
     * 函数**。若两边各实现一遍,迟早会出现模型说"没问题"、面板说"有问题"而两边都不算错的
     * 局面。
     */
    readonly audit: SerialAuditResult;
}
/** 面板要区分的三种顶层状态 —— 不把"读不到"伪装成"空项目"。 */
export type SerialProjectSnapshot = {
    readonly kind: 'absent';
    readonly proposals: readonly SerialProposalView[];
} | {
    readonly kind: 'unreadable';
    readonly message: string;
} | SerialProjectView;
/**
 * 与 Host 的 `revisionOf` 逐字对齐:CRLF/CR 归一化为 LF,再取规范化 UTF-8 字节的
 * SHA-256。
 *
 * 必须按**整文件字节**算(而不是 `read` 返回的分页文本):`read` 丢掉结尾换行,
 * 拿它算出来的修订号会和 Host 的不一致,而这正是工作台要让人能对上号的东西。
 *
 * @param bytes 盘上原始字节。
 * @returns 64 位十六进制摘要。
 */
export declare function serialRevision(bytes: Uint8Array): Promise<string>;
/**
 * 读一个资产。
 *
 * 读不到一律返回 `absent` 视图而不是抛错:项目里大量资产本来就是可选的(时间线、
 * 章节蓝图、正文),把它们当成错误会让面板对一份正常项目报错。
 *
 * @param files Remote 切片。
 * @param sessionId 会话身份(Remote 的作用域键)。
 * @param relative 项目内相对路径。
 * @param signal 取消信号。
 * @returns 资产视图。
 */
export declare function readAsset(files: SerialWorkspaceFiles, sessionId: string, relative: string, signal: AbortSignal): Promise<SerialAssetView>;
/**
 * 列出目录条目。
 *
 * @param files Remote 切片。
 * @param sessionId 会话身份。
 * @param relative 项目内相对路径。
 * @param signal 取消信号。
 * @returns 条目数组;目录不存在或读取失败时为空数组。
 */
export declare function listEntries(files: SerialWorkspaceFiles, sessionId: string, relative: string, signal: AbortSignal): Promise<readonly SerialWorkspaceFileEntry[]>;
/** 章节正文的文件名/蓝图的文件名:由共享布局模块提供,见文件头的 re-export。 */
/** 从 JSON 资产文本里取字符串数组字段;缺失或形态不对时为空数组。 */
export declare function stringArrayField(text: string, key: string): readonly string[];
/** 取 JSON 资产文本里的字符串字段;缺失或形态不对时为空串。 */
export declare function stringField(text: string, key: string): string;
/** 取 JSON 资产文本里的字段。 */
export declare function jsonField(text: string, key: string): unknown;
/** 一条故事线,连同推进过它的章节号。 */
export interface SerialThreadAdvance {
    readonly id: string;
    readonly title: string;
    readonly summary: string;
    readonly advances: readonly number[];
}
/**
 * 算出一集里每条故事线的推进轨迹。
 *
 * 与 Host 的 `threads` 投影同一套规则:线声明来自短篇集蓝图,推进来自**章节蓝图**
 * 的 `threadIds`;引用到未声明线的 id 被忽略,不会凭空造线。正文不参与。
 *
 * @param collection 已加载的一集。
 * @returns 每条线一条记录;没有声明线时为空数组。
 */
export declare function collectThreadAdvances(collection: SerialCollectionView): readonly SerialThreadAdvance[];
/** 一个人物在某一集里的章级出场。 */
export interface SerialCharacterAppearance {
    readonly slug: string;
    /** 整集出场(短篇集蓝图的 `characterIds`)。 */
    readonly wholeCollection: boolean;
    /** 章级出场(章节蓝图的 `characterIds`)。 */
    readonly chapters: readonly number[];
}
/**
 * 汇总一个人物在全部已加载短篇集里的出场。
 *
 * @param collections 已加载的短篇集。
 * @param characterId 人物稳定 id。
 * @returns 每一集一条记录。
 */
export declare function collectCharacterAppearances(collections: readonly SerialCollectionView[], characterId: string): readonly SerialCharacterAppearance[];
/**
 * 列出待审阅提案。
 *
 * 提案是**非权威**的:它们只说明"有人建议这么改",项目一个字节都没动。因此面板
 * 必须把它们显示成"建议",而不是"已完成的改动"。
 *
 * @param files Remote 切片。
 * @param sessionId 会话身份。
 * @param signal 取消信号。
 * @returns 按文件名(即时间)升序的提案视图;目录不存在时为空。
 */
export declare function loadProposals(files: SerialWorkspaceFiles, sessionId: string, signal: AbortSignal): Promise<readonly SerialProposalView[]>;
/**
 * 加载一个会话工作区里的短篇集项目。
 *
 * 结构性资产(清单、世界观、人物档案、各集蓝图与时间线、章节文件清单、待审阅提案)
 * 一次读完;章节**正文**不在这里读 —— 几十章全量拉取既慢又没必要,正文按需在读到时
 * 取({@link readAsset} 配 {@link chapterDraftPath})。
 *
 * @param files Remote 切片。
 * @param sessionId 会话身份。
 * @param signal 取消信号。
 * @returns 项目快照;没初始化时是 `{ kind: 'absent' }`(但仍带回提案)。
 */
export declare function loadProject(files: SerialWorkspaceFiles, sessionId: string, signal: AbortSignal): Promise<SerialProjectSnapshot>;
