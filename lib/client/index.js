/**
 * Client 入口:把「短篇集工作台」挂到宿主侧栏与主列。
 *
 * 该模块由 `window.__ModuleLoader__` 以 lazy factory 载入,factory 返回一个
 * Cordis 客户端插件对象 `{ inject, apply }`。宿主提供 `slots` 与 `remote`;
 * 我们不直接操作 DOM、不调用 `createRoot`,也不替换应用根节点。
 *
 * 落点(来自 `Slots.listSubTree` 的实时契约):
 * - `sidebar.panellist`(list):注册 `id`/`order`/`label`,侧栏渲染按钮,
 *   该 list id 即对应的 `main` 面板 key。
 * - `main`(keyed):注册同名的 `key`,渲染主列面板;`conversation` 已被占用,不可触碰。
 *
 * 数据通道是 **Typert Remote** 而不是自建的 HTTP 通道:dsh 0.2.0-rc.2 里第三方
 * 插件注册 HTTP 通道会撞上 `webServer` 注入缺陷(§6.1),而 `workspaceFiles`
 * 这个现成的命名空间只读、以会话工作区为根,正好够用(§6.9)。
 */
import { createElement } from 'react';
import { SerialPanelIcon } from "./panel-icon.js";
import { SerialWorkbenchPanel } from "./workbench-view.js";
/** 侧栏面板与主面板共用的稳定 id。 */
export const SERIAL_PANEL_ID = 'serial-story';
/**
 * 本插件依赖的客户端服务。
 *
 * `remote.workspaceFiles` 是点号子服务:注入它即保证该 Remote 命名空间已绑定,
 * `ctx.remote.workspaceFiles` 才可用 —— dsh 自己的 `dsh-client-ui-sidebar-files`
 * 用的就是这个写法。
 */
export const inject = ['slots', 'remote', 'remote.workspaceFiles'];
/**
 * 注册侧栏图标与主列面板。
 *
 * 两个 slot 都通过 `slots.inject` 等待宿主宣告后再注册,因此加载顺序不影响结果;
 * 注册返回的 disposer 由宿主 fiber 生命周期回收。
 *
 * 面板需要 Remote 切片,而宿主只负责渲染组件、不注入服务,所以这里在 `apply`
 * 时把 `workspaceFiles` **绑定**进一个包装组件。包装必须用 `createElement` 创建
 * 元素 —— 直接调用 `SerialWorkbenchPanel(...)` 会让它里面的 hook 在"非组件"上执行,
 * 浏览器里同样会崩(verify-built 的 SSR 渲染正是为了拦这一条)。
 *
 * @param ctx Client 运行时上下文。
 */
export function apply(ctx) {
    const files = ctx.remote?.workspaceFiles;
    const stream = ctx.remote?.$stream;
    const changes = files?.changes;
    // 变更订阅需要两件东西:`$stream` 监督器与命名空间里的 `changes` 流方法。
    // 缺任一件就退化成"不自动刷新",而不是报错——面板其余功能仍然可用。
    const watcher = stream === undefined || changes === undefined
        ? undefined
        : { $stream: stream, workspaceFiles: { changes } };
    ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
        name: 'sidebar.panellist',
        id: SERIAL_PANEL_ID,
        order: 50,
        label: '短篇集工作台',
    }, SerialPanelIcon));
    ctx.slots.inject('main', () => ctx.slots.register({
        name: 'main',
        key: SERIAL_PANEL_ID,
    }, (props) => createElement(SerialWorkbenchPanel, { ...props, files, watcher })));
}
export { SerialPanelIcon } from "./panel-icon.js";
export { SerialWorkbenchPanel } from "./workbench-view.js";
export { loadProject, serialRevision, SERIAL_DIR } from "./serial-files.js";
