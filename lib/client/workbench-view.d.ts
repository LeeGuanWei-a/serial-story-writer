/**
 * 短篇集工作台面板(只读)。
 *
 * 它与「短篇集作家」预设是同一个 `.serial/` 项目的两侧:预设是模型侧,这里是
 * **人**侧 —— 不经过模型就能看世界观、短篇集、章节与人物出场。
 *
 * 三条硬约束决定了本文件的写法:
 *
 * 1. **浏览器不持 mutation RPC**。面板只读;改稿仍然走会话里的原生审批。
 * 2. **不引入 `@deepseek-ai/dsh-client-ui-primitives`**。样式只用主题 token
 *    (`inherit` / `currentColor` / `color-mix`),因此明暗主题都自动跟随。
 * 3. **不伪造数据**。读不到就说读不到:没有会话、项目未初始化、资产缺失、蓝图
 *    缺失,各自有各自的呈现,绝不把"不知道"画成"空"。
 *
 * 会话身份来自 `useSessions` 的 `retainedBy.mainView` —— `main` 插槽是 root 作用
 * 域,宿主明说 "other keys receive no Session binding",所以这是根作用域面板拿到
 * "当前会话"的原生途径(dsh 自己的会话浏览器就是这么找主视图会话的)。
 */
import { type ReactElement } from 'react';
import { type SerialChangeRemote } from './change-watch.ts';
import { type SerialWorkspaceFiles } from './serial-files.ts';
/** 宿主提供的快照选择器 hook 的最小切片。 */
export type SerialSelectorHook<T> = (select: (state: never) => T) => T | undefined;
/** 会话列表快照中本面板用到的部分。 */
interface SerialSessionList {
    readonly byId: Record<string, {
        readonly id?: string;
        readonly retainedBy?: {
            readonly mainView?: number;
        };
    } | undefined>;
}
/** 工作区列表快照中本面板用到的部分。 */
interface SerialWorkspaceList {
    readonly items: readonly {
        readonly workspaceId: string;
        readonly title?: string;
        readonly sessionIds?: readonly string[];
    }[];
}
/** 面板从宿主接收的标准 props,外加 `index.ts` 绑定进来的 Remote 切片。 */
export interface SerialWorkbenchPanelProps {
    readonly useSessions?: SerialSelectorHook<SerialSessionList>;
    readonly useWorkspaces?: SerialSelectorHook<SerialWorkspaceList>;
    /** 由 `index.ts` 绑定;缺失时面板渲染"通道不可用"而不是崩溃。 */
    readonly files?: SerialWorkspaceFiles;
    /**
     * 由 `index.ts` 绑定;缺失时面板只是不会自动刷新,其余功能照常。
     *
     * 写盘的是**会话里的模型**,读盘的是这个面板 —— 没有它,模型刚写完的稿子不会出现
     * 在界面上,除非用户自己刷新。
     */
    readonly watcher?: SerialChangeRemote;
}
/**
 * 找出主视图正在展示的会话。
 *
 * 根作用域的 `main` 面板拿不到 session binding,所以从会话列表里找"被主视图保留"
 * 的那一个 —— 与 dsh 会话浏览器的判断方式一致。
 *
 * @param list 会话列表快照。
 * @returns 会话 id;没有打开的会话时为 undefined。
 */
export declare function currentSessionId(list: SerialSessionList | undefined): string | undefined;
/**
 * 「短篇集工作台」主面板。
 *
 * @param props 宿主标准 props 与绑定的 Remote 切片。
 * @returns 面板元素。
 */
export declare function SerialWorkbenchPanel(props: SerialWorkbenchPanelProps): ReactElement;
export {};
