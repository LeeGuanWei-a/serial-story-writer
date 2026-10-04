/** Agent-scoped serial-story tools and their native approval policy. */
import type { Context } from '@deepseek-ai/cordis';
import type { SessionId } from '@deepseek-ai/dsh-session';
import type { Workspace } from '@deepseek-ai/dsh-workspace';
import type { PreToolDecision, ToolDefinition } from '@deepseek-ai/dsh-tools';
import z from '@deepseek-ai/schemastery';
import { type SerialApplyRequest } from './types.js';
declare module '@deepseek-ai/cordis' {
    interface Events {
        /** 一个会话把不同的 preset 写进了它的持久日志。 */
        'agent-preset/selected'(sessionId: SessionId, agentPreset: string): void;
    }
}
/** Deployment bounds for the model-facing serial-story tools. */
export interface Config {
    readonly assetBytes?: number;
    readonly workingSetBytes?: number;
    readonly queryMatches?: number;
    readonly maxProposalBytes?: number;
    readonly maxPendingProposals?: number;
}
/** Fail-loud validation and defaults for deployment-varying tool bounds. */
export declare const Config: z<Config>;
/** Deployment bounds for the proposal-based agent surface. */
export interface ShortStoryConfig {
    readonly maxProposalBytes?: number;
    readonly maxPendingProposals?: number;
}
/** Fail-loud validation and defaults for the proposal inbox bounds. */
export declare const ShortStoryConfig: z<ShortStoryConfig>;
/** Read-only Workspace resolution face used by the proposal-based serial-story tools. */
export interface ShortStoryWorkspaceRegistry {
    resolveByPath(path: string): Promise<Workspace | undefined>;
}
/**
 * Render one proposed mutation as a deterministic Harness diff card.
 *
 * 卡片展示**规范化后的终态字节**,而不是模型提交的原始文本,因此审批人看到的
 * 就是即将落盘的内容;路径也来自同一个资产映射,不会与实际文件位置漂移。
 */
export declare function presentSerialChange(request: SerialApplyRequest): {
    card: "diff";
    title: string;
    diffs: {
        path: string;
        oldText: null;
        newText: string;
    }[];
    locations: {
        path: string;
    }[];
};
/**
 * Require native approval for the mutation tool and delegate every other tool decision.
 *
 * 审批前**先把内容跑一遍规范化校验**。这一步很关键:非法内容在 `execute` 里必然
 * 失败,却已经消耗了审批人一次确认,而模型从中学到的只有"又被拒了"。改成直接
 * `deny` 之后,既不弹窗,也让模型立刻拿到含字段清单的精确原因。
 *
 * @param exec 待决的调用;只读取工具名与已解析参数。
 * @param next 后续决策。
 * @returns 非法内容为 `deny`,合法写入为 `ask`,其余工具原样下传。
 */
export declare function serialApprovalGate(exec: Pick<{
    name: string;
    arguments?: unknown;
}, 'name' | 'arguments'>, next: () => Promise<PreToolDecision>): Promise<PreToolDecision>;
/**
 * Construct the two model-visible serial-story tool definitions.
 */
export declare function createSerialToolDefinitions(config?: Config): readonly [ToolDefinition, ToolDefinition];
/**
 * Construct the model-visible proposal-based serial-story tools.
 *
 * `serial_read` 已接到真实项目层,因此预设至少提供一个可用的读取面;
 * `serial_propose_change` 仍以显式的 NOT_IMPLEMENTED 失败 —— 非权威提案收件箱
 * 尚未落地,绝不能让模型误以为建议已被受理。
 */
export declare function createSerialV2ToolDefinitions(config: ShortStoryConfig, workspaces: ShortStoryWorkspaceRegistry): readonly [ToolDefinition, ToolDefinition];
/** Stable Cordis plugin name. */
export declare const name = "dsh-serial-story-agent";
/** Required host services for agent lookup, scoped tools, prompt projection, and policy. */
export declare const inject: string[];
/**
 * Register the two domain tools and their mandatory one-shot approval policy.
 *
 * The dedicated preset surface is installed here too so the V1 entry stays
 * usable when the bundle is mounted directly without the preset realm; the
 * narrow `allow` set is the only tool catalog the preset inherits from its
 * host environment.
 */
export declare function apply(ctx: Context, config?: Config): void;
/** Register the proposal-based surface after the dedicated entry injects the Workspace registry. */
export declare function applyV2(ctx: Context, config?: ShortStoryConfig): void;
