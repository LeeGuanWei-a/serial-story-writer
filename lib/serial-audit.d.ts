/**
 * 跨集巡检的**纯逻辑**。
 *
 * ## 为什么单独抽出来
 *
 * 巡检有两个调用方:
 * - **Host 侧** `serial_read kind="audit"` 给模型看;
 * - **面板**给人看。
 *
 * 两个调用方各自实现一遍,就等于把十条稳定码的判定规则存了两份 —— 迟早有一份漂移,
 * 那时模型说"没问题"、面板说"有问题",而两边都不算错。这里把**判定**收敛成纯函数,
 * 两个调用方只负责各自把数据凑成 {@link SerialAuditInput}(一个有文件系统、一个有
 * Remote),判定本身只有一份。
 *
 * ## 它必须零运行时依赖
 *
 * 面板那一侧要引它,而 `./types.ts` 会牵出 `dsh-brand` / `dsh-llm` 这类只在 Host 侧
 * 存在的包。因此这里只做 `import type`、不抛自定义异常、不碰文件系统。
 */
import type { SerialAuditResult } from './types.js';
/** 参与巡检的一章。 */
export interface AuditChapterInput {
    readonly chapter: number;
    readonly hasBlueprint: boolean;
    readonly hasDraft: boolean;
    /** 蓝图里的 `characterIds`;没有蓝图时为空。 */
    readonly characterIds: readonly string[];
    /** 蓝图里的 `threadIds`;没有蓝图时为空。 */
    readonly threadIds: readonly string[];
    readonly povCharacterId: string;
}
/** 参与巡检的一条故事线声明。 */
export interface AuditThreadInput {
    readonly id: string;
    readonly title: string;
}
/** 参与巡检的一集。 */
export interface AuditCollectionInput {
    readonly slug: string;
    /** 只带判定需要的两样;`undefined` 表示这一集没有蓝图。 */
    readonly blueprint: {
        readonly characterIds: readonly string[];
        readonly threads: readonly AuditThreadInput[];
    } | undefined;
    readonly hasTimeline: boolean;
    readonly chapters: readonly AuditChapterInput[];
}
/** 参与巡检的一个人物。 */
export interface AuditCharacterInput {
    readonly id: string;
    readonly name: string;
}
/** 巡检的全部输入。 */
export interface SerialAuditInput {
    readonly worldPresent: boolean;
    readonly charactersPresent: boolean;
    readonly characters: readonly AuditCharacterInput[];
    readonly collections: readonly AuditCollectionInput[];
}
/**
 * 巡检一个世界,返回有界报告。
 *
 * 它**只报告**。发现的问题不会抛异常、也不让读取失败 —— 一份有缺口的手稿仍然应该能读。
 *
 * @param input 世界索引的判定视图。
 * @param limit 发现数上限;超出时置 `truncated`。
 * @returns 稳定的巡检结果。
 */
export declare function auditWorld(input: SerialAuditInput, limit: number): SerialAuditResult;
