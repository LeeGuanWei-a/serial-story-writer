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
import { createElement, useEffect, useMemo, useState } from 'react';
import { watchWorkspacePath } from "./change-watch.js";
import { SERIAL_DIR } from '../serial-layout.js';
import { parseInline, parseMarkdown } from "./markdown.js";
import { assembleCollectionMarkdown } from '../serial-export.js';
import { chapterDraftPath, stringField, collectCharacterAppearances, collectThreadAdvances, jsonField, loadProject, readAsset, stringArrayField, } from "./serial-files.js";
/**
 * 找出主视图正在展示的会话。
 *
 * 根作用域的 `main` 面板拿不到 session binding,所以从会话列表里找"被主视图保留"
 * 的那一个 —— 与 dsh 会话浏览器的判断方式一致。
 *
 * @param list 会话列表快照。
 * @returns 会话 id;没有打开的会话时为 undefined。
 */
export function currentSessionId(list) {
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
    return createElement('div', { style: { display: 'flex', gap: '10px', alignItems: 'baseline' } }, createElement('span', { style: { opacity: 0.55, minWidth: '74px' } }, label), createElement('span', { style: { minWidth: 0, overflowWrap: 'anywhere' } }, value));
}
/** 小节标题。 */
function section(title) {
    return createElement('div', {
        style: { marginTop: '16px', paddingTop: '8px', borderTop: PALETTE.line, fontWeight: 600 },
    }, title);
}
/** 树里的一行按钮。 */
function treeRow(key, label, selected, depth, onSelect, badge) {
    return createElement('button', {
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
    }, createElement('span', { style: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, label), badge === undefined ? null : createElement('span', { style: { color: PALETTE.faint, fontSize: '11px' } }, badge));
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
    return createElement('ul', { style: { margin: 0, paddingLeft: '18px' } }, ...values.map((value, index) => createElement('li', { key: index }, value)));
}
/**
 * 「短篇集工作台」主面板。
 *
 * @param props 宿主标准 props 与绑定的 Remote 切片。
 * @returns 面板元素。
 */
export function SerialWorkbenchPanel(props) {
    const useSessions = props.useSessions ?? (() => undefined);
    const selectWorkspaces = props.useWorkspaces ?? (() => undefined);
    // hook 必须无条件按同样顺序调用,所以这里始终调用,只是可能拿到 undefined。
    const sessionList = useSessions(state => state);
    const workspaceList = selectWorkspaces(state => state);
    const sessionId = currentSessionId(sessionList);
    const [selection, setSelection] = useState({ kind: 'world' });
    const [state, setState] = useState({ kind: 'idle' });
    const [detail, setDetail] = useState(undefined);
    const [exportText, setExportText] = useState(undefined);
    const files = props.files;
    const watcher = props.watcher;
    // 磁盘版本号:每次变更通知就加一,让下面的加载 effect 重跑。用计数而不是把快照
    // 塞进依赖里,是为了让"重新加载"这件事只有一个入口。
    const [diskRevision, setDiskRevision] = useState(0);
    useEffect(() => {
        if (files === undefined || sessionId === undefined) {
            setState({ kind: 'idle' });
            return;
        }
        const controller = new AbortController();
        setState({ kind: 'loading' });
        loadProject(files, sessionId, controller.signal)
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
    useEffect(() => {
        if (watcher === undefined || watcher.workspaceFiles === undefined || sessionId === undefined)
            return;
        const controller = new AbortController();
        void (async () => {
            try {
                for await (const kind of watchWorkspacePath(watcher, sessionId, SERIAL_DIR, controller.signal)) {
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
    useEffect(() => {
        if (files === undefined || sessionId === undefined || snapshot?.kind !== 'ready') {
            setDetail(undefined);
            return;
        }
        const controller = new AbortController();
        const relative = selection.kind === 'chapter'
            ? chapterDraftPath(selection.slug, selection.chapter)
            : undefined;
        if (relative === undefined) {
            setDetail(undefined);
            return;
        }
        readAsset(files, sessionId, relative, controller.signal)
            .then(asset => { if (!controller.signal.aborted)
            setDetail(asset); })
            .catch(() => { if (!controller.signal.aborted)
            setDetail(undefined); });
        return () => controller.abort();
    }, [files, sessionId, snapshot, selection]);
    // 导出要读**全部**章节正文(结构快照里只有大小),所以按需另读一次。装配用的是与
    // Host 侧 `kind="export"` 同一个纯函数。
    useEffect(() => {
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
                    const draft = await readAsset(files, sessionId, chapterDraftPath(selection.slug, chapter.chapter), controller.signal);
                    chapters.push({
                        chapter: chapter.chapter,
                        title: stringField(chapter.blueprint.text, 'title'),
                        text: draft.revision === 'absent' ? '' : draft.text,
                    });
                }
                if (controller.signal.aborted)
                    return;
                setExportText(assembleCollectionMarkdown({
                    slug: collection.slug,
                    title: stringField(collection.blueprint.text, 'title'),
                    theme: stringField(collection.blueprint.text, 'theme'),
                    summary: stringField(collection.blueprint.text, 'summary'),
                    status: stringField(collection.blueprint.text, 'status'),
                    season: stringField(collection.timeline.text, 'season'),
                    startDate: stringField(collection.timeline.text, 'startDate'),
                    endDate: stringField(collection.timeline.text, 'endDate'),
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
    const workspaceTitle = useMemo(() => {
        if (sessionId === undefined || workspaceList === undefined)
            return undefined;
        const owner = workspaceList.items.find(item => item.sessionIds?.includes(sessionId) === true);
        return owner?.title ?? owner?.workspaceId;
    }, [sessionId, workspaceList]);
    return createElement('section', { 'aria-label': '短篇集工作台', style: SHELL_STYLE }, createElement('header', {
        style: { padding: '12px 20px', borderBottom: PALETTE.line, display: 'flex', gap: '10px', alignItems: 'baseline' },
    }, createElement('span', { style: { fontWeight: 600 } }, '短篇集工作台'), createElement('span', { style: { color: PALETTE.faint, fontSize: '12px' } }, '只读'), createElement('span', { style: { flex: 1 } }), createElement('span', { style: { color: PALETTE.muted, fontSize: '12px' } }, sessionId === undefined ? '无打开的会话' : workspaceTitle ?? sessionId.slice(0, 8))), body(props, state, snapshot, selection, setSelection, detail, exportText, sessionId));
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
    return createElement('div', { style: BODY_STYLE }, createElement('nav', { style: TREE_STYLE }, ...tree(snapshot, selection, select)), createElement('div', { style: DETAIL_STYLE }, ...detailOf(snapshot, selection, detail, exportText)));
}
/** 居中提示。 */
function notice(text) {
    return createElement('div', {
        style: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '32px', textAlign: 'center' },
    }, createElement('p', { style: { margin: 0, maxWidth: '46ch', color: PALETTE.muted } }, text));
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
        createElement('h2', { style: { margin: 0, fontSize: '15px', fontWeight: 600 } }, '跨集巡检'),
        createElement('p', { style: { margin: '4px 0 0', color: PALETTE.muted } }, `巡视了 ${audit.collections} 集 / ${audit.chapters} 章。这是**报告**不是校验器 —— 有问题也不会让读取失败,一份有缺口的手稿仍然应该能读。`),
        fact('错误', String(errors.length)),
        fact('警告', String(warnings.length)),
    ];
    if (audit.truncated) {
        rows.push(createElement('p', { style: { margin: '6px 0 0', color: PALETTE.muted } }, '(发现过多,已截断;完整清单以模型侧的 kind="audit" 为准。)'));
    }
    if (audit.findings.length === 0) {
        rows.push(createElement('p', { style: { margin: '10px 0 0', color: PALETTE.muted } }, '没有发现问题。'));
        return rows;
    }
    rows.push(section('发现'));
    for (const finding of audit.findings) {
        rows.push(createElement('div', {
            key: `${finding.code}-${finding.where}`,
            style: { marginTop: '8px', paddingTop: '8px', borderTop: PALETTE.line },
        }, createElement('div', { style: { display: 'flex', gap: '8px', alignItems: 'baseline' } }, createElement('span', {
            style: {
                fontSize: '11px',
                padding: '0 6px',
                borderRadius: '999px',
                border: PALETTE.line,
                color: finding.severity === 'error' ? 'inherit' : PALETTE.muted,
                fontWeight: finding.severity === 'error' ? 600 : 400,
                whiteSpace: 'nowrap',
            },
        }, finding.severity === 'error' ? '错误' : '警告'), createElement('code', { style: { fontSize: '12px', color: PALETTE.muted } }, finding.code), createElement('span', { style: { fontSize: '12px', color: PALETTE.faint, overflowWrap: 'anywhere' } }, finding.where)), createElement('p', { style: { margin: '2px 0 0', overflowWrap: 'anywhere' } }, finding.detail)));
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
        createElement('h2', { style: { margin: 0, fontSize: '15px', fontWeight: 600 } }, `导出整集 · ${slug}`),
        createElement('p', { style: { margin: '4px 0 0', color: PALETTE.muted } }, '这是把这一集装订成**一份** Markdown 的结果:集名、题记,然后每章一个标题加正文,按章节号升序。没有正文的章保留标题并标出缺失 —— 不会静默丢章。'),
    ];
    if (text === undefined) {
        rows.push(createElement('p', { style: { margin: '8px 0 0', color: PALETTE.muted } }, '正在装配…'));
        return rows;
    }
    rows.push(fact('字节数', String(new TextEncoder().encode(text).byteLength)));
    rows.push(fact('章数', String(collection?.chapters.length ?? 0)));
    rows.push(createElement('div', { style: { marginTop: '8px' } }, createElement('button', {
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
    rows.push(createElement('div', {
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
            createElement('h2', { style: { margin: 0, fontSize: '15px', fontWeight: 600 } }, '待审阅提案'),
            createElement('p', { style: { margin: '8px 0 0', color: PALETTE.muted } }, '收件箱是空的。提案模式下的模型可以把修改建议写进 .serial/inbox/,等人审阅 —— 它们不会自动落盘。'),
        ];
    }
    return [
        createElement('h2', { style: { margin: 0, fontSize: '15px', fontWeight: 600 } }, `待审阅提案(${snapshot.proposals.length})`),
        createElement('p', { style: { margin: '4px 0 0', color: PALETTE.muted } }, '以下都是**建议**:项目本身一个字节都没有改变。要落实其中一条,需要走原生一次性审批的写入路径。'),
        ...snapshot.proposals.map(proposal => createElement('div', {
            key: proposal.proposalId,
            style: { marginTop: '12px', paddingTop: '10px', borderTop: PALETTE.line },
        }, fact('摘要', proposal.summary), fact('命令', proposal.commandKind), fact('状态', `${proposal.status}(非权威)`), fact('时间', proposal.createdAt), fact('id', proposal.proposalId), createElement('pre', {
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
    const rules = stringArrayField(snapshot.project.text, 'writingRules');
    return [
        createElement('h2', { style: { margin: 0, fontSize: '15px', fontWeight: 600 } }, '项目清单'),
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
        return [createElement('h2', { style: { margin: 0, fontSize: '15px', fontWeight: 600 } }, '世界观设定'),
            createElement('p', { style: { color: PALETTE.muted } }, 'world.json 还不存在。')];
    }
    const world = parseJson(text);
    const locations = stringArrayField(text, 'locations');
    const organizations = stringArrayField(text, 'organizations');
    const rules = stringArrayField(text, 'rules');
    const glossary = field(world, 'glossary');
    return [
        createElement('h2', { style: { margin: 0, fontSize: '15px', fontWeight: 600 } }, '世界观设定'),
        fact('时代', describe(field(world, 'era'))),
        assetLine('修订号', snapshot.world),
        section('一句话设定'),
        createElement('p', { style: { margin: 0, whiteSpace: 'pre-wrap' } }, describe(field(world, 'setting'))),
        organizations.length === 0 ? null : section(`机构(${organizations.length})`),
        organizations.length === 0 ? null : stringList(organizations),
        locations.length === 0 ? null : section(`地点(${locations.length})`),
        locations.length === 0 ? null : stringList(locations),
        rules.length === 0 ? null : section(`世界如何运转(${rules.length})`),
        rules.length === 0 ? null : stringList(rules),
        !Array.isArray(glossary) || glossary.length === 0 ? null : section(`术语(${glossary.length})`),
        !Array.isArray(glossary) || glossary.length === 0 ? null : createElement('dl', {
            style: { margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 14px' },
        }, ...glossary.flatMap((entry, index) => [
            createElement('dt', { key: `t${index}`, style: { fontWeight: 600 } }, describe(field(entry, 'term'))),
            createElement('dd', { key: `d${index}`, style: { margin: 0 } }, describe(field(entry, 'definition'))),
        ])),
        section('笔记'),
        createElement('p', { style: { margin: 0, whiteSpace: 'pre-wrap', color: PALETTE.muted } }, describe(field(world, 'notes'))),
    ].filter((item) => item !== null);
}
function charactersDetail(snapshot) {
    const items = jsonField(snapshot.characters.text, 'items');
    const cast = Array.isArray(items) ? items : [];
    if (snapshot.characters.revision === 'absent') {
        return [createElement('h2', { style: { margin: 0, fontSize: '15px', fontWeight: 600 } }, '人物档案'),
            createElement('p', { style: { color: PALETTE.muted } }, 'characters.json 还不存在。')];
    }
    return [
        createElement('h2', { style: { margin: 0, fontSize: '15px', fontWeight: 600 } }, `人物档案(${cast.length})`),
        assetLine('修订号', snapshot.characters),
        // 出场事实只来自蓝图(§6.8):"整集"来自短篇集蓝图,"章级"来自章节蓝图。
        // 因此"有正文没蓝图"的集在章级一栏会是空的 —— 这是事实,不是面板的缺陷。
        ...cast.flatMap((character, index) => {
            const id = describe(jsonField(JSON.stringify(character), 'id'));
            const name = describe(jsonField(JSON.stringify(character), 'name'));
            const role = describe(jsonField(JSON.stringify(character), 'role'));
            const appearances = collectCharacterAppearances(snapshot.collections, id);
            const chapters = appearances.flatMap(item => item.chapters.map(chapter => `${item.slug}#${chapter}`));
            return [
                createElement('div', {
                    key: `c${index}`,
                    style: { marginTop: '12px', paddingTop: '10px', borderTop: PALETTE.line },
                }, fact('人物', `${name} · ${role}`), fact('id', id), fact('目标', describe(jsonField(JSON.stringify(character), 'goal'))), fact('整集出场', appearances.filter(item => item.wholeCollection).map(item => item.slug).join('、') || '—'), fact('章级出场', chapters.length === 0 ? '—(需章节蓝图)' : chapters.join('、'))),
            ];
        }),
    ];
}
function collectionDetail(snapshot, slug) {
    const collection = snapshot.collections.find(item => item.slug === slug);
    if (collection === undefined)
        return [noticeLike('这一集不见了。')];
    const text = collection.blueprint.text;
    const castIds = stringArrayField(text, 'characterIds');
    const threads = collectThreadAdvances(collection);
    const chaptersWithoutBlueprint = collection.chapters.filter(chapter => chapter.blueprint.revision === 'absent').length;
    return [
        createElement('h2', { style: { margin: 0, fontSize: '15px', fontWeight: 600 } }, describe(jsonField(text, 'title'))),
        fact('slug', slug),
        fact('状态', describe(jsonField(text, 'status'))),
        fact('目标字数', describe(jsonField(text, 'targetWords'))),
        assetLine('蓝图修订号', collection.blueprint),
        fact('时间线', collection.timeline.revision === 'absent' ? 'absent' : shortRevision(collection.timeline.revision)),
        section('主题'),
        createElement('p', { style: { margin: 0, whiteSpace: 'pre-wrap' } }, describe(jsonField(text, 'theme'))),
        section('梗概'),
        createElement('p', { style: { margin: 0, whiteSpace: 'pre-wrap' } }, describe(jsonField(text, 'summary'))),
        section(`出场人物(${castIds.length})`),
        castIds.length === 0 ? createElement('p', { style: { margin: 0, color: PALETTE.muted } }, '—') : stringList(castIds),
        section(`故事线(${threads.length})`),
        threads.length === 0
            ? createElement('p', { style: { margin: 0, color: PALETTE.muted } }, '这一集还没有声明故事线(blueprint.threads)。加上 threads 后,章节蓝图用 threadIds 标记推进。')
            : createElement('div', {}, ...threads.map(thread => createElement('div', {
                key: thread.id,
                style: { marginBottom: '8px' },
            }, fact('线', `${thread.title}(${thread.id})`), fact('推进', thread.advances.length === 0 ? '尚未推进' : thread.advances.map(n => `第 ${n} 章`).join('、')), createElement('p', { style: { margin: '2px 0 0', color: PALETTE.muted } }, thread.summary)))),
        section(`章节(${collection.chapters.length})`),
        chaptersWithoutBlueprint === 0
            ? null
            : createElement('p', { style: { margin: '0 0 8px', color: PALETTE.muted } }, `有 ${chaptersWithoutBlueprint} 章缺章节蓝图 —— 这些章不会出现在出场或故事线推进里。`),
        chapterTable(collection.chapters),
    ].filter((item) => item !== null);
}
/** 章节清单:蓝图/正文的存在性一目了然。 */
function chapterTable(chapters) {
    if (chapters.length === 0) {
        return createElement('p', { style: { margin: 0, color: PALETTE.muted } }, '还没有章节。');
    }
    return createElement('div', { style: { display: 'grid', gridTemplateColumns: 'auto auto auto 1fr', gap: '4px 16px' } }, ...chapters.flatMap(chapter => {
        const hasBlueprint = chapter.blueprint.revision !== 'absent';
        return [
            createElement('span', { key: `n${chapter.chapter}`, style: { fontWeight: 600 } }, `第 ${chapter.chapter} 章`),
            createElement('span', { key: `b${chapter.chapter}`, style: { color: hasBlueprint ? PALETTE.muted : 'inherit' } }, hasBlueprint ? '蓝图 ✓' : '蓝图 ✗'),
            createElement('span', { key: `d${chapter.chapter}`, style: { color: chapter.hasDraft ? PALETTE.muted : 'inherit' } }, chapter.hasDraft ? '正文 ✓' : '正文 ✗'),
            createElement('span', { key: `s${chapter.chapter}`, style: { color: PALETTE.faint } }, hasBlueprint ? `${chapter.characterIds.length} 人 / ${chapter.threadIds.length} 线` : ''),
        ];
    }));
}
function chapterDetail(snapshot, selection, detail) {
    const collection = snapshot.collections.find(item => item.slug === selection.slug);
    const chapter = collection?.chapters.find(item => item.chapter === selection.chapter);
    const hasBlueprint = chapter !== undefined && chapter.blueprint.revision !== 'absent';
    const rows = [
        createElement('h2', { style: { margin: 0, fontSize: '15px', fontWeight: 600 } }, `${selection.slug} · 第 ${selection.chapter} 章`),
        fact('章节蓝图', hasBlueprint
            ? `存在 · ${shortRevision(chapter.blueprint.revision)}(出场 ${chapter.characterIds.length} 人 / 推进 ${chapter.threadIds.length} 线)`
            : '缺失'),
    ];
    if (!hasBlueprint) {
        rows.push(createElement('p', { style: { margin: '8px 0 0', color: PALETTE.muted } }, '没有章节蓝图,这一章不会出现在 appearances 或故事线推进里 —— 正文写了也不算。'));
    }
    if (detail === undefined) {
        rows.push(createElement('p', { style: { margin: '8px 0 0', color: PALETTE.muted } }, '正在读取正文…'));
        return rows;
    }
    rows.push(assetLine('正文修订号', detail));
    rows.push(section('正文预览'));
    rows.push(createElement('div', {
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
    return parseMarkdown(text).map((block, index) => {
        switch (block.kind) {
            case 'heading':
                return createElement(`h${Math.min(block.level + 2, 6)}`, {
                    key: index,
                    style: {
                        margin: index === 0 ? '0 0 6px' : '16px 0 6px',
                        fontSize: `${Math.max(1.35 - block.level * 0.08, 1)}em`,
                        fontWeight: 600,
                    },
                }, ...markdownSpans(block.text));
            case 'paragraph':
                // 段内换行原样保留:中文正文折行不该多出空格。
                return createElement('p', {
                    key: index,
                    style: { margin: '0 0 10px', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' },
                }, ...markdownSpans(block.text));
            case 'list':
                return createElement(block.ordered ? 'ol' : 'ul', {
                    key: index,
                    style: { margin: '0 0 10px', paddingLeft: '22px' },
                }, ...block.items.map((item, itemIndex) => createElement('li', { key: itemIndex }, ...markdownSpans(item))));
            case 'quote':
                return createElement('blockquote', {
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
                return createElement('pre', {
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
                return createElement('hr', {
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
    return parseInline(text).map((span, index) => {
        switch (span.kind) {
            case 'text': return span.text;
            case 'strong': return createElement('strong', { key: index }, span.text);
            case 'em': return createElement('em', { key: index }, span.text);
            case 'code':
                return createElement('code', {
                    key: index,
                    style: { background: 'color-mix(in srgb, currentColor 10%, transparent)', borderRadius: '3px', padding: '0 3px' },
                }, span.text);
            case 'link':
                return createElement('a', {
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
    return createElement('p', { style: { margin: 0, color: PALETTE.muted } }, text);
}
