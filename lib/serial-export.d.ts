/**
 * 把一集装配成**一份** Markdown 文档。
 *
 * ## 为什么是一个共享纯函数
 *
 * "导出这一集"是**一个操作、两个调用方**:
 * - 模型走 `serial_read kind="export"` 拿到整集文本;
 * - 面板给人同一份文本并允许下载。
 *
 * 两边各写一遍装配逻辑,迟早会出现"模型读到的整集"与"人下载到的整集"不一样 ——
 * 而这种差异极难被发现。所以装配只有这一份实现,两个调用方只负责把数据凑成
 * {@link ExportCollectionInput}。
 *
 * ## 它必须零运行时依赖
 *
 * 面板那一侧要引它(客户端打包),因此只做 `import type`。
 *
 * ## 刻意不写时间戳
 *
 * 导出结果里**没有**"导出时间"之类的字段:那会让同一集在两次导出时字节不同,测试无法
 * 用快照钉住,人也无法判断两份导出是否真的不同。
 */
/** 参与装配的一章。 */
export interface ExportChapterInput {
    readonly chapter: number;
    /** 章节标题;没有蓝图时为空串。 */
    readonly title: string;
    /** 正文;还没有正文时为空串。 */
    readonly text: string;
}
/** 参与装配的一集。 */
export interface ExportCollectionInput {
    readonly slug: string;
    readonly title: string;
    readonly theme: string;
    readonly summary: string;
    readonly status: string;
    readonly season: string;
    readonly startDate: string;
    readonly endDate: string;
    readonly chapters: readonly ExportChapterInput[];
}
/**
 * 装配整集 Markdown。
 *
 * 结构:一级标题(集名)→ 可选的题记 → 分隔线 → 每章。
 *
 * 每一章按它自己的形态落位:
 * - 正文**自带标题**时,整体下沉到 {@link CHAPTER_HEADING_LEVEL} 之下,并不再注入
 *   "第 N 章"标题 —— 作者已经写了章名,注入只会得到两份标题,而且层级是倒的。
 * - 正文**没有标题**时,注入 `## 第 N 章 …` 作为定位。
 * - 正文**缺失**时保留注入的标题并标出缺失:静默丢章会让导出看起来比实际完整。
 *
 * 章按章节号升序。
 *
 * @param input 一集的内容。
 * @returns 完整的 Markdown 文本(以换行结尾)。
 */
export declare function assembleCollectionMarkdown(input: ExportCollectionInput): string;
