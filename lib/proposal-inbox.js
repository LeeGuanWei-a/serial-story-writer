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
import { mkdir, readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write';
import { SerialProjectError, } from './types.js';
import { assertSerialSlug, canonicalSerialAssetText, canonicalSerialInitialization, } from './serial-project.js';
/** 收件箱目录:项目命名空间之下。 */
const INBOX_DIR = 'inbox';
/** 落盘文件权限位,与项目层一致。 */
const FILE_MODE = 0o644;
function fail(code, message) {
    throw new SerialProjectError(code, message);
}
/** 规范化 JSON:2 空格缩进 + LF + 结尾换行,与项目层同一套排版。 */
function canonicalJson(value) {
    return `${JSON.stringify(value, null, 2)}\n`;
}
/** 规范化 UTF-8 字节的 SHA-256。 */
function hashOf(text) {
    return createHash('sha256').update(text, 'utf8').digest('hex');
}
function requireObject(value, where) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        fail('INVALID_CONTENT', `${where} 必须是对象`);
    }
    return value;
}
function requireString(value, where) {
    if (typeof value !== 'string')
        fail('INVALID_CONTENT', `${where} 必须是字符串`);
    return value;
}
function rejectUnknownFields(value, allowed, where) {
    const unexpected = Object.keys(value).filter(key => !allowed.includes(key));
    if (unexpected.length > 0) {
        fail('INVALID_CONTENT', `${where} 含未知字段:${unexpected.join(', ')};只接受:${allowed.join(', ')}`);
    }
}
/** 提案命令的封闭集合。 */
const PROPOSAL_KINDS = ['initialize', 'replaceAsset', 'newCollection', 'deleteCollection', 'markCollectionFinished'];
/**
 * 校验并规范化一条提案命令。
 *
 * 内容型命令(initialize / replaceAsset / newCollection)走的是与写入路径**同一套**
 * 规范化函数,因此"收件箱里的建议将来能不能落盘"在记录时就已经确定。
 *
 * @param input 模型提交的原始命令。
 * @returns 规范化后的命令。
 */
export function normalizeProposalCommand(input) {
    const command = requireObject(input, '提案命令');
    const kind = requireString(command.kind, '提案命令 kind');
    if (!PROPOSAL_KINDS.includes(kind)) {
        fail('INVALID_CONTENT', `提案命令 kind 必须是 ${PROPOSAL_KINDS.join(' / ')},收到 ${JSON.stringify(kind)}`);
    }
    switch (kind) {
        case 'initialize': {
            rejectUnknownFields(command, ['kind', 'nextValue'], 'initialize 命令');
            const next = requireObject(command.nextValue, 'initialize.nextValue');
            rejectUnknownFields(next, [
                'kind', 'worldId', 'worldName', 'language', 'tone', 'creativeStrategy', 'createdAt', 'updatedAt',
            ], 'initialize.nextValue');
            const request = {
                kind: 'initialize',
                worldId: requireString(next.worldId, 'nextValue.worldId'),
                worldName: requireString(next.worldName, 'nextValue.worldName'),
                language: requireString(next.language, 'nextValue.language'),
                tone: requireString(next.tone, 'nextValue.tone'),
                creativeStrategy: requireString(next.creativeStrategy, 'nextValue.creativeStrategy'),
                createdAt: requireString(next.createdAt, 'nextValue.createdAt'),
                updatedAt: requireString(next.updatedAt, 'nextValue.updatedAt'),
            };
            // 复用审批卡片那条路径的校验(含 creativeStrategy 枚举)。
            canonicalSerialInitialization(request);
            return { kind: 'initialize', nextValue: request };
        }
        case 'replaceAsset': {
            rejectUnknownFields(command, ['kind', 'target', 'baseRevision', 'nextValue', 'summary'], 'replaceAsset 命令');
            const target = normalizeAssetRef(command.target);
            const submitted = requireString(command.nextValue, 'replaceAsset.nextValue');
            // 走与写入完全相同的规范化,并且**存规范化后的字节** —— 提案承载的就是将来
            // 会落盘的内容。这也让幂等键落在语义上:换排版重提同样内容不会产生第二条。
            const nextValue = canonicalSerialAssetText(target, submitted);
            return {
                kind: 'replaceAsset',
                target,
                baseRevision: requireString(command.baseRevision, 'replaceAsset.baseRevision'),
                nextValue,
                summary: requireString(command.summary, 'replaceAsset.summary'),
            };
        }
        case 'newCollection': {
            rejectUnknownFields(command, ['kind', 'blueprint', 'timeline', 'summary'], 'newCollection 命令');
            const blueprint = requireObject(command.blueprint, 'newCollection.blueprint');
            const slug = assertSerialSlug(requireString(blueprint.slug, 'newCollection.blueprint.slug'));
            const timeline = requireObject(command.timeline, 'newCollection.timeline');
            // 蓝图文件里**不存** slug(身份即目录名,§2.2 决定 1),所以校验时剥掉它;
            // 规范化之后再把它接回来,因为命令类型里 slug 是身份的一部分。
            const { slug: _slug, ...blueprintBody } = blueprint;
            const canonicalBlueprint = JSON.parse(canonicalSerialAssetText({ kind: 'collection-blueprint', slug }, JSON.stringify(blueprintBody)));
            const canonicalTimeline = JSON.parse(canonicalSerialAssetText({ kind: 'collection-timeline', slug }, JSON.stringify(timeline)));
            return {
                kind: 'newCollection',
                blueprint: { slug, ...canonicalBlueprint },
                timeline: canonicalTimeline,
                summary: requireString(command.summary, 'newCollection.summary'),
            };
        }
        case 'deleteCollection':
        case 'markCollectionFinished': {
            rejectUnknownFields(command, ['kind', 'slug', 'summary'], `${kind} 命令`);
            return {
                kind,
                slug: assertSerialSlug(requireString(command.slug, `${kind}.slug`)),
                summary: requireString(command.summary, `${kind}.summary`),
            };
        }
        default:
            return fail('INVALID_CONTENT', `未支持的提案命令:${kind}`);
    }
}
/** 校验命令里的资产引用。 */
function normalizeAssetRef(input) {
    const target = requireObject(input, 'replaceAsset.target');
    const kind = requireString(target.kind, 'replaceAsset.target.kind');
    switch (kind) {
        case 'project':
        case 'characters':
        case 'world':
            rejectUnknownFields(target, ['kind'], `资产引用 ${kind}`);
            return { kind };
        case 'collection-blueprint':
        case 'collection-timeline':
            rejectUnknownFields(target, ['kind', 'slug'], `资产引用 ${kind}`);
            return { kind, slug: assertSerialSlug(requireString(target.slug, `${kind}.slug`)) };
        case 'chapter-blueprint':
        case 'chapter-draft': {
            rejectUnknownFields(target, ['kind', 'slug', 'chapter'], `资产引用 ${kind}`);
            const chapter = target.chapter;
            if (!Number.isSafeInteger(chapter) || chapter <= 0) {
                fail('INVALID_CONTENT', `${kind}.chapter 必须是正整数`);
            }
            return { kind, slug: assertSerialSlug(requireString(target.slug, `${kind}.slug`)), chapter: chapter };
        }
        default:
            return fail('INVALID_CONTENT', `未知的资产类型:${kind}`);
    }
}
/** 一条命令供人看的一句话。 */
export function proposalSummary(command) {
    switch (command.kind) {
        case 'initialize': return `初始化项目:${command.nextValue.worldName}`;
        case 'replaceAsset': return command.summary;
        case 'newCollection': return command.summary;
        case 'deleteCollection': return command.summary;
        case 'markCollectionFinished': return command.summary;
    }
}
function isStoredProposal(value) {
    if (typeof value !== 'object' || value === null)
        return false;
    const record = value;
    return record.version === 1
        && typeof record.argumentHash === 'string'
        && typeof record.summary === 'string'
        && typeof record.createdAt === 'string'
        && typeof record.command === 'object' && record.command !== null;
}
/**
 * 提案的**效果键** —— 幂等比对的就是它。
 *
 * 刻意剥掉 `summary`:那是给人看的措辞,同一处改动换个说法不该在收件箱里排两条。
 *
 * 但**保留** `baseRevision`:它不是措辞,而是并发令牌。若把它也剥掉,模型在文件
 * 变动后重提同样内容会命中既有条目,而那条目里存着**旧的** baseRevision —— 将来
 * 谁按它落盘都会撞 `STALE_REVISION`。宁可多一条,不可存下一条自相矛盾的建议。
 *
 * @param command 已规范化的命令。
 * @returns 效果键的规范 JSON。
 */
function proposalEffectKey(command) {
    const { summary: _summary, ...effect } = command;
    return canonicalJson(effect);
}
/**
 * 打开一个项目的收件箱。
 *
 * @param root 工作区根目录。
 * @param options 大小与条数上限。
 * @returns 收件箱句柄。
 */
export function openSerialInbox(root, options) {
    const dir = join(root, '.serial', INBOX_DIR);
    async function listFiles() {
        try {
            const names = await readdir(dir);
            return names.filter(name => name.endsWith('.json')).sort();
        }
        catch (error) {
            if (error.code === 'ENOENT')
                return [];
            throw error;
        }
    }
    async function readAt(proposalId) {
        let text;
        try {
            text = await readFile(join(dir, `${proposalId}.json`), 'utf8');
        }
        catch (error) {
            if (error.code === 'ENOENT')
                return undefined;
            throw error;
        }
        let parsed;
        try {
            parsed = JSON.parse(text);
        }
        catch (error) {
            // 与项目层同样的立场:坏字节是稳定的 INVALID_CONTENT,不是原生 SyntaxError。
            return fail('INVALID_CONTENT', `提案 ${proposalId} 不是合法 JSON:${error.message}`);
        }
        if (!isStoredProposal(parsed)) {
            return fail('INVALID_CONTENT', `提案 ${proposalId} 形态不合法`);
        }
        return { proposalId, changeSetId: parsed.argumentHash, ...parsed };
    }
    async function list(signal) {
        signal.throwIfAborted();
        const records = [];
        for (const name of await listFiles()) {
            signal.throwIfAborted();
            const record = await readAt(name.slice(0, -'.json'.length));
            if (record !== undefined)
                records.push(record);
        }
        return records;
    }
    async function propose(command, summary, identity, signal) {
        signal.throwIfAborted();
        const argumentHash = hashOf(proposalEffectKey(command));
        const existing = await list(signal);
        const duplicate = existing.find(record => record.argumentHash === argumentHash);
        if (duplicate !== undefined) {
            // 幂等:同一个规范化命令重复提交不产生第二条。
            return {
                proposalId: duplicate.proposalId,
                changeSetId: duplicate.changeSetId,
                argumentHash,
                authoritative: false,
                status: 'pending',
                created: false,
                pendingCount: existing.length,
            };
        }
        if (existing.length >= options.maxPendingProposals) {
            fail('SIZE_LIMIT_EXCEEDED', `待审阅提案已达上限 ${options.maxPendingProposals} 条:请先审阅或清理 .serial/inbox/ 再提交新的建议。`);
        }
        const createdAt = new Date().toISOString();
        const stored = { version: 1, createdAt, identity, argumentHash, status: 'pending', summary, command };
        const body = canonicalJson(stored);
        const bytes = Buffer.byteLength(body, 'utf8');
        if (bytes > options.maxProposalBytes) {
            fail('SIZE_LIMIT_EXCEEDED', `提案 ${bytes} 字节,超过上限 ${options.maxProposalBytes}`);
        }
        // 文件名排序即时间序:等宽的时间戳前缀 + 哈希后缀。
        const proposalId = `${String(Date.now()).padStart(14, '0')}-${argumentHash.slice(0, 8)}`;
        await mkdir(dir, { recursive: true });
        signal.throwIfAborted();
        await writeFileAtomic(join(dir, `${proposalId}.json`), body, { mode: FILE_MODE, dirMode: 0o755 });
        return {
            proposalId,
            changeSetId: argumentHash,
            argumentHash,
            authoritative: false,
            status: 'pending',
            created: true,
            pendingCount: existing.length + 1,
        };
    }
    return { propose, list };
}
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
export function assertProposalProjectState(command, projectExists) {
    if (command.kind === 'initialize') {
        if (projectExists)
            fail('ALREADY_INITIALIZED', '项目已经初始化:initialize 建议无从提出。');
        return;
    }
    if (!projectExists) {
        fail('NOT_INITIALIZED', '项目尚未初始化:只有 initialize 建议能在这一步提出。');
    }
}
