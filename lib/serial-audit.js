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
/**
 * 巡检一个世界,返回有界报告。
 *
 * 它**只报告**。发现的问题不会抛异常、也不让读取失败 —— 一份有缺口的手稿仍然应该能读。
 *
 * @param input 世界索引的判定视图。
 * @param limit 发现数上限;超出时置 `truncated`。
 * @returns 稳定的巡检结果。
 */
export function auditWorld(input, limit) {
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
