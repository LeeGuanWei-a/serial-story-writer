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
/** 一个块级节点。 */
export type MarkdownBlock = {
    readonly kind: 'heading';
    readonly level: number;
    readonly text: string;
} | {
    readonly kind: 'paragraph';
    readonly text: string;
} | {
    readonly kind: 'list';
    readonly ordered: boolean;
    readonly items: readonly string[];
} | {
    readonly kind: 'quote';
    readonly text: string;
} | {
    readonly kind: 'code';
    readonly text: string;
} | {
    readonly kind: 'rule';
};
/** 一段行内内容。 */
export type MarkdownSpan = {
    readonly kind: 'text';
    readonly text: string;
} | {
    readonly kind: 'strong';
    readonly text: string;
} | {
    readonly kind: 'em';
    readonly text: string;
} | {
    readonly kind: 'code';
    readonly text: string;
} | {
    readonly kind: 'link';
    readonly text: string;
    readonly href: string;
};
/**
 * 把正文拆成块级节点。
 *
 * @param text 正文文本。
 * @returns 块级节点序列。
 */
export declare function parseMarkdown(text: string): readonly MarkdownBlock[];
/**
 * 把一段文字拆成行内片段。
 *
 * @param text 一段行内文字。
 * @returns 行内片段序列;没有标记时是单个 `text` 片段。
 */
export declare function parseInline(text: string): readonly MarkdownSpan[];
