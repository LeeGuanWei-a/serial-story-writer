/**
 * 非权威提案收件箱。
 *
 * ## 它是什么,不是什么
 *
 * 收件箱记录的是**建议**,不是写入。一条提案落盘之后,项目本身一个字节都没变 ——
 * 这正是 `SerialProposalReceipt.authoritative = false` 要表达的。要真的改项目,
 * 仍然只能走 Harness 原生一次性审批。
 *
 * ## 为什么是 JSON 文件而不是 SQLite(§7 决定 1)
 *
 * 收件箱不需要复杂查询,条目数被 `maxPendingProposals` 限死;而 `better-sqlite3`
 * 是原生模块,在多环境下有编译风险。一条提案一个文件也让"人审阅"这件事变得可
 * 直接检查:打开 `.serial/inbox/` 就能看。
 *
 * ## 三条不变量
 *
 * 1. **身份由 Host 供给**。模型既不能提供也不能猜测会话与调用身份 —— 它们在
 *    {@link SerialProposalIdentity} 里,由工具层从执行上下文取。
 * 2. **规范化哈希即幂等键**。同一个规范化命令重复提交不会产生第二条,而是返回
 *    既有收据(`created: false`)。命令先经项目层的规范化,所以排版抖动不会
 *    制造重复提案。
 * 3. **建议必须先合法**。一条提案承载的就是将来要落盘的内容,因此这里用与写入
 *    路径**完全同一套**校验函数;收件箱里不可能存在一条注定被拒的建议。
 */
import { type SerialProposalCommand } from './types.js';
import { type SerialProjectOptions } from './serial-project.js';
/** 收件箱选项。 */
export interface SerialProposalInboxOptions {
    /** 单条提案的规范字节上限。 */
    readonly maxProposalBytes: number;
    /** 待审阅提案的条数上限。 */
    readonly maxPendingProposals: number;
}
/** 由 Host 供给的提案身份;模型无法提供。 */
export interface SerialProposalIdentity {
    /** 提出建议的会话。 */
    readonly sessionId: string;
    /** 该会话里这一次工具调用。 */
    readonly callId: string;
}
/** 一条已记录的提案。 */
export interface SerialProposalRecord {
    /** 收件箱内的稳定 id(也是文件名主干)。 */
    readonly proposalId: string;
    /** 规范化命令的哈希 —— 同一个命令恒定得到同一个值,这就是幂等键。 */
    readonly changeSetId: string;
    readonly createdAt: string;
    readonly identity: SerialProposalIdentity;
    readonly argumentHash: string;
    /** 收件箱里的条目一律是待审阅;写入与否由人在审批时决定。 */
    readonly status: 'pending';
    readonly summary: string;
    readonly command: SerialProposalCommand;
}
/** 记录一条提案之后拿到的收据。 */
export interface SerialProposalReceipt {
    readonly proposalId: string;
    readonly changeSetId: string;
    readonly argumentHash: string;
    /** 恒为 false:这条收据**不**代表项目发生了任何变化。 */
    readonly authoritative: false;
    readonly status: 'pending';
    /** false 表示命中了既有提案(幂等),没有新增条目。 */
    readonly created: boolean;
    /** 当前待审阅条数。 */
    readonly pendingCount: number;
}
/** 收件箱句柄。 */
export interface SerialProposalInbox {
    /**
     * 记录一条提案。
     *
     * @param command 已规范化的命令。
     * @param summary 供人一眼看懂的一句话。
     * @param identity Host 供给的身份。
     * @param signal 取消信号。
     * @returns 收据;`authoritative` 恒为 false。
     */
    propose(command: SerialProposalCommand, summary: string, identity: SerialProposalIdentity, signal: AbortSignal): Promise<SerialProposalReceipt>;
    /**
     * 列出全部待审阅提案,按时间升序。
     *
     * @param signal 取消信号。
     * @returns 提案数组;目录不存在时为空。
     */
    list(signal: AbortSignal): Promise<readonly SerialProposalRecord[]>;
}
/**
 * 校验并规范化一条提案命令。
 *
 * 内容型命令(initialize / replaceAsset / newCollection)走的是与写入路径**同一套**
 * 规范化函数,因此"收件箱里的建议将来能不能落盘"在记录时就已经确定。
 *
 * @param input 模型提交的原始命令。
 * @returns 规范化后的命令。
 */
export declare function normalizeProposalCommand(input: unknown): SerialProposalCommand;
/** 一条命令供人看的一句话。 */
export declare function proposalSummary(command: SerialProposalCommand): string;
/**
 * 打开一个项目的收件箱。
 *
 * @param root 工作区根目录。
 * @param options 大小与条数上限。
 * @returns 收件箱句柄。
 */
export declare function openSerialInbox(root: string, options: SerialProposalInboxOptions): SerialProposalInbox;
/**
 * 提案需要项目存在性检查:只有 `initialize` 建议允许在未初始化时提出,其余命令
 * 都要求项目已经在。
 *
 * 这里不额外读盘 —— 由调用方(工具层)在打开项目时顺带判定,因为它已经掌握了
 * `project.json` 是否存在。
 *
 * @param command 已规范化的命令。
 * @param projectExists `.serial/project.json` 是否存在。
 */
export declare function assertProposalProjectState(command: SerialProposalCommand, projectExists: boolean): void;
/** 供工具层复用的项目层选项类型别名。 */
export type ProposalProjectOptions = SerialProjectOptions;
