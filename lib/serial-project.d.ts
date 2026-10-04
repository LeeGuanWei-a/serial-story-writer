/**
 * 短篇集项目的文件层。
 *
 * 一个项目就是工作区下的 `.serial/` 目录:世界观清单、共享人物档案、共享设定,
 * 以及若干互相独立的短篇集(每个短篇集有自己的蓝图、时间线与章节)。
 *
 * 三条不变量:
 * 1. **修订号即并发**。每个非空资产的修订号是规范化 UTF-8 字节的 SHA-256;
 *    替换请求只带"上次读到的修订号",模型永远不需要复述旧文本。
 * 2. **写入是单文件原子替换**。借助 `dsh-atomic-write` 的 rename 提交,
 *    读者只会看到替换前或替换后的完整内容。
 * 3. **落盘的是规范化字节**。JSON 资产经严格校验后按 2 空格缩进 + LF 重新序列化,
 *    正文按 LF 归一化,因此格式抖动不会产生假修订。
 */
import { type AssetRef, type CommitReceipt, type SerialApplyRequest, type SerialInitializeRequest, type SerialReadRequest, type SerialReadResult } from './types.js';
/**
 * 校验短篇集 slug 并返回它。
 *
 * 导出给提案收件箱复用**同一套**约束:提案里带的 slug 与直接写入时走的是同一个
 * 形态检查,因此收件箱不可能存下一条将来落盘会被拒的路径。
 *
 * @param slug 待校验的 slug。
 * @returns 原样返回的 slug。
 */
export declare function assertSerialSlug(slug: string): string;
/** 部署相关的读取上限。 */
export interface SerialProjectOptions {
    /** 单个资产读取/写入的字节上限。 */
    readonly assetBytes: number;
    /** 世界投影的字节上限。 */
    readonly workingSetBytes: number;
    /** 出场投影的最大条目数。 */
    readonly queryMatches: number;
}
/** 一个已打开的项目。 */
export interface SerialProject {
    /**
     * 读取一个有界的项目投影。
     *
     * @param request 资产、世界投影或出场投影。
     * @param signal 取消信号,在文件系统工作前后检查。
     * @returns 规范化文本、修订号与省略元数据。
     */
    read(request: SerialReadRequest, signal: AbortSignal): Promise<SerialReadResult>;
    /**
     * 原子地初始化项目或比较并替换一个资产。
     *
     * @param request 初始化数据,或一次单资产、带回修订号的替换。
     * @param signal 取消信号,在原子替换开始前生效。
     * @returns 含项目身份与提交前后修订号的收据。
     */
    apply(request: SerialApplyRequest, signal: AbortSignal): Promise<CommitReceipt>;
}
/**
 * 打开一个短篇集项目。
 *
 * @param root 工作区根目录(宿主已解析的规范路径)。
 * @param options 读取与写入上限。
 * @returns 该根目录下的项目句柄;文件在每次调用时按需读取,不做进程内缓存。
 */
export declare function openSerialProject(root: string, options: SerialProjectOptions): SerialProject;
/** 供工具层做审批卡片预览:把一个替换渲染成规范终态文本。 */
export declare function canonicalSerialAssetText(target: AssetRef, replacement: string): string;
/**
 * 供工具层做审批卡片预览:渲染初始化后的项目清单。
 *
 * 这里也校验 `creativeStrategy` 枚举:审批卡片与审批门都调用它,若它放行一个
 * 非法策略,审批人就会为一次注定失败的初始化点确认。
 */
export declare function canonicalSerialInitialization(request: SerialInitializeRequest): string;
/** 资产在项目内的相对路径,供审批卡片的 diff 路径使用。 */
export declare function serialAssetSource(target: AssetRef): string;
