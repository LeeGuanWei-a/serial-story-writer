window.__ModuleLoader__.load({ id: "@leeguanwei/dsh-serial-story", factory: (externalRequire) => {
  var __deps = {"0":{"./panel-icon.tsx":1,"./workbench-view.tsx":2,"./serial-files.ts":3},"1":{},"2":{"./change-watch.ts":4,"../serial-layout.js":5,"./markdown.ts":6,"../serial-export.js":7,"./serial-files.ts":3},"3":{"../serial-audit.js":8,"../serial-layout.js":5},"4":{},"5":{},"6":{},"7":{},"8":{}};
  var __cache = {};
  var __factories = {
  // 0: src/client/index.ts
  0: function (module, exports, require) {
      "use strict";
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
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.SERIAL_DIR = exports.serialRevision = exports.loadProject = exports.SerialWorkbenchPanel = exports.SerialPanelIcon = exports.inject = exports.SERIAL_PANEL_ID = void 0;
      exports.apply = apply;
      const react_1 = require("react");
      const panel_icon_tsx_1 = require("./panel-icon.tsx");
      const workbench_view_tsx_1 = require("./workbench-view.tsx");
      /** 侧栏面板与主面板共用的稳定 id。 */
      exports.SERIAL_PANEL_ID = 'serial-story';
      /**
       * 本插件依赖的客户端服务。
       *
       * `remote.workspaceFiles` 是点号子服务:注入它即保证该 Remote 命名空间已绑定,
       * `ctx.remote.workspaceFiles` 才可用 —— dsh 自己的 `dsh-client-ui-sidebar-files`
       * 用的就是这个写法。
       */
      exports.inject = ['slots', 'remote', 'remote.workspaceFiles'];
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
      function apply(ctx) {
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
              id: exports.SERIAL_PANEL_ID,
              order: 50,
              label: '短篇集工作台',
          }, panel_icon_tsx_1.SerialPanelIcon));
          ctx.slots.inject('main', () => ctx.slots.register({
              name: 'main',
              key: exports.SERIAL_PANEL_ID,
          }, (props) => (0, react_1.createElement)(workbench_view_tsx_1.SerialWorkbenchPanel, { ...props, files, watcher })));
      }
      var panel_icon_tsx_2 = require("./panel-icon.tsx");
      Object.defineProperty(exports, "SerialPanelIcon", { enumerable: true, get: function () { return panel_icon_tsx_2.SerialPanelIcon; } });
      var workbench_view_tsx_2 = require("./workbench-view.tsx");
      Object.defineProperty(exports, "SerialWorkbenchPanel", { enumerable: true, get: function () { return workbench_view_tsx_2.SerialWorkbenchPanel; } });
      var serial_files_ts_1 = require("./serial-files.ts");
      Object.defineProperty(exports, "loadProject", { enumerable: true, get: function () { return serial_files_ts_1.loadProject; } });
      Object.defineProperty(exports, "serialRevision", { enumerable: true, get: function () { return serial_files_ts_1.serialRevision; } });
      Object.defineProperty(exports, "SERIAL_DIR", { enumerable: true, get: function () { return serial_files_ts_1.SERIAL_DIR; } });

  },
  // 1: src/client/panel-icon.tsx
  1: function (module, exports, require) {
      "use strict";
      /**
       * 侧栏图标。
       *
       * 只画形状,颜色一律 `currentColor`,因此明暗主题与选中态都由宿主决定,
       * 本插件不写死任何色值。
       */
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.SerialPanelIcon = SerialPanelIcon;
      const react_1 = require("react");
      /**
       * 侧栏面板图标。继承宿主文字颜色,随选中状态调整不透明度。
       *
       * @param props 宿主提供的尺寸与选中状态。
       * @returns 内联 SVG 图标元素。
       */
      function SerialPanelIcon(props) {
          return (0, react_1.createElement)('svg', {
              width: props.size,
              height: props.size,
              viewBox: '0 0 24 24',
              fill: 'none',
              stroke: 'currentColor',
              strokeWidth: 1.6,
              strokeLinecap: 'round',
              strokeLinejoin: 'round',
              'aria-hidden': true,
              style: { display: 'block', opacity: props.active ? 1 : 0.72 },
          }, (0, react_1.createElement)('path', { d: 'M4 5.5h6.2v13H4z' }), (0, react_1.createElement)('path', { d: 'M13.8 5.5H20v8.4h-6.2z' }), (0, react_1.createElement)('path', { d: 'M13.8 16.4H20v2.1h-6.2z' }));
      }

  },
  // 2: src/client/workbench-view.tsx
  2: function (module, exports, require) {
      "use strict";
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
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.currentSessionId = currentSessionId;
      exports.SerialWorkbenchPanel = SerialWorkbenchPanel;
      const react_1 = require("react");
      const change_watch_ts_1 = require("./change-watch.ts");
      const serial_layout_js_1 = require("../serial-layout.js");
      const markdown_ts_1 = require("./markdown.ts");
      const serial_export_js_1 = require("../serial-export.js");
      const serial_files_ts_1 = require("./serial-files.ts");
      /**
       * 找出主视图正在展示的会话。
       *
       * 根作用域的 `main` 面板拿不到 session binding,所以从会话列表里找"被主视图保留"
       * 的那一个 —— 与 dsh 会话浏览器的判断方式一致。
       *
       * @param list 会话列表快照。
       * @returns 会话 id;没有打开的会话时为 undefined。
       */
      function currentSessionId(list) {
          if (list === undefined)
              return undefined;
          for (const session of Object.values(list.byId)) {
              if (session !== undefined && (session.retainedBy?.mainView ?? 0) > 0) {
                  return session.id;
              }
          }
          return undefined;
      }
      const PALETTE = {
          font: 'inherit',
          muted: 'color-mix(in srgb, currentColor 62%, transparent)',
          faint: 'color-mix(in srgb, currentColor 42%, transparent)',
          line: '1px solid color-mix(in srgb, currentColor 18%, transparent)',
      };
      const SHELL_STYLE = {
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          overflow: 'hidden',
          color: 'inherit',
          fontSize: '13px',
          lineHeight: 1.6,
      };
      const BODY_STYLE = {
          display: 'grid',
          gridTemplateColumns: 'minmax(180px, 240px) 1fr',
          flex: 1,
          minHeight: 0,
      };
      const TREE_STYLE = {
          overflow: 'auto',
          padding: '8px 4px 20px',
          borderRight: PALETTE.line,
      };
      const DETAIL_STYLE = {
          overflow: 'auto',
          padding: '14px 20px 32px',
      };
      /** 一行"标签 + 值"。 */
      function fact(label, value) {
          return (0, react_1.createElement)('div', { style: { display: 'flex', gap: '10px', alignItems: 'baseline' } }, (0, react_1.createElement)('span', { style: { opacity: 0.55, minWidth: '74px' } }, label), (0, react_1.createElement)('span', { style: { minWidth: 0, overflowWrap: 'anywhere' } }, value));
      }
      /** 小节标题。 */
      function section(title) {
          return (0, react_1.createElement)('div', {
              style: { marginTop: '16px', paddingTop: '8px', borderTop: PALETTE.line, fontWeight: 600 },
          }, title);
      }
      /** 树里的一行按钮。 */
      function treeRow(key, label, selected, depth, onSelect, badge) {
          return (0, react_1.createElement)('button', {
              key,
              type: 'button',
              onClick: onSelect,
              style: {
                  display: 'flex',
                  width: '100%',
                  gap: '6px',
                  alignItems: 'baseline',
                  padding: '2px 8px 2px ' + `${8 + depth * 12}px`,
                  border: 'none',
                  borderRadius: '4px',
                  background: selected ? 'color-mix(in srgb, currentColor 14%, transparent)' : 'transparent',
                  color: 'inherit',
                  font: 'inherit',
                  textAlign: 'left',
                  cursor: 'pointer',
              },
          }, (0, react_1.createElement)('span', { style: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, label), badge === undefined ? null : (0, react_1.createElement)('span', { style: { color: PALETTE.faint, fontSize: '11px' } }, badge));
      }
      /** 修订号短展示:前 8 位,`absent` 原样显示。 */
      function shortRevision(revision) {
          return revision === 'absent' ? 'absent' : revision.slice(0, 8);
      }
      /** 一条资产的"路径 + 修订号 + 字节数"。 */
      function assetLine(label, asset) {
          return fact(label, asset.revision === 'absent'
              ? 'absent'
              : `${shortRevision(asset.revision)} · ${asset.bytes} B`);
      }
      /** 解析 JSON 资产文本;失败返回 undefined 而不是抛错。 */
      function parseJson(text) {
          try {
              return JSON.parse(text);
          }
          catch {
              return undefined;
          }
      }
      /** 安全取对象字段。 */
      function field(value, key) {
          return typeof value === 'object' && value !== null && !Array.isArray(value)
              ? value[key]
              : undefined;
      }
      /** 把未知值渲染成一行文字。 */
      function describe(value) {
          if (value === undefined || value === null)
              return '—';
          if (typeof value === 'string')
              return value;
          if (typeof value === 'number' || typeof value === 'boolean')
              return String(value);
          return JSON.stringify(value);
      }
      /** 把字符串数组渲染成列表。 */
      function stringList(values) {
          return (0, react_1.createElement)('ul', { style: { margin: 0, paddingLeft: '18px' } }, ...values.map((value, index) => (0, react_1.createElement)('li', { key: index }, value)));
      }
      /**
       * 「短篇集工作台」主面板。
       *
       * @param props 宿主标准 props 与绑定的 Remote 切片。
       * @returns 面板元素。
       */
      function SerialWorkbenchPanel(props) {
          const useSessions = props.useSessions ?? (() => undefined);
          const selectWorkspaces = props.useWorkspaces ?? (() => undefined);
          // hook 必须无条件按同样顺序调用,所以这里始终调用,只是可能拿到 undefined。
          const sessionList = useSessions(state => state);
          const workspaceList = selectWorkspaces(state => state);
          const sessionId = currentSessionId(sessionList);
          const [selection, setSelection] = (0, react_1.useState)({ kind: 'world' });
          const [state, setState] = (0, react_1.useState)({ kind: 'idle' });
          const [detail, setDetail] = (0, react_1.useState)(undefined);
          const [exportText, setExportText] = (0, react_1.useState)(undefined);
          const files = props.files;
          const watcher = props.watcher;
          // 磁盘版本号:每次变更通知就加一,让下面的加载 effect 重跑。用计数而不是把快照
          // 塞进依赖里,是为了让"重新加载"这件事只有一个入口。
          const [diskRevision, setDiskRevision] = (0, react_1.useState)(0);
          (0, react_1.useEffect)(() => {
              if (files === undefined || sessionId === undefined) {
                  setState({ kind: 'idle' });
                  return;
              }
              const controller = new AbortController();
              setState({ kind: 'loading' });
              (0, serial_files_ts_1.loadProject)(files, sessionId, controller.signal)
                  .then(snapshot => { if (!controller.signal.aborted)
                  setState({ kind: 'loaded', snapshot }); })
                  .catch((error) => {
                  if (controller.signal.aborted)
                      return;
                  setState({ kind: 'failed', message: error instanceof Error ? error.message : String(error) });
              });
              return () => controller.abort();
          }, [files, sessionId, diskRevision]);
          // 订阅项目目录:模型每次写盘都重新读一遍快照。
          //
          // 只关心"**有**变化",不关心变了什么 —— 重新读整个项目最简单,也最不容易漏掉
          // 跨文件的影响(改一个 characterId 会牵动蓝图与章节)。快照本身是有界的。
          (0, react_1.useEffect)(() => {
              if (watcher === undefined || watcher.workspaceFiles === undefined || sessionId === undefined)
                  return;
              const controller = new AbortController();
              void (async () => {
                  try {
                      for await (const kind of (0, change_watch_ts_1.watchWorkspacePath)(watcher, sessionId, serial_layout_js_1.SERIAL_DIR, controller.signal)) {
                          // ready 只表示宿主侧订阅已生效,不是一次内容变化。
                          if (kind === 'ready')
                              continue;
                          setDiskRevision(current => current + 1);
                      }
                  }
                  catch {
                      // 订阅失败不该影响面板本身:它仍然能手动加载与阅读,只是不再自动刷新。
                  }
              })();
              return () => controller.abort();
          }, [watcher, sessionId]);
          const snapshot = state.kind === 'loaded' ? state.snapshot : undefined;
          // 选中的节点要另读内容(结构快照只带存在性与大小)。
          (0, react_1.useEffect)(() => {
              if (files === undefined || sessionId === undefined || snapshot?.kind !== 'ready') {
                  setDetail(undefined);
                  return;
              }
              const controller = new AbortController();
              const relative = selection.kind === 'chapter'
                  ? (0, serial_files_ts_1.chapterDraftPath)(selection.slug, selection.chapter)
                  : undefined;
              if (relative === undefined) {
                  setDetail(undefined);
                  return;
              }
              (0, serial_files_ts_1.readAsset)(files, sessionId, relative, controller.signal)
                  .then(asset => { if (!controller.signal.aborted)
                  setDetail(asset); })
                  .catch(() => { if (!controller.signal.aborted)
                  setDetail(undefined); });
              return () => controller.abort();
          }, [files, sessionId, snapshot, selection]);
          // 导出要读**全部**章节正文(结构快照里只有大小),所以按需另读一次。装配用的是与
          // Host 侧 `kind="export"` 同一个纯函数。
          (0, react_1.useEffect)(() => {
              if (files === undefined || sessionId === undefined || snapshot?.kind !== 'ready' || selection.kind !== 'export') {
                  setExportText(undefined);
                  return;
              }
              const collection = snapshot.collections.find(candidate => candidate.slug === selection.slug);
              if (collection === undefined) {
                  setExportText(undefined);
                  return;
              }
              const controller = new AbortController();
              void (async () => {
                  try {
                      const chapters = [];
                      for (const chapter of collection.chapters) {
                          const draft = await (0, serial_files_ts_1.readAsset)(files, sessionId, (0, serial_files_ts_1.chapterDraftPath)(selection.slug, chapter.chapter), controller.signal);
                          chapters.push({
                              chapter: chapter.chapter,
                              title: (0, serial_files_ts_1.stringField)(chapter.blueprint.text, 'title'),
                              text: draft.revision === 'absent' ? '' : draft.text,
                          });
                      }
                      if (controller.signal.aborted)
                          return;
                      setExportText((0, serial_export_js_1.assembleCollectionMarkdown)({
                          slug: collection.slug,
                          title: (0, serial_files_ts_1.stringField)(collection.blueprint.text, 'title'),
                          theme: (0, serial_files_ts_1.stringField)(collection.blueprint.text, 'theme'),
                          summary: (0, serial_files_ts_1.stringField)(collection.blueprint.text, 'summary'),
                          status: (0, serial_files_ts_1.stringField)(collection.blueprint.text, 'status'),
                          season: (0, serial_files_ts_1.stringField)(collection.timeline.text, 'season'),
                          startDate: (0, serial_files_ts_1.stringField)(collection.timeline.text, 'startDate'),
                          endDate: (0, serial_files_ts_1.stringField)(collection.timeline.text, 'endDate'),
                          chapters,
                      }));
                  }
                  catch {
                      if (!controller.signal.aborted)
                          setExportText(undefined);
                  }
              })();
              return () => controller.abort();
          }, [files, sessionId, snapshot, selection]);
          const workspaceTitle = (0, react_1.useMemo)(() => {
              if (sessionId === undefined || workspaceList === undefined)
                  return undefined;
              const owner = workspaceList.items.find(item => item.sessionIds?.includes(sessionId) === true);
              return owner?.title ?? owner?.workspaceId;
          }, [sessionId, workspaceList]);
          return (0, react_1.createElement)('section', { 'aria-label': '短篇集工作台', style: SHELL_STYLE }, (0, react_1.createElement)('header', {
              style: { padding: '12px 20px', borderBottom: PALETTE.line, display: 'flex', gap: '10px', alignItems: 'baseline' },
          }, (0, react_1.createElement)('span', { style: { fontWeight: 600 } }, '短篇集工作台'), (0, react_1.createElement)('span', { style: { color: PALETTE.faint, fontSize: '12px' } }, '只读'), (0, react_1.createElement)('span', { style: { flex: 1 } }), (0, react_1.createElement)('span', { style: { color: PALETTE.muted, fontSize: '12px' } }, sessionId === undefined ? '无打开的会话' : workspaceTitle ?? sessionId.slice(0, 8))), body(props, state, snapshot, selection, setSelection, detail, exportText, sessionId));
      }
      /** 面板主体:左树右详情。 */
      function body(props, state, snapshot, selection, select, detail, exportText, sessionId) {
          if (props.files === undefined) {
              return notice('这一侧还没有连上宿主的数据通道。工作台的只读视图需要 `remote.workspaceFiles`;重启 dsh 后再打开本面板。');
          }
          if (sessionId === undefined) {
              return notice('先打开一个会话。工作台按会话的工作区读取项目 —— 没有会话就没有可读的工作区。');
          }
          if (state.kind === 'loading' || state.kind === 'idle')
              return notice('正在读取项目…');
          if (state.kind === 'failed')
              return notice(`读取失败:${state.message}`);
          if (snapshot === undefined)
              return notice('读取失败:没有拿到快照。');
          if (snapshot.kind === 'absent') {
              return notice(snapshot.proposals.length === 0
                  ? '这个工作区里还没有短篇集项目(缺 .serial/project.json)。让「短篇集作家」在会话里执行一次 initialize 就会出现在这里。'
                  : `这个工作区还没有短篇集项目,但收件箱里有 ${snapshot.proposals.length} 条待审阅提案(例如「${snapshot.proposals[0].summary}」)。提案是非权威建议,项目仍未初始化。`);
          }
          if (snapshot.kind === 'unreadable')
              return notice(`读取失败:${snapshot.message}`);
          return (0, react_1.createElement)('div', { style: BODY_STYLE }, (0, react_1.createElement)('nav', { style: TREE_STYLE }, ...tree(snapshot, selection, select)), (0, react_1.createElement)('div', { style: DETAIL_STYLE }, ...detailOf(snapshot, selection, detail, exportText)));
      }
      /** 居中提示。 */
      function notice(text) {
          return (0, react_1.createElement)('div', {
              style: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '32px', textAlign: 'center' },
          }, (0, react_1.createElement)('p', { style: { margin: 0, maxWidth: '46ch', color: PALETTE.muted } }, text));
      }
      /** 世界观树。 */
      function tree(snapshot, selection, select) {
          const worldName = describe(field(parseJson(snapshot.project.text), 'worldName'));
          const rows = [
              treeRow('project', `项目 · ${worldName}`, selection.kind === 'project', 0, () => select({ kind: 'project' })),
              treeRow('world', '世界观设定', selection.kind === 'world', 0, () => select({ kind: 'world' })),
              treeRow('characters', '人物档案', selection.kind === 'characters', 0, () => select({ kind: 'characters' })),
              // 提案放在显眼处:它们是"待审阅的建议",不是已落盘的改动 —— 面板有责任让
              // 这两件事在视觉上就不一样。
              treeRow('inbox', '待审阅提案', selection.kind === 'inbox', 0, () => select({ kind: 'inbox' }), snapshot.proposals.length === 0 ? undefined : `${snapshot.proposals.length} 条`),
              // 巡检与 Host 侧 `serial_read kind="audit"` 是同一个判定函数,所以模型看到的结论
              // 与这里显示的**必然一致**。
              treeRow('audit', '跨集巡检', selection.kind === 'audit', 0, () => select({ kind: 'audit' }), auditBadge(snapshot.audit)),
          ];
          for (const collection of snapshot.collections) {
              const title = describe(field(parseJson(collection.blueprint.text), 'title'));
              const selected = selection.kind === 'collection' && selection.slug === collection.slug;
              rows.push(treeRow(`collection:${collection.slug}`, `短篇集 · ${title}`, selected, 0, () => select({ kind: 'collection', slug: collection.slug }), `${collection.chapters.length} 章`));
              for (const chapter of collection.chapters) {
                  // 缺蓝图 = appearances 与故事线都看不到这一章(§6.8)。用一个记号让它可见。
                  const badge = chapter.blueprint.revision === 'absent' ? '缺蓝图' : undefined;
                  const chapterSelected = selection.kind === 'chapter'
                      && selection.slug === collection.slug
                      && selection.chapter === chapter.chapter;
                  rows.push(treeRow(`chapter:${collection.slug}:${chapter.chapter}`, `第 ${chapter.chapter} 章`, chapterSelected, 1, () => select({ kind: 'chapter', slug: collection.slug, chapter: chapter.chapter }), badge));
              }
              rows.push(treeRow(`export:${collection.slug}`, '导出整集', selection.kind === 'export' && selection.slug === collection.slug, 1, () => select({ kind: 'export', slug: collection.slug })));
          }
          return rows;
      }
      /** 右侧详情。 */
      function detailOf(snapshot, selection, detail, exportText) {
          switch (selection.kind) {
              case 'project': return projectDetail(snapshot);
              case 'world': return worldDetail(snapshot);
              case 'characters': return charactersDetail(snapshot);
              case 'inbox': return inboxDetail(snapshot);
              case 'audit': return auditDetail(snapshot);
              case 'collection': return collectionDetail(snapshot, selection.slug);
              case 'export': return exportDetail(snapshot, selection.slug, exportText);
              case 'chapter': return chapterDetail(snapshot, selection, detail);
          }
      }
      /**
       * 左树上巡检节点的徽标。
       *
       * @param audit 巡检结果。
       * @returns `错误 N · 警告 M`;都没有时是 `干净`。
       */
      function auditBadge(audit) {
          const errors = audit.findings.filter(finding => finding.severity === 'error').length;
          const warnings = audit.findings.length - errors;
          if (errors === 0 && warnings === 0)
              return '干净';
          return errors > 0 ? `错误 ${errors} · 警告 ${warnings}` : `警告 ${warnings}`;
      }
      /**
       * 跨集巡检报告。
       *
       * 判定来自与 Host 侧同一个纯函数(`src/serial-audit.ts`),所以这里的结论与模型
       * `serial_read kind="audit"` 拿到的**必然一致** —— 不会出现"模型说没问题、面板说有问题"。
       *
       * @param snapshot 已加载的项目快照。
       * @returns 详情区元素。
       */
      function auditDetail(snapshot) {
          const audit = snapshot.audit;
          const errors = audit.findings.filter(finding => finding.severity === 'error');
          const warnings = audit.findings.filter(finding => finding.severity === 'warning');
          const rows = [
              (0, react_1.createElement)('h2', { style: { margin: 0, fontSize: '15px', fontWeight: 600 } }, '跨集巡检'),
              (0, react_1.createElement)('p', { style: { margin: '4px 0 0', color: PALETTE.muted } }, `巡视了 ${audit.collections} 集 / ${audit.chapters} 章。这是**报告**不是校验器 —— 有问题也不会让读取失败,一份有缺口的手稿仍然应该能读。`),
              fact('错误', String(errors.length)),
              fact('警告', String(warnings.length)),
          ];
          if (audit.truncated) {
              rows.push((0, react_1.createElement)('p', { style: { margin: '6px 0 0', color: PALETTE.muted } }, '(发现过多,已截断;完整清单以模型侧的 kind="audit" 为准。)'));
          }
          if (audit.findings.length === 0) {
              rows.push((0, react_1.createElement)('p', { style: { margin: '10px 0 0', color: PALETTE.muted } }, '没有发现问题。'));
              return rows;
          }
          rows.push(section('发现'));
          for (const finding of audit.findings) {
              rows.push((0, react_1.createElement)('div', {
                  key: `${finding.code}-${finding.where}`,
                  style: { marginTop: '8px', paddingTop: '8px', borderTop: PALETTE.line },
              }, (0, react_1.createElement)('div', { style: { display: 'flex', gap: '8px', alignItems: 'baseline' } }, (0, react_1.createElement)('span', {
                  style: {
                      fontSize: '11px',
                      padding: '0 6px',
                      borderRadius: '999px',
                      border: PALETTE.line,
                      color: finding.severity === 'error' ? 'inherit' : PALETTE.muted,
                      fontWeight: finding.severity === 'error' ? 600 : 400,
                      whiteSpace: 'nowrap',
                  },
              }, finding.severity === 'error' ? '错误' : '警告'), (0, react_1.createElement)('code', { style: { fontSize: '12px', color: PALETTE.muted } }, finding.code), (0, react_1.createElement)('span', { style: { fontSize: '12px', color: PALETTE.faint, overflowWrap: 'anywhere' } }, finding.where)), (0, react_1.createElement)('p', { style: { margin: '2px 0 0', overflowWrap: 'anywhere' } }, finding.detail)));
          }
          return rows;
      }
      /**
       * 整集导出视图。
       *
       * 装配用的是 `src/serial-export.ts` 里那个纯函数 —— **与模型 `serial_read kind="export"`
       * 是同一份实现**,所以面板里看到的整集与模型读到的必然逐字节相同。
       *
       * 文档既在这里显示(永远可用、可直接选取复制),也提供下载按钮。下载走的是浏览器本地
       * 动作:不发任何 Host 请求、不写项目。它在没有 `document` 的环境里会安静降级为"只显示"。
       *
       * @param snapshot 已加载的项目快照。
       * @param slug 短篇集 slug。
       * @param text 已装配的文本;还没读到时为 undefined。
       * @returns 详情区元素。
       */
      function exportDetail(snapshot, slug, text) {
          const collection = snapshot.collections.find(candidate => candidate.slug === slug);
          const rows = [
              (0, react_1.createElement)('h2', { style: { margin: 0, fontSize: '15px', fontWeight: 600 } }, `导出整集 · ${slug}`),
              (0, react_1.createElement)('p', { style: { margin: '4px 0 0', color: PALETTE.muted } }, '这是把这一集装订成**一份** Markdown 的结果:集名、题记,然后每章一个标题加正文,按章节号升序。没有正文的章保留标题并标出缺失 —— 不会静默丢章。'),
          ];
          if (text === undefined) {
              rows.push((0, react_1.createElement)('p', { style: { margin: '8px 0 0', color: PALETTE.muted } }, '正在装配…'));
              return rows;
          }
          rows.push(fact('字节数', String(new TextEncoder().encode(text).byteLength)));
          rows.push(fact('章数', String(collection?.chapters.length ?? 0)));
          rows.push((0, react_1.createElement)('div', { style: { marginTop: '8px' } }, (0, react_1.createElement)('button', {
              type: 'button',
              onClick: () => downloadText(`${slug}.md`, text),
              style: {
                  font: 'inherit',
                  fontSize: '12px',
                  color: 'inherit',
                  background: 'color-mix(in srgb, currentColor 8%, transparent)',
                  border: PALETTE.line,
                  borderRadius: '6px',
                  padding: '4px 10px',
                  cursor: 'pointer',
              },
          }, `下载 ${slug}.md`)));
          rows.push(section('文稿'));
          rows.push((0, react_1.createElement)('div', {
              style: {
                  background: 'color-mix(in srgb, currentColor 5%, transparent)',
                  borderRadius: '6px',
                  padding: '12px 14px',
                  maxHeight: '52vh',
                  overflow: 'auto',
              },
          }, ...markdownBlocks(text)));
          return rows;
      }
      /**
       * 触发一次浏览器本地下载。
       *
       * 刻意做完整的能力探测:没有 `document` / `URL.createObjectURL` 的环境(或任何一步
       * 抛错)都只是下载不了 —— 文稿仍然显示在上面,可以直接选取复制。绝不为了一个便利功能
       * 让面板崩掉。
       *
       * @param fileName 建议的文件名。
       * @param text 文件内容。
       */
      function downloadText(fileName, text) {
          try {
              if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function')
                  return;
              const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
              const anchor = document.createElement('a');
              anchor.href = url;
              anchor.download = fileName;
              anchor.click();
              URL.revokeObjectURL(url);
          }
          catch {
              // 下载是锦上添花;失败时上面的文稿视图仍然可用。
          }
      }
      /** 待审阅提案一览。 */
      function inboxDetail(snapshot) {
          if (snapshot.proposals.length === 0) {
              return [
                  (0, react_1.createElement)('h2', { style: { margin: 0, fontSize: '15px', fontWeight: 600 } }, '待审阅提案'),
                  (0, react_1.createElement)('p', { style: { margin: '8px 0 0', color: PALETTE.muted } }, '收件箱是空的。提案模式下的模型可以把修改建议写进 .serial/inbox/,等人审阅 —— 它们不会自动落盘。'),
              ];
          }
          return [
              (0, react_1.createElement)('h2', { style: { margin: 0, fontSize: '15px', fontWeight: 600 } }, `待审阅提案(${snapshot.proposals.length})`),
              (0, react_1.createElement)('p', { style: { margin: '4px 0 0', color: PALETTE.muted } }, '以下都是**建议**:项目本身一个字节都没有改变。要落实其中一条,需要走原生一次性审批的写入路径。'),
              ...snapshot.proposals.map(proposal => (0, react_1.createElement)('div', {
                  key: proposal.proposalId,
                  style: { marginTop: '12px', paddingTop: '10px', borderTop: PALETTE.line },
              }, fact('摘要', proposal.summary), fact('命令', proposal.commandKind), fact('状态', `${proposal.status}(非权威)`), fact('时间', proposal.createdAt), fact('id', proposal.proposalId), (0, react_1.createElement)('pre', {
                  style: {
                      margin: '6px 0 0',
                      whiteSpace: 'pre-wrap',
                      overflowWrap: 'anywhere',
                      font: 'inherit',
                      fontSize: '12px',
                      color: PALETTE.muted,
                      background: 'color-mix(in srgb, currentColor 6%, transparent)',
                      borderRadius: '6px',
                      padding: '8px 10px',
                      maxHeight: '30vh',
                      overflow: 'auto',
                  },
              }, proposal.commandText))),
          ];
      }
      function projectDetail(snapshot) {
          const project = parseJson(snapshot.project.text);
          const rules = (0, serial_files_ts_1.stringArrayField)(snapshot.project.text, 'writingRules');
          return [
              (0, react_1.createElement)('h2', { style: { margin: 0, fontSize: '15px', fontWeight: 600 } }, '项目清单'),
              fact('世界名', describe(field(project, 'worldName'))),
              fact('世界 id', describe(field(project, 'worldId'))),
              fact('语言', describe(field(project, 'language'))),
              fact('基调', describe(field(project, 'tone'))),
              fact('创作策略', describe(field(project, 'creativeStrategy'))),
              fact('创建', describe(field(project, 'createdAt'))),
              assetLine('修订号', snapshot.project),
              rules.length === 0 ? null : section('创作方针'),
              rules.length === 0 ? null : stringList(rules),
          ].filter((item) => item !== null);
      }
      function worldDetail(snapshot) {
          const text = snapshot.world.text;
          if (snapshot.world.revision === 'absent') {
              return [(0, react_1.createElement)('h2', { style: { margin: 0, fontSize: '15px', fontWeight: 600 } }, '世界观设定'),
                  (0, react_1.createElement)('p', { style: { color: PALETTE.muted } }, 'world.json 还不存在。')];
          }
          const world = parseJson(text);
          const locations = (0, serial_files_ts_1.stringArrayField)(text, 'locations');
          const organizations = (0, serial_files_ts_1.stringArrayField)(text, 'organizations');
          const rules = (0, serial_files_ts_1.stringArrayField)(text, 'rules');
          const glossary = field(world, 'glossary');
          return [
              (0, react_1.createElement)('h2', { style: { margin: 0, fontSize: '15px', fontWeight: 600 } }, '世界观设定'),
              fact('时代', describe(field(world, 'era'))),
              assetLine('修订号', snapshot.world),
              section('一句话设定'),
              (0, react_1.createElement)('p', { style: { margin: 0, whiteSpace: 'pre-wrap' } }, describe(field(world, 'setting'))),
              organizations.length === 0 ? null : section(`机构(${organizations.length})`),
              organizations.length === 0 ? null : stringList(organizations),
              locations.length === 0 ? null : section(`地点(${locations.length})`),
              locations.length === 0 ? null : stringList(locations),
              rules.length === 0 ? null : section(`世界如何运转(${rules.length})`),
              rules.length === 0 ? null : stringList(rules),
              !Array.isArray(glossary) || glossary.length === 0 ? null : section(`术语(${glossary.length})`),
              !Array.isArray(glossary) || glossary.length === 0 ? null : (0, react_1.createElement)('dl', {
                  style: { margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 14px' },
              }, ...glossary.flatMap((entry, index) => [
                  (0, react_1.createElement)('dt', { key: `t${index}`, style: { fontWeight: 600 } }, describe(field(entry, 'term'))),
                  (0, react_1.createElement)('dd', { key: `d${index}`, style: { margin: 0 } }, describe(field(entry, 'definition'))),
              ])),
              section('笔记'),
              (0, react_1.createElement)('p', { style: { margin: 0, whiteSpace: 'pre-wrap', color: PALETTE.muted } }, describe(field(world, 'notes'))),
          ].filter((item) => item !== null);
      }
      function charactersDetail(snapshot) {
          const items = (0, serial_files_ts_1.jsonField)(snapshot.characters.text, 'items');
          const cast = Array.isArray(items) ? items : [];
          if (snapshot.characters.revision === 'absent') {
              return [(0, react_1.createElement)('h2', { style: { margin: 0, fontSize: '15px', fontWeight: 600 } }, '人物档案'),
                  (0, react_1.createElement)('p', { style: { color: PALETTE.muted } }, 'characters.json 还不存在。')];
          }
          return [
              (0, react_1.createElement)('h2', { style: { margin: 0, fontSize: '15px', fontWeight: 600 } }, `人物档案(${cast.length})`),
              assetLine('修订号', snapshot.characters),
              // 出场事实只来自蓝图(§6.8):"整集"来自短篇集蓝图,"章级"来自章节蓝图。
              // 因此"有正文没蓝图"的集在章级一栏会是空的 —— 这是事实,不是面板的缺陷。
              ...cast.flatMap((character, index) => {
                  const id = describe((0, serial_files_ts_1.jsonField)(JSON.stringify(character), 'id'));
                  const name = describe((0, serial_files_ts_1.jsonField)(JSON.stringify(character), 'name'));
                  const role = describe((0, serial_files_ts_1.jsonField)(JSON.stringify(character), 'role'));
                  const appearances = (0, serial_files_ts_1.collectCharacterAppearances)(snapshot.collections, id);
                  const chapters = appearances.flatMap(item => item.chapters.map(chapter => `${item.slug}#${chapter}`));
                  return [
                      (0, react_1.createElement)('div', {
                          key: `c${index}`,
                          style: { marginTop: '12px', paddingTop: '10px', borderTop: PALETTE.line },
                      }, fact('人物', `${name} · ${role}`), fact('id', id), fact('目标', describe((0, serial_files_ts_1.jsonField)(JSON.stringify(character), 'goal'))), fact('整集出场', appearances.filter(item => item.wholeCollection).map(item => item.slug).join('、') || '—'), fact('章级出场', chapters.length === 0 ? '—(需章节蓝图)' : chapters.join('、'))),
                  ];
              }),
          ];
      }
      function collectionDetail(snapshot, slug) {
          const collection = snapshot.collections.find(item => item.slug === slug);
          if (collection === undefined)
              return [noticeLike('这一集不见了。')];
          const text = collection.blueprint.text;
          const castIds = (0, serial_files_ts_1.stringArrayField)(text, 'characterIds');
          const threads = (0, serial_files_ts_1.collectThreadAdvances)(collection);
          const chaptersWithoutBlueprint = collection.chapters.filter(chapter => chapter.blueprint.revision === 'absent').length;
          return [
              (0, react_1.createElement)('h2', { style: { margin: 0, fontSize: '15px', fontWeight: 600 } }, describe((0, serial_files_ts_1.jsonField)(text, 'title'))),
              fact('slug', slug),
              fact('状态', describe((0, serial_files_ts_1.jsonField)(text, 'status'))),
              fact('目标字数', describe((0, serial_files_ts_1.jsonField)(text, 'targetWords'))),
              assetLine('蓝图修订号', collection.blueprint),
              fact('时间线', collection.timeline.revision === 'absent' ? 'absent' : shortRevision(collection.timeline.revision)),
              section('主题'),
              (0, react_1.createElement)('p', { style: { margin: 0, whiteSpace: 'pre-wrap' } }, describe((0, serial_files_ts_1.jsonField)(text, 'theme'))),
              section('梗概'),
              (0, react_1.createElement)('p', { style: { margin: 0, whiteSpace: 'pre-wrap' } }, describe((0, serial_files_ts_1.jsonField)(text, 'summary'))),
              section(`出场人物(${castIds.length})`),
              castIds.length === 0 ? (0, react_1.createElement)('p', { style: { margin: 0, color: PALETTE.muted } }, '—') : stringList(castIds),
              section(`故事线(${threads.length})`),
              threads.length === 0
                  ? (0, react_1.createElement)('p', { style: { margin: 0, color: PALETTE.muted } }, '这一集还没有声明故事线(blueprint.threads)。加上 threads 后,章节蓝图用 threadIds 标记推进。')
                  : (0, react_1.createElement)('div', {}, ...threads.map(thread => (0, react_1.createElement)('div', {
                      key: thread.id,
                      style: { marginBottom: '8px' },
                  }, fact('线', `${thread.title}(${thread.id})`), fact('推进', thread.advances.length === 0 ? '尚未推进' : thread.advances.map(n => `第 ${n} 章`).join('、')), (0, react_1.createElement)('p', { style: { margin: '2px 0 0', color: PALETTE.muted } }, thread.summary)))),
              section(`章节(${collection.chapters.length})`),
              chaptersWithoutBlueprint === 0
                  ? null
                  : (0, react_1.createElement)('p', { style: { margin: '0 0 8px', color: PALETTE.muted } }, `有 ${chaptersWithoutBlueprint} 章缺章节蓝图 —— 这些章不会出现在出场或故事线推进里。`),
              chapterTable(collection.chapters),
          ].filter((item) => item !== null);
      }
      /** 章节清单:蓝图/正文的存在性一目了然。 */
      function chapterTable(chapters) {
          if (chapters.length === 0) {
              return (0, react_1.createElement)('p', { style: { margin: 0, color: PALETTE.muted } }, '还没有章节。');
          }
          return (0, react_1.createElement)('div', { style: { display: 'grid', gridTemplateColumns: 'auto auto auto 1fr', gap: '4px 16px' } }, ...chapters.flatMap(chapter => {
              const hasBlueprint = chapter.blueprint.revision !== 'absent';
              return [
                  (0, react_1.createElement)('span', { key: `n${chapter.chapter}`, style: { fontWeight: 600 } }, `第 ${chapter.chapter} 章`),
                  (0, react_1.createElement)('span', { key: `b${chapter.chapter}`, style: { color: hasBlueprint ? PALETTE.muted : 'inherit' } }, hasBlueprint ? '蓝图 ✓' : '蓝图 ✗'),
                  (0, react_1.createElement)('span', { key: `d${chapter.chapter}`, style: { color: chapter.hasDraft ? PALETTE.muted : 'inherit' } }, chapter.hasDraft ? '正文 ✓' : '正文 ✗'),
                  (0, react_1.createElement)('span', { key: `s${chapter.chapter}`, style: { color: PALETTE.faint } }, hasBlueprint ? `${chapter.characterIds.length} 人 / ${chapter.threadIds.length} 线` : ''),
              ];
          }));
      }
      function chapterDetail(snapshot, selection, detail) {
          const collection = snapshot.collections.find(item => item.slug === selection.slug);
          const chapter = collection?.chapters.find(item => item.chapter === selection.chapter);
          const hasBlueprint = chapter !== undefined && chapter.blueprint.revision !== 'absent';
          const rows = [
              (0, react_1.createElement)('h2', { style: { margin: 0, fontSize: '15px', fontWeight: 600 } }, `${selection.slug} · 第 ${selection.chapter} 章`),
              fact('章节蓝图', hasBlueprint
                  ? `存在 · ${shortRevision(chapter.blueprint.revision)}(出场 ${chapter.characterIds.length} 人 / 推进 ${chapter.threadIds.length} 线)`
                  : '缺失'),
          ];
          if (!hasBlueprint) {
              rows.push((0, react_1.createElement)('p', { style: { margin: '8px 0 0', color: PALETTE.muted } }, '没有章节蓝图,这一章不会出现在 appearances 或故事线推进里 —— 正文写了也不算。'));
          }
          if (detail === undefined) {
              rows.push((0, react_1.createElement)('p', { style: { margin: '8px 0 0', color: PALETTE.muted } }, '正在读取正文…'));
              return rows;
          }
          rows.push(assetLine('正文修订号', detail));
          rows.push(section('正文预览'));
          rows.push((0, react_1.createElement)('div', {
              style: {
                  margin: 0,
                  color: 'inherit',
                  background: 'color-mix(in srgb, currentColor 5%, transparent)',
                  borderRadius: '6px',
                  padding: '12px 14px',
                  maxHeight: '52vh',
                  overflow: 'auto',
              },
          }, ...(detail.revision === 'absent'
              ? [noticeLike('(还没有正文)')]
              : markdownBlocks(detail.text))));
          return rows;
      }
      /**
       * 把正文渲染成块级元素。
       *
       * 解析在 `./markdown.ts` 里,是纯函数因而可测;这里只负责把块与行内片段映射成 React
       * 元素。**不注入原始 HTML** —— 正文是模型写的,`<script>` 一类必须当文字显示。
       *
       * @param text 正文文本。
       * @returns 元素序列。
       */
      function markdownBlocks(text) {
          return (0, markdown_ts_1.parseMarkdown)(text).map((block, index) => {
              switch (block.kind) {
                  case 'heading':
                      return (0, react_1.createElement)(`h${Math.min(block.level + 2, 6)}`, {
                          key: index,
                          style: {
                              margin: index === 0 ? '0 0 6px' : '16px 0 6px',
                              fontSize: `${Math.max(1.35 - block.level * 0.08, 1)}em`,
                              fontWeight: 600,
                          },
                      }, ...markdownSpans(block.text));
                  case 'paragraph':
                      // 段内换行原样保留:中文正文折行不该多出空格。
                      return (0, react_1.createElement)('p', {
                          key: index,
                          style: { margin: '0 0 10px', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' },
                      }, ...markdownSpans(block.text));
                  case 'list':
                      return (0, react_1.createElement)(block.ordered ? 'ol' : 'ul', {
                          key: index,
                          style: { margin: '0 0 10px', paddingLeft: '22px' },
                      }, ...block.items.map((item, itemIndex) => (0, react_1.createElement)('li', { key: itemIndex }, ...markdownSpans(item))));
                  case 'quote':
                      return (0, react_1.createElement)('blockquote', {
                          key: index,
                          style: {
                              margin: '0 0 10px',
                              paddingLeft: '12px',
                              borderLeft: `3px solid color-mix(in srgb, currentColor 25%, transparent)`,
                              color: PALETTE.muted,
                              whiteSpace: 'pre-wrap',
                          },
                      }, ...markdownSpans(block.text));
                  case 'code':
                      return (0, react_1.createElement)('pre', {
                          key: index,
                          style: {
                              margin: '0 0 10px',
                              font: 'inherit',
                              fontSize: '12px',
                              whiteSpace: 'pre-wrap',
                              overflowWrap: 'anywhere',
                              background: 'color-mix(in srgb, currentColor 8%, transparent)',
                              borderRadius: '6px',
                              padding: '8px 10px',
                          },
                      }, block.text);
                  case 'rule':
                      return (0, react_1.createElement)('hr', {
                          key: index,
                          style: { border: 0, borderTop: PALETTE.line, margin: '14px 0' },
                      });
              }
          });
      }
      /**
       * 把一个块里的行内片段映射成元素。
       *
       * @param text 一段行内文字。
       * @returns 元素序列。
       */
      function markdownSpans(text) {
          return (0, markdown_ts_1.parseInline)(text).map((span, index) => {
              switch (span.kind) {
                  case 'text': return span.text;
                  case 'strong': return (0, react_1.createElement)('strong', { key: index }, span.text);
                  case 'em': return (0, react_1.createElement)('em', { key: index }, span.text);
                  case 'code':
                      return (0, react_1.createElement)('code', {
                          key: index,
                          style: { background: 'color-mix(in srgb, currentColor 10%, transparent)', borderRadius: '3px', padding: '0 3px' },
                      }, span.text);
                  case 'link':
                      return (0, react_1.createElement)('a', {
                          key: index,
                          href: span.href,
                          target: '_blank',
                          rel: 'noreferrer noopener',
                          style: { color: 'inherit', textDecoration: 'underline' },
                      }, span.text);
              }
          });
      }
      /** 详情区里的一条提示。 */
      function noticeLike(text) {
          return (0, react_1.createElement)('p', { style: { margin: 0, color: PALETTE.muted } }, text);
      }

  },
  // 3: src/client/serial-files.ts
  3: function (module, exports, require) {
      "use strict";
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
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.serialAssetPath = exports.inboxDir = exports.chaptersDir = exports.chapterNumberOf = exports.collectionTimelinePath = exports.collectionBlueprintPath = exports.chapterDraftPath = exports.chapterBlueprintPath = exports.SERIAL_DIR = void 0;
      exports.serialRevision = serialRevision;
      exports.readAsset = readAsset;
      exports.listEntries = listEntries;
      exports.stringArrayField = stringArrayField;
      exports.stringField = stringField;
      exports.jsonField = jsonField;
      exports.collectThreadAdvances = collectThreadAdvances;
      exports.collectCharacterAppearances = collectCharacterAppearances;
      exports.loadProposals = loadProposals;
      exports.loadProject = loadProject;
      const serial_audit_js_1 = require("../serial-audit.js");
      /**
       * 项目内的路径与文件名**不在这里定义** —— 它们来自 `src/serial-layout.ts`,与 Host
       * 侧读写的同一份定义。两边各拼一遍字符串就等于把"`chapters/0007-blueprint.json`
       * 长什么样"存了两份,任何一次改名都会让面板静默读不到文件。
       */
      const serial_layout_js_1 = require("../serial-layout.js");
      var serial_layout_js_2 = require("../serial-layout.js");
      Object.defineProperty(exports, "SERIAL_DIR", { enumerable: true, get: function () { return serial_layout_js_2.SERIAL_DIR; } });
      Object.defineProperty(exports, "chapterBlueprintPath", { enumerable: true, get: function () { return serial_layout_js_2.chapterBlueprintPath; } });
      Object.defineProperty(exports, "chapterDraftPath", { enumerable: true, get: function () { return serial_layout_js_2.chapterDraftPath; } });
      Object.defineProperty(exports, "collectionBlueprintPath", { enumerable: true, get: function () { return serial_layout_js_2.collectionBlueprintPath; } });
      Object.defineProperty(exports, "collectionTimelinePath", { enumerable: true, get: function () { return serial_layout_js_2.collectionTimelinePath; } });
      Object.defineProperty(exports, "chapterNumberOf", { enumerable: true, get: function () { return serial_layout_js_2.chapterNumberOf; } });
      Object.defineProperty(exports, "chaptersDir", { enumerable: true, get: function () { return serial_layout_js_2.chaptersDir; } });
      Object.defineProperty(exports, "inboxDir", { enumerable: true, get: function () { return serial_layout_js_2.inboxDir; } });
      Object.defineProperty(exports, "serialAssetPath", { enumerable: true, get: function () { return serial_layout_js_2.serialAssetPath; } });
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
      async function serialRevision(bytes) {
          const text = new TextDecoder('utf-8').decode(bytes).replace(/\r\n?/g, '\n');
          const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
          return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
      }
      /** 不存在的资产视图。 */
      function absent(path) {
          return { path, revision: 'absent', bytes: 0, text: '' };
      }
      /** 读取失败时给用户看的一句话。 */
      function failureMessage(error) {
          if (typeof error === 'string')
              return error;
          if (typeof error === 'object' && error !== null && 'message' in error) {
              const message = error.message;
              if (typeof message === 'string')
                  return message;
          }
          return '未知错误';
      }
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
      async function readAsset(files, sessionId, relative, signal) {
          const result = await files.readBytes(sessionId, relative, {}, signal);
          if (!result.ok)
              return absent(relative);
          const { data, bytes } = result.value;
          return {
              path: relative,
              revision: await serialRevision(data),
              bytes: bytes ?? data.byteLength,
              text: new TextDecoder('utf-8').decode(data),
          };
      }
      /**
       * 列出目录条目。
       *
       * @param files Remote 切片。
       * @param sessionId 会话身份。
       * @param relative 项目内相对路径。
       * @param signal 取消信号。
       * @returns 条目数组;目录不存在或读取失败时为空数组。
       */
      async function listEntries(files, sessionId, relative, signal) {
          const result = await files.list(sessionId, relative, signal);
          return result.ok ? result.value.entries : [];
      }
      /** 章节正文的文件名/蓝图的文件名:由共享布局模块提供,见文件头的 re-export。 */
      /** 从 JSON 资产文本里取字符串数组字段;缺失或形态不对时为空数组。 */
      function stringArrayField(text, key) {
          let parsed;
          try {
              parsed = JSON.parse(text);
          }
          catch {
              return [];
          }
          if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
              return [];
          const value = parsed[key];
          return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
      }
      /** 取 JSON 资产文本里的字符串字段;缺失或形态不对时为空串。 */
      function stringField(text, key) {
          const value = jsonField(text, key);
          return typeof value === 'string' ? value : '';
      }
      /** 取 JSON 资产文本里的字段。 */
      function jsonField(text, key) {
          try {
              const parsed = JSON.parse(text);
              return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
                  ? parsed[key]
                  : undefined;
          }
          catch {
              return undefined;
          }
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
      function collectThreadAdvances(collection) {
          const declared = jsonField(collection.blueprint.text, 'threads');
          if (!Array.isArray(declared))
              return [];
          return declared.map((entry) => {
              const id = typeof entry?.id === 'string' ? entry.id : '';
              const advances = collection.chapters
                  .filter(chapter => chapter.threadIds.includes(id))
                  .map(chapter => chapter.chapter);
              return {
                  id,
                  title: typeof entry?.title === 'string' ? entry.title : id,
                  summary: typeof entry?.summary === 'string' ? entry.summary : '',
                  advances: [...new Set(advances)].sort((a, b) => a - b),
              };
          });
      }
      /**
       * 汇总一个人物在全部已加载短篇集里的出场。
       *
       * @param collections 已加载的短篇集。
       * @param characterId 人物稳定 id。
       * @returns 每一集一条记录。
       */
      function collectCharacterAppearances(collections, characterId) {
          const result = [];
          for (const collection of collections) {
              const wholeCollection = stringArrayField(collection.blueprint.text, 'characterIds').includes(characterId);
              const chapters = collection.chapters
                  .filter(chapter => chapter.characterIds.includes(characterId))
                  .map(chapter => chapter.chapter);
              if (wholeCollection || chapters.length > 0) {
                  result.push({ slug: collection.slug, wholeCollection, chapters: [...new Set(chapters)].sort((a, b) => a - b) });
              }
          }
          return result;
      }
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
      async function loadProposals(files, sessionId, signal) {
          const entries = await listEntries(files, sessionId, (0, serial_layout_js_1.inboxDir)(), signal);
          const proposals = [];
          for (const entry of entries) {
              if (entry.type !== 'file' || !entry.name.endsWith('.json'))
                  continue;
              const asset = await readAsset(files, sessionId, `${(0, serial_layout_js_1.inboxDir)()}/${entry.name}`, signal);
              if (asset.revision === 'absent')
                  continue;
              let parsed;
              try {
                  parsed = JSON.parse(asset.text);
              }
              catch {
                  // 坏掉的提案文件不该让整个面板垮掉:如实标出来。
                  proposals.push({
                      proposalId: entry.name.slice(0, -'.json'.length),
                      createdAt: '',
                      summary: '(这个提案文件不是合法 JSON)',
                      status: 'invalid',
                      commandKind: '—',
                      commandText: asset.text,
                  });
                  continue;
              }
              const record = typeof parsed === 'object' && parsed !== null ? parsed : {};
              const command = record.command;
              proposals.push({
                  proposalId: entry.name.slice(0, -'.json'.length),
                  createdAt: typeof record.createdAt === 'string' ? record.createdAt : '',
                  summary: typeof record.summary === 'string' ? record.summary : '(无摘要)',
                  status: typeof record.status === 'string' ? record.status : 'unknown',
                  commandKind: typeof command?.kind === 'string'
                      ? String(command.kind)
                      : '—',
                  commandText: JSON.stringify(command, null, 2) ?? '',
              });
          }
          return proposals;
      }
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
      async function loadProject(files, sessionId, signal) {
          let project;
          let world;
          let characters;
          let proposals;
          try {
              project = await readAsset(files, sessionId, (0, serial_layout_js_1.projectPath)(), signal);
              // 提案先读:未初始化的项目也可能有 initialize 建议等着审阅。
              proposals = await loadProposals(files, sessionId, signal);
              if (project.revision === 'absent')
                  return { kind: 'absent', proposals };
              world = await readAsset(files, sessionId, (0, serial_layout_js_1.worldPath)(), signal);
              characters = await readAsset(files, sessionId, (0, serial_layout_js_1.charactersPath)(), signal);
          }
          catch (error) {
              // 真正的失败(权限、工作区不可解析)才报错;缺文件在上面已经归成 absent。
              return { kind: 'unreadable', message: failureMessage(error) };
          }
          const collections = [];
          const collectionDirs = await listEntries(files, sessionId, (0, serial_layout_js_1.collectionsDir)(), signal);
          for (const entry of collectionDirs) {
              if (entry.type !== 'directory')
                  continue;
              const slug = entry.name;
              const blueprint = await readAsset(files, sessionId, (0, serial_layout_js_1.collectionBlueprintPath)(slug), signal);
              const timeline = await readAsset(files, sessionId, (0, serial_layout_js_1.collectionTimelinePath)(slug), signal);
              const chapterDir = await listEntries(files, sessionId, (0, serial_layout_js_1.chaptersDir)(slug), signal);
              // 章节与蓝图的存在性从**目录清单**判断,内容只对蓝图读 —— 正文按需另读,
              // 否则几十章的项目一打开就把全部正文拉进浏览器。
              const numbers = new Set();
              const draftSizes = new Map();
              for (const file of chapterDir) {
                  if (file.type !== 'file')
                      continue;
                  const chapter = (0, serial_layout_js_1.chapterNumberOf)(file.name);
                  if (chapter === undefined)
                      continue;
                  numbers.add(chapter);
                  if (file.name.endsWith('.md'))
                      draftSizes.set(chapter, file.size ?? 0);
              }
              const chapters = [];
              for (const chapter of [...numbers].sort((a, b) => a - b)) {
                  const blueprint = await readAsset(files, sessionId, (0, serial_layout_js_1.chapterBlueprintPath)(slug, chapter), signal);
                  chapters.push({
                      chapter,
                      blueprint,
                      characterIds: stringArrayField(blueprint.text, 'characterIds'),
                      threadIds: stringArrayField(blueprint.text, 'threadIds'),
                      povCharacterId: stringField(blueprint.text, 'povCharacterId'),
                      hasDraft: draftSizes.has(chapter),
                      draftBytes: draftSizes.get(chapter) ?? 0,
                  });
              }
              collections.push({
                  slug,
                  blueprint,
                  timeline,
                  characterIds: stringArrayField(blueprint.text, 'characterIds'),
                  characterList: [],
                  threadList: storyThreadsIn(blueprint.text),
                  chapters,
              });
          }
          const characterList = characterListIn(characters.text);
          // 巡检判定与 Host 侧共用同一个纯函数;这里只负责把 Remote 读到的内容凑成它的输入。
          const audit = (0, serial_audit_js_1.auditWorld)({
              worldPresent: world.revision !== 'absent',
              charactersPresent: characters.revision !== 'absent',
              characters: characterList.map(character => ({ id: character.id, name: character.name })),
              collections: collections.map(collection => ({
                  slug: collection.slug,
                  blueprint: collection.blueprint.revision === 'absent'
                      ? undefined
                      : { characterIds: collection.characterIds, threads: collection.threadList },
                  hasTimeline: collection.timeline.revision !== 'absent',
                  chapters: collection.chapters.map(chapter => ({
                      chapter: chapter.chapter,
                      hasBlueprint: chapter.blueprint.revision !== 'absent',
                      hasDraft: chapter.hasDraft,
                      characterIds: chapter.characterIds,
                      threadIds: chapter.threadIds,
                      povCharacterId: chapter.povCharacterId,
                  })),
              })),
          }, AUDIT_LIMIT);
          return { kind: 'ready', project, world, characters, characterList, collections, proposals, audit };
      }
      /** 浏览器侧巡检的发现数上限。 */
      const AUDIT_LIMIT = 200;
      /** 从人物档案文本里取 id/name/role。 */
      function characterListIn(text) {
          const items = jsonField(text, 'items');
          if (!Array.isArray(items))
              return [];
          return items.flatMap(item => {
              if (typeof item !== 'object' || item === null)
                  return [];
              const record = item;
              return typeof record.id === 'string'
                  ? [{ id: record.id, name: typeof record.name === 'string' ? record.name : record.id, role: typeof record.role === 'string' ? record.role : '' }]
                  : [];
          });
      }
      /** 从短篇集蓝图文本里取故事线声明(只取 id 与 title)。 */
      function storyThreadsIn(text) {
          const threads = jsonField(text, 'threads');
          if (!Array.isArray(threads))
              return [];
          return threads.flatMap(thread => {
              if (typeof thread !== 'object' || thread === null)
                  return [];
              const record = thread;
              return typeof record.id === 'string'
                  ? [{ id: record.id, title: typeof record.title === 'string' ? record.title : record.id }]
                  : [];
          });
      }

  },
  // 4: src/client/change-watch.ts
  4: function (module, exports, require) {
      "use strict";
      /**
       * 订阅会话工作区里的文件变更。
       *
       * ## 为什么需要它
       *
       * 面板读的是盘上的 `.serial/`,而写盘的是**会话里的模型**(经原生审批)。两者是两个
       * 进程两侧的同一个目录:模型刚写完,面板上还是旧内容,除非用户自己去刷新。变更订阅
       * 就是把这件"该刷新了"告诉面板。
       *
       * ## 实现照抄 dsh 自己的一方面板
       *
       * 这条通道不是直接可用的:`workspaceFiles.changes` 只是**一代物理流**,必须交给
       * `remote.$stream` 的重连监督器包裹 —— 否则断线后不会重开。dsh 自己的侧栏文件树
       * 有一份 `createWatch`,本模块是它的忠实移植(结构逐条对应),而不是我另发明的协议。
       *
       * 协议要点:
       * - `open(lifetime)` 里调 `changes(sessionId, path, lifetime)`,拿一代流;
       * - 收到 `kind === 'ready'` 表示宿主侧的订阅已经生效 —— 调 `accept()` 告诉监督器
       *   "这一代健康",从而重置重连退避;
       * - 其余 kind 一律只需知道"**有变化**"就够了:面板不关心具体变了什么,重新读一遍
       *   整个项目快照最简单也最不容易错;
       * - 中止时必须 `dispose()`,否则会留下宿主侧的流。
       *
       * 这里的类型全是**结构**的:不 import 任何 Harness Client 包,因此不会给客户端打包
       * 引入新的外部依赖(见 `verify-built` 的外部依赖断言)。
       */
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.watchWorkspacePath = watchWorkspacePath;
      /**
       * 跟随一个路径的变更。
       *
       * 产出每一帧的 `kind`;`ready` 帧会先 `accept()` 再产出。中止时结束迭代并释放流。
       * 迭代提前结束(`break` / `return`)同样会释放 —— 与 dsh 的实现一致。
       *
       * @param remote 带 `$stream` 与 `workspaceFiles` 的 Remote 面。
       * @param sessionId 提供读取权限的会话。
       * @param path 工作区内的相对路径。
       * @param signal 结束跟随。
       * @returns 帧 kind 的异步生成器。
       */
      async function* watchWorkspacePath(remote, sessionId, path, signal) {
          if (signal.aborted)
              return;
          const stream = remote.$stream({
              name: `serial project ${path}`,
              open: lifetime => remote.workspaceFiles.changes(sessionId, path, lifetime),
              ended: () => new Error(`Serial project watch ended: ${path}`),
          });
          const abort = () => { void stream.dispose(); };
          signal.addEventListener('abort', abort, { once: true });
          try {
              for await (const item of stream) {
                  if (signal.aborted)
                      return;
                  // 只有 ready 需要应答;应答之后才算这一代健康。
                  if (item.value.kind === 'ready')
                      item.accept();
                  yield item.value.kind;
              }
          }
          finally {
              signal.removeEventListener('abort', abort);
              await stream.dispose();
          }
      }

  },
  // 5: src/serial-layout.ts
  5: function (module, exports, require) {
      "use strict";
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
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.CHAPTER_DIGITS = exports.CHAPTER_DRAFT_SUFFIX = exports.CHAPTER_BLUEPRINT_SUFFIX = exports.COLLECTION_TIMELINE_FILE = exports.COLLECTION_BLUEPRINT_FILE = exports.WORLD_FILE = exports.CHARACTERS_FILE = exports.PROJECT_FILE = exports.INBOX_DIR = exports.CHAPTERS_DIR = exports.COLLECTIONS_DIR = exports.SERIAL_DIR = void 0;
      exports.chapterSegment = chapterSegment;
      exports.chapterNumberOf = chapterNumberOf;
      exports.projectPath = projectPath;
      exports.charactersPath = charactersPath;
      exports.worldPath = worldPath;
      exports.collectionsDir = collectionsDir;
      exports.collectionDir = collectionDir;
      exports.chaptersDir = chaptersDir;
      exports.collectionBlueprintPath = collectionBlueprintPath;
      exports.collectionTimelinePath = collectionTimelinePath;
      exports.chapterDraftPath = chapterDraftPath;
      exports.chapterBlueprintPath = chapterBlueprintPath;
      exports.inboxDir = inboxDir;
      exports.serialAssetPath = serialAssetPath;
      /** 项目目录名。 */
      exports.SERIAL_DIR = '.serial';
      /** 短篇集目录。 */
      exports.COLLECTIONS_DIR = 'collections';
      /** 章节目录。 */
      exports.CHAPTERS_DIR = 'chapters';
      /** 提案收件箱目录(位于项目命名空间之下)。 */
      exports.INBOX_DIR = 'inbox';
      /** 项目清单文件名。 */
      exports.PROJECT_FILE = 'project.json';
      /** 共享人物档案文件名。 */
      exports.CHARACTERS_FILE = 'characters.json';
      /** 共享设定文件名。 */
      exports.WORLD_FILE = 'world.json';
      /** 短篇集蓝图文件名。 */
      exports.COLLECTION_BLUEPRINT_FILE = 'blueprint.json';
      /** 短篇集时间线文件名。 */
      exports.COLLECTION_TIMELINE_FILE = 'timeline.json';
      /** 章节蓝图文件后缀。 */
      exports.CHAPTER_BLUEPRINT_SUFFIX = '-blueprint.json';
      /** 章节正文文件后缀。 */
      exports.CHAPTER_DRAFT_SUFFIX = '.md';
      /** 章节号在文件名里占的位数。 */
      exports.CHAPTER_DIGITS = 4;
      /**
       * 章节号转文件名片段。
       *
       * @param chapter 章节号,必须是正整数。
       * @returns 补零到 {@link CHAPTER_DIGITS} 位的片段。
       * @throws RangeError 当章节号不是正整数。Host 侧的调用点会把它翻成 `INVALID_CONTENT`。
       */
      function chapterSegment(chapter) {
          if (!Number.isSafeInteger(chapter) || chapter <= 0) {
              throw new RangeError(`章节号必须是正整数:收到 ${JSON.stringify(chapter)}`);
          }
          return String(chapter).padStart(exports.CHAPTER_DIGITS, '0');
      }
      /**
       * 从章节文件名里取章节号。
       *
       * 与 {@link chapterSegment} 是一对:能被前者生成的名字,都能被这里解析回来。
       *
       * @param fileName 章节目录下的一个文件名。
       * @returns 章节号;不是章节文件时为 undefined。
       */
      function chapterNumberOf(fileName) {
          const pattern = new RegExp(`^(\\d{${exports.CHAPTER_DIGITS}})(?:${exports.CHAPTER_BLUEPRINT_SUFFIX.replace('.', '\\.')}|${exports.CHAPTER_DRAFT_SUFFIX.replace('.', '\\.')})$`);
          const match = pattern.exec(fileName);
          return match === null ? undefined : Number.parseInt(match[1], 10);
      }
      /** 项目清单的路径。 */
      function projectPath() {
          return `${exports.SERIAL_DIR}/${exports.PROJECT_FILE}`;
      }
      /** 共享人物档案的路径。 */
      function charactersPath() {
          return `${exports.SERIAL_DIR}/${exports.CHARACTERS_FILE}`;
      }
      /** 共享设定的路径。 */
      function worldPath() {
          return `${exports.SERIAL_DIR}/${exports.WORLD_FILE}`;
      }
      /** 全部短篇集所在目录。 */
      function collectionsDir() {
          return `${exports.SERIAL_DIR}/${exports.COLLECTIONS_DIR}`;
      }
      /** 某短篇集的目录。 */
      function collectionDir(slug) {
          return `${collectionsDir()}/${slug}`;
      }
      /** 某短篇集的章节目录。 */
      function chaptersDir(slug) {
          return `${collectionDir(slug)}/${exports.CHAPTERS_DIR}`;
      }
      /** 某短篇集的蓝图路径。 */
      function collectionBlueprintPath(slug) {
          return `${collectionDir(slug)}/${exports.COLLECTION_BLUEPRINT_FILE}`;
      }
      /** 某短篇集的时间线路径。 */
      function collectionTimelinePath(slug) {
          return `${collectionDir(slug)}/${exports.COLLECTION_TIMELINE_FILE}`;
      }
      /** 某一章正文的路径。 */
      function chapterDraftPath(slug, chapter) {
          return `${chaptersDir(slug)}/${chapterSegment(chapter)}${exports.CHAPTER_DRAFT_SUFFIX}`;
      }
      /** 某一章蓝图的路径。 */
      function chapterBlueprintPath(slug, chapter) {
          return `${chaptersDir(slug)}/${chapterSegment(chapter)}${exports.CHAPTER_BLUEPRINT_SUFFIX}`;
      }
      /** 提案收件箱的目录。 */
      function inboxDir() {
          return `${exports.SERIAL_DIR}/${exports.INBOX_DIR}`;
      }
      /**
       * 把一个资产引用映射为项目内的相对路径(POSIX 分隔符)。
       *
       * @param target 资产引用;调用方负责 slug/chapter 已通过形态校验。
       * @returns 相对路径。
       */
      function serialAssetPath(target) {
          switch (target.kind) {
              case 'project': return `${exports.SERIAL_DIR}/${exports.PROJECT_FILE}`;
              case 'characters': return `${exports.SERIAL_DIR}/${exports.CHARACTERS_FILE}`;
              case 'world': return `${exports.SERIAL_DIR}/${exports.WORLD_FILE}`;
              case 'collection-blueprint': return collectionBlueprintPath(target.slug);
              case 'collection-timeline': return collectionTimelinePath(target.slug);
              case 'chapter-blueprint': return chapterBlueprintPath(target.slug, target.chapter);
              case 'chapter-draft': return chapterDraftPath(target.slug, target.chapter);
          }
      }

  },
  // 6: src/client/markdown.ts
  6: function (module, exports, require) {
      "use strict";
      /**
       * 一个**很小**的 Markdown 解析器:只覆盖这一领域真正会写的东西。
       *
       * ## 为什么不引第三方
       *
       * 面板是只读渲染一部长篇手稿,不是通用 Markdown 阅读器。自写一个受控子集有三个好处:
       * 解析是**纯函数**(因此可以在没有浏览器的环境里被完整测住)、不会引入新的打包依赖、
       * 也**不会把 HTML 直接透传**(正文里出现 `<script>` 只会原样显示成文字)。
       *
       * ## 支持的子集
       *
       * 块级:标题(`#`~`######`)、段落、无序/有序列表、引用、围栏代码块、分隔线。
       * 行内:`**粗**`、`*斜*`/`_斜_`、`` `代码` ``、`[文字](链接)`。
       *
       * **刻意不支持**:原始 HTML、表格、脚注、嵌套列表。这些要么不安全,要么在中文小说
       * 正文里几乎不会出现;不实现比实现一半更诚实。
       */
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.parseMarkdown = parseMarkdown;
      exports.parseInline = parseInline;
      const HEADING = /^(#{1,6})\s+(.*)$/;
      const RULE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
      const UNORDERED = /^\s*[-*+]\s+(.*)$/;
      const ORDERED = /^\s*\d+[.)]\s+(.*)$/;
      const QUOTE = /^\s*>\s?(.*)$/;
      const FENCE = /^\s*```/;
      /**
       * 把正文拆成块级节点。
       *
       * @param text 正文文本。
       * @returns 块级节点序列。
       */
      function parseMarkdown(text) {
          const blocks = [];
          const lines = text.split('\n');
          /** 段落/列表/引用用同一个缓冲区累积,遇到空行或换类型时冲刷。 */
          let buffer = [];
          let mode = 'paragraph';
          let ordered = false;
          const flush = () => {
              if (buffer.length === 0)
                  return;
              if (mode === 'list') {
                  blocks.push({ kind: 'list', ordered, items: buffer });
              }
              else if (mode === 'quote') {
                  blocks.push({ kind: 'quote', text: buffer.join('\n') });
              }
              else {
                  // 段落内的换行**原样保留**:中文正文里把换行折成空格会凭空插入空格。
                  blocks.push({ kind: 'paragraph', text: buffer.join('\n') });
              }
              buffer = [];
              mode = 'paragraph';
          };
          for (let index = 0; index < lines.length; index += 1) {
              const line = lines[index];
              // 围栏代码块:整段原样收,不做行内解析。
              if (FENCE.test(line)) {
                  flush();
                  const body = [];
                  index += 1;
                  while (index < lines.length && !FENCE.test(lines[index])) {
                      body.push(lines[index]);
                      index += 1;
                  }
                  // 未闭合的围栏吃到文件末尾也可以 —— 写作中途的稿子很常见。
                  blocks.push({ kind: 'code', text: body.join('\n') });
                  continue;
              }
              if (line.trim() === '') {
                  flush();
                  continue;
              }
              if (RULE.test(line)) {
                  flush();
                  blocks.push({ kind: 'rule' });
                  continue;
              }
              const heading = HEADING.exec(line);
              if (heading !== null) {
                  flush();
                  blocks.push({ kind: 'heading', level: heading[1].length, text: heading[2].trim() });
                  continue;
              }
              const quote = QUOTE.exec(line);
              if (quote !== null) {
                  if (mode !== 'quote')
                      flush();
                  mode = 'quote';
                  buffer.push(quote[1]);
                  continue;
              }
              const unordered = UNORDERED.exec(line);
              const orderedMatch = ORDERED.exec(line);
              if (unordered !== null || orderedMatch !== null) {
                  const isOrdered = orderedMatch !== null;
                  // 有序与无序相邻时不合并成一个列表。
                  if (mode !== 'list' || ordered !== isOrdered)
                      flush();
                  mode = 'list';
                  ordered = isOrdered;
                  buffer.push((unordered ?? orderedMatch)?.[1] ?? '');
                  continue;
              }
              if (mode !== 'paragraph')
                  flush();
              mode = 'paragraph';
              buffer.push(line);
          }
          flush();
          return blocks;
      }
      /** 行内标记的匹配顺序即优先级:代码最先(它内部不做任何解析),链接其次。 */
      const INLINE = /(`[^`]+`)|(\[[^\]]*\]\([^)\s]*\))|(\*\*[^*]+\*\*)|(\*[^*\s][^*]*\*)|(_[^_\s][^_]*_)/g;
      /**
       * 把一段文字拆成行内片段。
       *
       * @param text 一段行内文字。
       * @returns 行内片段序列;没有标记时是单个 `text` 片段。
       */
      function parseInline(text) {
          const spans = [];
          let cursor = 0;
          for (const match of text.matchAll(INLINE)) {
              const at = match.index;
              if (at > cursor)
                  spans.push({ kind: 'text', text: text.slice(cursor, at) });
              const token = match[0];
              if (match[1] !== undefined) {
                  spans.push({ kind: 'code', text: token.slice(1, -1) });
              }
              else if (match[2] !== undefined) {
                  const split = token.indexOf('](');
                  spans.push({ kind: 'link', text: token.slice(1, split), href: token.slice(split + 2, -1) });
              }
              else if (match[3] !== undefined) {
                  spans.push({ kind: 'strong', text: token.slice(2, -2) });
              }
              else {
                  spans.push({ kind: 'em', text: token.slice(1, -1) });
              }
              cursor = at + token.length;
          }
          if (cursor < text.length)
              spans.push({ kind: 'text', text: text.slice(cursor) });
          return spans;
      }

  },
  // 7: src/serial-export.ts
  7: function (module, exports, require) {
      "use strict";
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
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.assembleCollectionMarkdown = assembleCollectionMarkdown;
      /** 没有正文的章在导出里留下的标记。 */
      const MISSING_DRAFT = '（本章还没有正文）';
      /** 章标题在导出文档里的层级。 */
      const CHAPTER_HEADING_LEVEL = 2;
      /** 一个 ATX 标题行。 */
      const ATX = /^(#{1,6})(\s+.*)$/;
      const FENCE = /^\s*```/;
      /**
       * 正文里最浅的标题层级。
       *
       * 扫描时跳过围栏代码块 —— 代码里的 `#` 是注释,不是标题。
       *
       * @param text 正文。
       * @returns 最浅层级(1~6);正文里没有标题时为 undefined。
       */
      function shallowestHeadingLevel(text) {
          let inFence = false;
          let shallowest;
          for (const line of text.split('\n')) {
              if (FENCE.test(line)) {
                  inFence = !inFence;
                  continue;
              }
              if (inFence)
                  continue;
              const match = ATX.exec(line);
              if (match === null)
                  continue;
              const level = match[1].length;
              if (shallowest === undefined || level < shallowest)
                  shallowest = level;
          }
          return shallowest;
      }
      /**
       * 把正文里的标题整体下沉,使最浅的那个落在 `level`。
       *
       * 这是**结构归一化**,不是改写内容:散文一个字节都不动,只有标题行的井号个数变化。
       * 不这么做的话,作者的 `# 暮山紫` 会出现在导出的 `## 第 1 章` **下面**,层级是倒的。
       *
       * @param text 正文。
       * @param level 目标层级。
       * @returns 归一化后的正文。
       */
      function shiftHeadings(text, level) {
          const shallowest = shallowestHeadingLevel(text);
          if (shallowest === undefined || shallowest >= level)
              return text;
          const delta = level - shallowest;
          let inFence = false;
          return text.split('\n').map(line => {
              if (FENCE.test(line)) {
                  inFence = !inFence;
                  return line;
              }
              if (inFence)
                  return line;
              const match = ATX.exec(line);
              if (match === null)
                  return line;
              const hashes = '#'.repeat(Math.min(match[1].length + delta, 6));
              return `${hashes}${match[2]}`;
          }).join('\n');
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
      function assembleCollectionMarkdown(input) {
          const lines = [`# ${input.title === '' ? input.slug : input.title}`, ''];
          const meta = [];
          if (input.theme !== '')
              meta.push(`主题:${input.theme}`);
          if (input.status !== '')
              meta.push(`状态:${input.status}`);
          const period = [input.season, input.startDate, input.endDate].filter(part => part !== '');
          if (period.length > 0)
              meta.push(`时间:${period.join(' · ')}`);
          if (input.summary !== '')
              meta.push(input.summary);
          if (meta.length > 0) {
              lines.push(...meta.map(line => `> ${line}`), '');
          }
          const ordered = [...input.chapters].sort((a, b) => a.chapter - b.chapter);
          for (const chapter of ordered) {
              const body = chapter.text.replace(/\r\n?/g, '\n').replace(/\n+$/, '');
              lines.push('---', '');
              if (body.trim() === '') {
                  lines.push(renderLocator(chapter), '', MISSING_DRAFT, '');
                  continue;
              }
              if (shallowestHeadingLevel(body) === undefined) {
                  lines.push(renderLocator(chapter), '');
              }
              lines.push(shiftHeadings(body, CHAPTER_HEADING_LEVEL), '');
          }
          return `${lines.join('\n').replace(/\n+$/, '')}\n`;
      }
      /**
       * 注入的章定位标题。
       *
       * @param chapter 一章。
       * @returns 标题行。
       */
      function renderLocator(chapter) {
          return `${'#'.repeat(CHAPTER_HEADING_LEVEL)} 第 ${chapter.chapter} 章${chapter.title === '' ? '' : ` ${chapter.title}`}`;
      }

  },
  // 8: src/serial-audit.ts
  8: function (module, exports, require) {
      "use strict";
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
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.auditWorld = auditWorld;
      /**
       * 巡检一个世界,返回有界报告。
       *
       * 它**只报告**。发现的问题不会抛异常、也不让读取失败 —— 一份有缺口的手稿仍然应该能读。
       *
       * @param input 世界索引的判定视图。
       * @param limit 发现数上限;超出时置 `truncated`。
       * @returns 稳定的巡检结果。
       */
      function auditWorld(input, limit) {
          const findings = [];
          let truncated = false;
          const push = (finding) => {
              if (findings.length >= limit) {
                  truncated = true;
                  return;
              }
              findings.push(finding);
          };
          if (!input.worldPresent) {
              push({ severity: 'warning', code: 'world.missing', where: 'world.json', detail: '共享设定缺失:世界观只有人物档案能读。' });
          }
          if (!input.charactersPresent) {
              push({ severity: 'warning', code: 'characters.missing', where: 'characters.json', detail: '共享人物档案缺失:所有 characterIds 都无从核对。' });
          }
          const declaredCharacterIds = new Set(input.characters.map(character => character.id));
          const usedCharacterIds = new Set();
          for (const collection of input.collections) {
              const where = collection.slug;
              if (collection.blueprint === undefined) {
                  push({ severity: 'warning', code: 'collection.blueprint.missing', where, detail: '这一集没有蓝图:它不会出现在世界投影里。' });
              }
              if (!collection.hasTimeline) {
                  push({
                      severity: 'warning', code: 'collection.timeline.missing', where,
                      detail: '这一集没有时间线:编年史无法把它排进时间顺序,只能列为"无时间锚"。',
                  });
              }
              if (collection.chapters.length === 0) {
                  push({ severity: 'warning', code: 'collection.chapters.missing', where, detail: '这一集还没有任何章。' });
              }
              for (const characterId of collection.blueprint?.characterIds ?? []) {
                  usedCharacterIds.add(characterId);
                  if (!declaredCharacterIds.has(characterId)) {
                      push({
                          severity: 'error', code: 'character.undeclared', where,
                          detail: `集蓝图引用了未在 characters.json 声明的人物:${characterId}。`,
                      });
                  }
              }
              const declaredThreadIds = new Set((collection.blueprint?.threads ?? []).map(thread => thread.id));
              const advancedThreadIds = new Set();
              for (const chapter of collection.chapters) {
                  const chapterWhere = `${where}#${chapter.chapter}`;
                  if (!chapter.hasBlueprint) {
                      push({
                          severity: 'warning', code: 'chapter.blueprint.missing', where: chapterWhere,
                          detail: chapter.hasDraft
                              ? '有正文没有章节蓝图:这一章的出场与故事线推进都不会被记录(§6.8)。'
                              : '既没有正文也没有章节蓝图。',
                      });
                      // 没有蓝图 ⇒ 章级人物/线都无从谈起,后面的引用检查跳过。
                      continue;
                  }
                  if (!chapter.hasDraft) {
                      push({ severity: 'warning', code: 'chapter.draft.missing', where: chapterWhere, detail: '有章节蓝图但还没有正文。' });
                  }
                  for (const characterId of chapter.characterIds) {
                      usedCharacterIds.add(characterId);
                      if (!declaredCharacterIds.has(characterId)) {
                          push({
                              severity: 'error', code: 'character.undeclared', where: chapterWhere,
                              detail: `章节蓝图引用了未声明的人物:${characterId}。`,
                          });
                      }
                  }
                  for (const threadId of chapter.threadIds) {
                      advancedThreadIds.add(threadId);
                      if (!declaredThreadIds.has(threadId)) {
                          push({
                              severity: 'error', code: 'thread.undeclared', where: chapterWhere,
                              detail: `章节蓝图引用了本集未声明的故事线:${threadId}(它会被故事线投影忽略)。`,
                          });
                      }
                  }
                  if (chapter.povCharacterId !== '' && !declaredCharacterIds.has(chapter.povCharacterId)) {
                      push({
                          severity: 'error', code: 'character.undeclared', where: chapterWhere,
                          detail: `视角人物未在 characters.json 声明:${chapter.povCharacterId}。`,
                      });
                  }
              }
              for (const thread of collection.blueprint?.threads ?? []) {
                  if (!advancedThreadIds.has(thread.id)) {
                      push({
                          severity: 'warning', code: 'thread.unadvanced', where,
                          detail: `故事线「${thread.title}」(${thread.id})声明了但没有任何一章推进过它。`,
                      });
                  }
              }
          }
          for (const character of input.characters) {
              if (!usedCharacterIds.has(character.id)) {
                  push({
                      severity: 'warning', code: 'character.unused', where: character.id,
                      detail: `人物「${character.name}」已建档但没有任何集或章引用它。`,
                  });
              }
          }
          return {
              kind: 'audit',
              findings,
              collections: input.collections.length,
              chapters: input.collections.reduce((total, collection) => total + collection.chapters.length, 0),
              truncated,
          };
      }

  },
  };
  function __load(id) {
    if (Object.prototype.hasOwnProperty.call(__cache, id)) return __cache[id].exports;
    var module = { exports: {} };
    __cache[id] = module;
    var deps = __deps[id] || {};
    var localRequire = function (spec) {
      if (Object.prototype.hasOwnProperty.call(deps, spec)) return __load(deps[spec]);
      return externalRequire(spec);
    };
    __factories[id](module, module.exports, localRequire);
    return module.exports;
  }
  return __load(0);
} });
