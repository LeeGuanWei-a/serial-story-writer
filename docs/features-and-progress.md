# 短篇集作家插件 — 功能规划与实现进度

> **快照信息**:版本 `0.2.0` · 目标运行时 `dsh 0.2.1-rc.2` · 仓库 `F:\Projects\serial-story-writer`
> **本文性质**:功能范围与进度的**当前快照**。进度只依据可复现的证据(源码、测试、构建校验)标注,不依据意图。
> **0.2.0 版的边界**:本版是**运行时适配版**(0.2.0-rc.2 → 0.2.1-rc.2)。领域模型、工具面、面板功能与 0.1.1 一致,变化集中在依赖线、准入声明与构建/校验链(见 §6.18)。

---

## 1. 一句话定位

在 DeepSeek Harness 上提供一个 **「世界观 → 多短篇集」** 的本地优先写作插件:一个世界观拥有共享的人物档案与设定,下面是若干**互相独立又互相关联**的短篇集;同一位角色跨集出现,靠稳定 ID 引用,不复制、不重定义人物资料。

对标场景是「偶像大师 闪耀色彩」那种形态——同一批角色在多个独立短篇里出演,人物设定在世界观层共享。

---

## 2. 产品形态

### 2.1 领域模型

```
世界观 (world)                       ← 世界内的事实
├── project.json          项目清单:世界身份 + 创作方针(writingRules)
├── characters.json       共享人物档案:跨集唯一事实源
├── world.json            共享设定:setting / locations / notes
│                         + era / organizations / rules / glossary(步 3 新增,可选)
└── collections/          若干短篇集,彼此独立
    ├── blueprint.json    该集蓝图:主题、出场角色、目标字数、状态
    │                     + threads 故事线声明(步 3 新增,可选)
    ├── timeline.json     该集自己的时间线(不与其他集共享)
    └── chapters/
        ├── NNNN-blueprint.json   章节蓝图 + threadIds(步 3 新增,可选)
        └── NNNN.md               章节正文
```

关键点:**短篇集之间没有隐含顺序**。每集自带时间线,人物状态默认不跨集累计。

**故事的"线"与"集"同寿**(§6.10):`threads` 声明在短篇集蓝图里,章节蓝图用 `threadIds` 标记推进。跨集的连续性由**人物**承担(稳定 id 引用),不由线承担 —— 这保住了"每集是独立作品"这条不变量。

**事实与方针分开**:世界如何运转(`world.rules`、`world.organizations`)属于世界内事实,放 `world.json`;我怎么写(现实向、单一限知视角)属于创作方针,放 `project.writingRules`。

### 2.2 四个已确立的设计决定

| 决定 | 内容 | 为什么 |
|---|---|---|
| **身份即目录名** | 短篇集的身份是 `collections/<slug>/` 目录名;`blueprint.json` 里**不存** slug,读取时由目录注入 | 消除"两处身份不一致"的可能;`slug` 形态约束同时阻断路径穿越 |
| **修订号即并发** | 每个非空资产的修订号 = 规范化 UTF-8 字节的 SHA-256;替换请求只带"上次读到的修订号" | 模型**永远不需要复述权威旧文本**,也就不可能因复述出错 |
| **落盘即规范字节** | JSON 经严格 schema 校验(未知字段直接拒绝)后按 2 空格缩进 + LF 重新序列化;正文 LF 归一化 | 换排版重提同样语义 → 修订号不变 → 不产生假冲突 |
| **写入必经审批** | 任何写入都要经过 Harness 原生一次性审批;浏览器侧不暴露任何 mutation RPC | 模型不能单方面改稿;审批卡片展示的就是即将落盘的内容 |

---

## 3. 包结构:四个入口

| 入口 | 文件 | 职责 | 状态 |
|---|---|---|---|
| 根入口(Host) | `src/index.ts` | 只声明 `workspaceRegistry` 依赖;loopback 读端点是纯函数 | ✅ 已实现 |
| `./agent` | `src/agent.ts` | V1 工具:`serial_read` + `serial_apply_change`(原生审批写入) | ✅ 已实现并**由内联预设挂载**(M3) |
| `./agent-v2` | `src/agent-v2.ts` | V2 工具:`serial_read` + `serial_propose_change`(提案式) | 🟡 读已实现;写未实现;**未挂载** |
| `./client` | `src/client/index.ts` | Client 插件:注册侧栏图标与主面板 | ✅ 已实现并验证渲染 |

---

## 4. 功能清单与进度

状态取值:**✅ 已完成并验证** · **🟡 部分实现** · **⬜ 未开始** · **⛔ 受阻**

### 4.1 Host 侧

| 功能 | 状态 | 证据 / 说明 |
|---|---|---|
| 插件被 Profile 识别并激活 | ✅ | `fiberPhase: active`,启动无 `did not activate` |
| Host 配置 | ✅ | 空 schema;`presetRoot` 随目录发布机制一同移除(§6.2) |
| loopback 通道注册 | ⛔ | **0.2.1 起技术上已可行**(§6.1),但**刻意不做**:浏览器侧不需要写入口 |
| 浏览器侧 mutation 端点 | ⛔ | **刻意不做**:写入只能走原生审批 |

### 4.2 项目文件层(`src/serial-project.ts`)

| 功能 | 状态 | 说明 |
|---|---|---|
| 读取资产(文本 + 修订号 + 截断标记) | ✅ | 超过 `assetBytes` 时截断并置 `truncated` |
| 缺失的**非清单**资产 | ✅ | 返回 `revision: 'absent'` 的空资产,可直接用于 `replace` |
| **未初始化**项目的读取 | ✅ | 所有读取以 `NOT_INITIALIZED` 失败——这是模型判断"该不该 initialize"的唯一信号 |
| 初始化 | ✅ | 写入规范化 `project.json`;已存在则 `ALREADY_INITIALIZED`,不覆盖 |
| 比较并替换(compare-and-swap) | ✅ | `baseRevision` 不匹配即 `STALE_REVISION`,**写入前**失败 |
| 单文件原子替换 | ✅ | 走 `@deepseek-ai/dsh-atomic-write` 的 rename 提交 |
| 严格 JSON schema 校验 | ✅ | 未知字段、类型错误、重复 ID、非法枚举一律 `INVALID_CONTENT` |
| 既有字节损坏时的读取 | ✅ | 统一为稳定的 `INVALID_CONTENT`(不是原生 `SyntaxError`) |
| slug 路径约束 | ✅ | `[a-z0-9][a-z0-9-]{0,62}`,越权路径 `PATH_REJECTED` |
| 章节号补零文件名 | ✅ | `7` → `0007.md` / `0007-blueprint.json` |
| 世界投影(`world`) | ✅ | 共享人物 + 短篇集蓝图;可带 `slug` 收窄到一集(仍给全部人物) |
| 人物出场投影(`appearances`) | ✅ | 汇总某角色在哪些集/章出场,受 `queryMatches` 约束 |
| **故事线投影(`threads`)** | ✅ | 步 3 新增:每条线出自哪个集、哪些章节推进过它;可带 `slug` 收窄 |
| **跨集巡检(`audit`)** | ✅ | 步 6 新增:一次报出全部结构问题(缺蓝图/缺时间线/引用未声明的人物或线/声明了没人推进的线/建档没人用的人物);**只报告,不修改** |
| **人物编年史(`chronicle`)** | ✅ | 步 6 新增:某人物跨集的站点;**有时间锚的按时间排序,没锚的单独列出** —— 不发明顺序、不发明状态 |
| 共享世界索引 | ✅ | 步 6 抽出:四个跨集投影共用一次遍历。它把「出场与故事线推进只认蓝图」变成**结构性**规则(没有蓝图 ⇒ 那两项必然为空),否则这条规则会散落四份 |
| 大小上限 | ✅ | 超限 `SIZE_LIMIT_EXCEEDED` |
| 取消 | ✅ | 项目层抛 harness 原生 `AbortError`;类型里不再有 `CANCELLED`(见 §6.4),契约由测试钉住 |
| **可选字段物化** | ✅ | 步 3 的可选字段在写入时一律物化成空值 —— 保证规范化幂等,否则 `era:""` 与省略 `era` 会算出两个修订号 |
| **世界身份不可变** | ✅ | `replace` 项目清单时 `worldId` 必须与盘上一致,否则 `INVALID_CONTENT`;清单缺失时 `replace` 以 `NOT_INITIALIZED` 要求走 `initialize` |

### 4.3 模型面工具

| 工具 | 分支 | 状态 |
|---|---|---|
| `serial_read` (V1) | `kind: asset` | ✅ |
| `serial_read` (V1) | `kind: world` | ✅ 可带 `slug` 收窄(步 3 前该参数被接受但**被忽略**,已修) |
| `serial_read` (V1) | `kind: appearances` | ✅ |
| `serial_read` (V1) | `kind: threads` | ✅ 步 3 新增 |
| `serial_read` (V1) | `kind: audit` | ✅ 步 6 新增:跨集巡检 |
| `serial_read` (V1) | `kind: chronicle` | ✅ 步 6 新增:人物编年史(需 `characterId`) |
| `serial_read` 参数表 | — | ✅ 删掉从未生效的 `limit`(schema 广告它,解析器却当多余字段拒) |
| `serial_apply_change` | `kind: initialize` | ✅ 已实现,并由内联预设挂载(M3) |
| `serial_apply_change` | `kind: replace` | ✅ 已实现,并由内联预设挂载(M3) |
| 原生一次性审批门 | `serial_apply_change` | ✅ |
| 审批卡片 | — | ✅ 展示**规范化终态字节** + 真实落盘路径 |
| **审批前内容校验** | `serial_apply_change` | ✅ 内容非法时以 `deny` 直接返回原因,**不弹审批**;合法写入才 `ask`(§6.7) |
| 资产 schema 对模型可见 | — | ✅ 七类资产的顶层字段表写进 `serial_apply_change` 的描述;报错也列出允许字段(§6.7) |
| 工具面收窄(只暴露本预设的两个工具) | — | ✅ **M3 已补齐**:`apply`(V1)与 `applyV2` 都调用 `installDedicatedPresetSurface`,按 preset id 只收窄本预设组合出的 Agent,并拒绝其余工具调用 |
| `serial_read` (V2) | `kind: state` / `asset` | ✅ |
| `serial_read` (V2) | `kind: inbox` | ✅ 步 5 新增:列出待审阅的非权威提案 |
| `serial_propose_change` (V2) | — | ✅ **步 5 已实现**:命令走与写入同一套校验后落进 JSON 收件箱,收据 `authoritative: false` |
| 非权威提案收件箱 | — | ✅ JSON 存储(`.serial/inbox/`)、规范化幂等键、条数与字节上限(§6.12) |
| 提案的落盘路径 | — | ⬜ **未定**:提案如何变成一次真实写入,见 §7 决定 7 |

### 4.4 Preset

| 功能 | 状态 | 说明 |
|---|---|---|
| 预设内容(persona + instructions + 工具入口) | ✅ | 内联写在 `cordis.patch.yml` 的 `preset-short-story-writer` 行 |
| **在组合中内联声明预设** | ✅ | **M3 完成**。`dsh --profile web --dump-config` 输出该行;运行中 Host 的 `include:preset-short-story-writer` 为 `status: schema` |
| 预设被会话列表发现 | ✅ | 注册表 `list()` 返回 id/name;选择器落在 `conversation.hero.agentPreset` 插槽 |
| 目录拷贝式安装 | ⛔ 已删除 | 该机制在 `0.2.0-rc.2` 上不生效;产物 `src/preset-installer.ts`、`scripts/install-preset.mjs`、`presets/` 已移除 |

### 4.5 Client / 浏览器

| 功能 | 状态 | 说明 |
|---|---|---|
| Client 插件被宿主加载 | 🟡 | 结构已改(注入 `slots` + `remote` + `remote.workspaceFiles`);**浏览器内激活尚未实测**(§6.11) |
| 侧栏面板图标 | ✅ | `sidebar.panellist`,id `serial-story`,order 50 |
| 主列面板 | ✅ | keyed `main`,key `serial-story` |
| 面板内容 | ✅ | **只读工作台**:世界观树 + 资产视图(含修订号)+ 人物出场 + 正文预览(§6.11) |
| 读取项目状态 | ✅ | 走 `workspaceFiles` Remote,不再需要被上游阻塞的自建通道(§6.9) |
| 会话身份解析 | ✅ | 从 `useSessions` 的 `retainedBy.mainView` 取"主视图会话" —— 根作用域 `main` 面板的原生途径 |
| 浏览器侧修订号 | ✅ | WebCrypto 按整文件字节算 SHA-256,与 Host 的 `revisionOf` 逐字节一致(已用真实项目对账) |
| 面板内改稿 | ⛔ **刻意不做** | 浏览器侧不持 mutation RPC;改稿仍走会话里的原生审批 |
| "安装 Preset"交互按钮 | ⛔ 已删除 | 内联声明后不再需要安装步骤 |
| 主题一致性 | ✅ | 只用 `inherit`/`currentColor`/`color-mix`,无硬编码色值;未引入 `dsh-client-ui-primitives` |

### 4.6 工程与验证

| 项 | 状态 | 说明 |
|---|---|---|
| TypeScript 严格类型检查 | ✅ | `tsc --noEmit`,0 错误 |
| 构建链 | ✅ | `tsc` → `build-bundle.mjs` → `link-self.mjs` → `verify-built.mjs` |
| Client 打包器(带模块注册表) | ✅ | 每个源文件一个 factory + 依赖表,`require` 按表解析 |
| Client 契约断言(4 层) | ✅ | 注入精确为 `slots` + `remote` + `remote.workspaceFiles`、注册落点、组件是函数、组件返回合法 React 元素 |
| 面板真渲染断言 | ✅ | 不只调用函数:用 **SSR 真渲染一次**工作台面板。这条当场抓到过一个真 bug —— 包装里曾**直接调用**组件而不是 `createElement`,会让 hook 在非组件上执行,浏览器里必崩(§6.11) |
| 内联预设声明断言 | ✅ | 行存在、`config.id`/`name` 正确、挂载 `./agent`、不含 shell/通用文件/文本替换/Code Mode 工具;并用**目标运行时**导出的 `Config` 逐个校验子行配置(§6.5) |
| **准入声明断言** | ✅ | 直接调用目标运行时自己的 `evaluatePluginCompatibility(manifest, [])`(安装期 plugin-manager 与启动期 app-boot 共用这一个函数),断言**不需要任何 exemption** 就能装上并装载。这条守的是 0.2.0 版栽过的坑(§6.18) |
| 预设发现断言 | ✅ | 用**目标运行时自己的包**(cordis 4.0.5 + `dsh-tools` / `dsh-system-prompt` / `dsh-session-projection` / `dsh-agent` / 预设注册表)组一个与线上同构的 roster,断言:预设经注册表 `list()` 出现在花名册、`broken` 为空 |
| 预设子行解析对齐运行时 | ✅ | 0.2.1 起 dsh 子包全部上 npm,工作区 `node_modules` 就是用户机器上那一套,**不再需要两代运行时的影子 junction**(§6.18) |
| 单元/集成测试 | ✅ | **158 个**,见 §8 的表 |
| **keyless 快照测试** | ✅ | `tests/authoring-journey.spec.ts`:全程无模型、无 API key,用模型真正会用的工具层从零写完一集,快照钉住规范字节/修订号/审批决策/各投影(§6.14) |
| **发布资质脚本** | ✅ | `scripts/release-check.mjs`:一条命令跑完构建链 + 测试 + **打包面不变量**(exports 可解析、files 声明存在、keyless 快照必须先存在)。**真机浏览器冒烟仍不在范围内** —— 它需要固定提交的 Harness 源仓与 Chrome 控制 |

---

## 5. 里程碑

| 里程碑 | 内容 | 状态 |
|---|---|---|
| **M1** | Host 入口 + Client 面板 + 唯一的 Preset 文件 | ✅ 已完成 |
| **M2** | 项目文件层 + 两个工具真实实现 + 28 个测试 | ✅ 已完成 |
| **M3** | **让插件真的可用**:预设改为组合内联声明 | ✅ **已完成** |
| **M4** | 非权威提案收件箱(`serial_propose_change`) | ⬜ 待定设计 |
| **M5** | 浏览器侧项目浏览与编辑界面 | ⛔ 被上游阻塞 |
| **M6** | 批量跨集作业、跨集人物状态累计 | ⬜ 未开始 |

M3 交付内容:

1. `cordis.patch.yml` 内联声明 `preset-short-story-writer`(`@deepseek-ai/dsh-agent-preset`),`config.id = short-story-writer`,order 50。
2. **挂 V1 入口**(`@leeguanwei/dsh-serial-story/agent`,可写路径),按 §7 决定 2 的倾向:先让插件立刻可用,M4 再补收件箱。
3. 补上 `apply`(V1)缺失的 `installDedicatedPresetSurface`,使预设只继承 `serial_read` 与 `serial_apply_change`。
4. 删除失效的目录发布机制:`src/preset-installer.ts`、`scripts/install-preset.mjs`、`presets/`、`presetRoot` 配置,以及只为该机制存在的 `preset/status`、`preset/install` 端点。
5. 把预设内容从 rc.6 形态移植到 rc.2 形态(persona `text` → `prefix`;§6.5)。
6. `verify-built.mjs` 改为断言内联声明,并对齐目标运行时的 schema 与注册表。
7. 验证:`dsh --profile web --dump-config` 含该行;运行中 Host 的 `include:preset-short-story-writer` 为 `status: schema`;32 个测试通过。

**M3 之后的瓶颈**是 M5 依赖的上游 loopback 缺陷(§6.1):浏览器面板仍只能显示静态信息卡。

### 5.1 完整实现的推进顺序(逐步)

目标是把插件做到 M6 并收尾。已定的顺序与进度:

| 步 | 内容 | 状态 |
|---|---|---|
| 1 | 契约收尾:取消统一为原生 `AbortError`、删掉 4 个从未抛出的错误码 | ✅ 完成(§6.4) |
| 2 | M5 通道判定:Typert Remote 能否绕开上游缺陷 | ✅ 完成,结论是**能**(§6.9) |
| 3 | 领域模型扩容:世界观 schema + 故事线层 + 旧项目迁移 | ✅ 完成,且**不需要迁移**(§6.10) |
| 4 | M5a 浏览器侧只读工作台 | ✅ 完成(§6.11);浏览器内激活待实测 |
| 5 | M4 非权威提案收件箱 | ✅ 完成(§6.12);**落地路径未定**,见 §7 决定 7 |
| 6 | M6 跨集人物状态累计与批量跨集作业 | 🟡 **读侧完成**(巡检 + 编年史,§6.13);批量**写**侧待 §7 决定 7 |
| 7 | 发布资质:keyless 快照测试与发布脚本 | ✅ 完成(§6.14);真机浏览器冒烟不在范围内 |

**七步全部走完。** 剩下的不是计划内步骤,而是三个待你拍板的设计决定(§7 决定 7 / 8 / 9 / 10)与两类已知缺口:面板内改稿(刻意不做)、批量跨集**写**作业(取决于决定 7)。

已定的范围收缩:**工作台本期只读**,不在面板里改稿 —— 于是它不依赖 M4,可以直接做。

---

## 6. 已知缺陷与阻塞

### 6.1 上游:dsh 0.2.0-rc.2 的 loopback 回归 ⛔→🟢 0.2.1-rc.2 已消失

第三方插件注册 HTTP 通道时,`connection.rpc.handle` 与 `webServer.register` 会走到同一段嵌套 inject,而 `dsh-client-connection` 自身的 `inject` 列表是 `["credentials"]` 而非 `["webServer"]`,于是激活时报:

```
cannot get property "webServer" without inject
```

这是 dsh 自身的缺陷([上游讨论 #5926](https://github.com/deepseek-ai/deepseek-harness/discussions/5926)),不是本插件的代码问题。

**0.2.1-rc.2 的现状**:`dsh-client-connection` 仍声明 `inject = ["credentials"]`,但取 webserver 已改为可选查表 `this.owner.get("webServer")` / `this.ctx.get("webServer")`,那条注入断言不再触发。也就是说,现在**自己注册一条 HTTP 通道是可行的**。

**这仍然是设计选择而不是限制**:数据通道继续走 Typert Remote(`workspaceFiles`),理由不变 —— 它只读、以会话工作区为根、自带变更订阅(§6.9)。上游缺陷消失并不产生改用自建通道的理由;真要改,收益与代价见 §10 的 U-6。

### 6.9 M5 数据通道:M5a 不被上游阻塞(步 2 判定)

步 2 的结论:**M5a 可做,不需要上游修复,也不需要自己生成 Typert 半边。**

原因是 dsh 已经挂了一个现成的只读 Remote —— `workspaceFiles`(`@deepseek-ai/dsh-api-workspace-files`,本 profile 的 `workspace-files` 行),而它要读的正是"会话工作区里的文件",也就是 `.serial/`。

客户端调用惯用法(取自 dsh 自己的消费方 `@deepseek-ai/dsh-client-ui-sidebar-files`):

```js
export const inject = ['slots', 'remote', 'remote.workspaceFiles']

await ctx.remote.workspaceFiles.list(sessionId, '.serial', signal)                       // 目录项
await ctx.remote.workspaceFiles.read(sessionId, '.serial/characters.json', { limit }, signal)  // 有界文本页
await ctx.remote.workspaceFiles.stat(sessionId, '.serial/world.json', signal)            // version / bytes
ctx.remote.workspaceFiles.changes(sessionId, '.serial', lifetime)                        // 变更订阅
```

`remote` 服务由 `dsh-api-gateway` 的客户端半边提供(`super(ctx, "remote")`),并按命名空间注册子服务 `remote.<namespace>`(见其 `lib/client.js`)。

**为什么这是好选择,而不只是绕路**:

| 性质 | 对本插件的意义 |
|---|---|
| 服务**不暴露任何 mutation 操作** | 天然满足「浏览器侧不暴露 mutation RPC」(§2.2 决定 4) |
| 路径以**会话工作区根**为基准 | 面板只传 `.serial/characters.json` 这类相对路径,不携带宿主绝对路径 |
| `list` / `read` / `stat` | M5a 的浏览、资产视图、大小与 `version` 全都够用 |
| `changes`(文件变更订阅) | 模型写盘后面板可**自动刷新** —— 这条是免费拿到的 |
| 已随 profile 挂载 | 无需新装、无需改 profile |

**一处需要点头的偏离**:该服务的作用域键是 **`SessionId`**,不是 §2.2 与 `AGENTS.md` 里写的 `WorkspaceId`。面板本身是会话内的东西,用 `SessionId` 更自然,且约束的本意("不送路径、只送不透明 id")仍然成立 —— 但字面上确实不一致,记为一次细化,待确认。

**步 4 遗留的实现问题**:`main` 插槽是 **root 作用域**,而 Remote 需要会话身份。面板如何取得"当前会话"要在实现时解决(候选:客户端 `sessions` / `uiWorkspace` 服务,或改注册到会话作用域的插槽)。

### 6.2 自身:Preset 用了过时机制 ✅ 已修复(M3)

本项目原沿用姊妹插件 `dsh-ai-novel-writer` 的预设方案:随包发布 `presets/<dir>/` 目录,由 Host 拷贝到用户预设根目录,靠 dsh 扫描发现。

经核实,这套在 `0.2.0-rc.2` 上**不生效**:

1. `dsh-agent-preset-registry`(该版本的注册表)配置只有 `default` / `selectedDefault`,源码中**没有**目录扫描;
2. 带 `roots` / `includeUserRoot` 的 `@deepseek-ai/dsh-agent-presets` 在该组合里**未被挂载**;
3. 该版本的实际机制是**在组合里内联声明**:

```yaml
- insert:
    - id: preset-short-story-writer
      name: '@deepseek-ai/dsh-agent-preset'
      config:
        id: short-story-writer
        name: 短篇集作家
        order: 50
        plugins: [ ...预设自己的 entry 列表... ]
```

`PresetDefinition` 的字段为 `{ id, name?, description?, order?, plugins }`。

**修复(M3 已落地)**:`cordis.patch.yml` 内联声明预设;目录发布机制的全部产物(`src/preset-installer.ts`、`scripts/install-preset.mjs`、`presets/`、`presetRoot` 配置、`preset/status` 与 `preset/install` 端点)已删除。

### 6.3 环境:peer 版本不一致 ✅ 已解决(0.2.0)

插件曾声明 peer 为 `0.1.0-rc.6`,而运行时是 `0.2.0-rc.2`;`dsh` 拒绝安装并要求签发 exact-version exemption。根因是当时 dsh 子包**未发布到 npm**,工作区无法对齐。

**0.2.1 起子包全部上了 npm**(`@deepseek-ai/dsh-agent@0.2.1-rc.2` 等),于是:

1. 依赖线整体抬到 `0.2.1-rc.2`,工作区 `node_modules` 与用户机器上的运行时**同版本、同 schema**;
2. 准入由 `engines.dsh: ">=0.2.1-rc.2 <0.3.0-0"` 单独裁决(§6.18),不再走 peer 回退路径,因此**升版本号不再需要在 profile 里补豁免**;
3. `scripts/ensure-pnpm-junctions.mjs`、`scripts/link-dsh-fallback.mjs` 与 `tests/fixtures/node_modules` 影子目录**已删除** —— 它们只为"两代运行时并存"而存在。

> profile 里历史遗留的 `compatibility.json` 条目(键为 `…@0.1.0` / `…@0.1.1`)留着无害:豁免按 `包名@版本` 精确键控,新版本不会继承,也不需要它们。

### 6.4 一致性:取消的表示不统一 ✅ 已修(步 1)

原状态:`SerialProjectErrorCode` 声明 12 个码,其中 4 个**从未被抛出**,取消的表示也不统一。

**已定并落地**:取消**不进** `SerialProjectErrorCode`。项目层在每步文件系统工作前后调用 `signal.throwIfAborted()`,抛的是 harness 原生 `AbortError`(与 `TOOL_ABORTED` 那套终止语义同源);自行发明一个 `CANCELLED` 只会让调用方多一个必须判别的分支。其余 3 个码按各自的理由删除:

| 原码 | 处置 | 理由 |
|---|---|---|
| `ASSET_NOT_FOUND` | 删除 | 缺失的资产不是错误:非清单资产缺失返回 `revision: 'absent'` 的空资产,清单缺失返回 `NOT_INITIALIZED` |
| `UNSUPPORTED_FORMAT` | 删除 | 格式版本尚无第二种,没有抛出点 |
| `APPROVAL_REJECTED` | 删除 | 原生审批被拒发生在项目层之外,由 Harness 处理 |
| `CANCELLED` | 删除 | 见上;契约改由测试钉住 |

现存 8 个码全部真的会抛:`NOT_INITIALIZED` / `ALREADY_INITIALIZED` / `INVALID_CONTENT` / `PATH_REJECTED` / `SIZE_LIMIT_EXCEEDED` / `STALE_REVISION` / `WRITE_FAILED` / `NOT_IMPLEMENTED`。

契约不靠注释、靠断言:`tests/serial-project.spec.ts` 的「取消抛的是原生 AbortError,不是 SerialProjectError」用例会同时检查 `error.name === 'AbortError'` 与 `not.toBeInstanceOf(SerialProjectError)`。

> 注:loopback 信封另有一套小写码,其中 `'cancelled'` 属于信封自己(`src/index.ts`),与 `SerialProjectErrorCode` 无关。

### 6.5 环境:宿主包 schema 在 rc.6 与 rc.2 之间发生了破坏性变化 ✅ 已解决(0.2.0)

工作区 `node_modules/@deepseek-ai/*` 曾停留在 `0.1.0-rc.6` 线,而运行时是 `0.2.x`。这两条线的**插件配置 schema 并不兼容**,最典型的是 persona:

| 包 | rc.6 的 `Config` | 0.2 线的 `Config` |
|---|---|---|
| `@deepseek-ai/dsh-persona` | `{ text (required), complete, includeRuntimeContext }` | `{ prefix (required), suffix, complete, includeRuntimeContext }` |
| `@deepseek-ai/dsh-agent-instructions` | `{ maxBytes (required), … }` | `{ maxBytes (required), dshHome?, projectRootMarkers?, … }` |

内联预设里 `text:` 的写法在 rc.6 上合法、在 0.2 线上**激活即失败**。预设声明按目标运行时写(`prefix`)。

**0.2.0 的现状**:依赖线与运行时同为 `0.2.1-rc.2`,schema 只剩一套,这个坑从"每次升级都要小心"退化为"不可能踩"。`scripts/verify-built.mjs` 仍然逐行调用目标运行时导出的 `Config` 校验子行配置 —— 这条不是为了兼容旧版,而是为了在**下一次**版本漂移时立刻炸在构建期而不是用户界面上。

`@deepseek-ai/dsh-persona` 在 `0.2.1-rc.2` 上对 `prefix` 的实测:传 `{ text }` 报 `$.prefix missing required value`,传 `{ prefix }` 通过 —— 校验是真的在校验,不是空转。

### 6.6 陷阱:导入预设注册表的类型会破坏 Schemastery 注解 🟡

`@deepseek-ai/dsh-agent-preset-registry` 的类型入口会引入 Schemastery 的**全局增强**(`Mode` 增加 `volatile` 等),后果是本文件里所有 `export const Config: z<Config> = z.object({ … .default(x) })` 立刻报 `TS2322`(`SchemaOutput<number, …>` 变成 `number | Volatile<number>`)。

另外,该包的 `/types` 子路径虽然声明了 `agent-preset/selected` 事件,但它解析到的是**嵌套 dsh 自己的 `@deepseek-ai/cordis`/Schemastery 实例**,与工作区的不是同一个模块身份,所以增强既不生效、又带来上面那类破坏。

**应对**(`src/agent.ts`):

1. 用 `ctx.get('agentPresets')` + 本文件声明的 `DedicatedPresetRegistry` 结构化切片读取服务,不再导入注册表类型;
2. 自行 `declare module '@deepseek-ai/cordis'` 补一条 `agent-preset/selected` 事件声明。

两处的实际契约都已用 Host 的 `Service.listService` 逐个核对过。

### 6.7 自身:资产 schema 对模型不可见,导致只能盲猜 🟡→已修(M3 后)

首次真机试用暴露的问题:模型写世界观时按"世界设定集"的直觉试了 `id name type era logline theme rules glossary …`,全部被拒;写人物档案试了 `characters list 人物 档案`,同样被拒。

根因不在校验,而在**信息不可见**:

1. 七类资产的字段表只存在于 `src/serial-project.ts` 的 `parse*` 函数里,工具描述一个字都没提;
2. `rejectUnknownFields` 只报"含未知字段:x, y",不报**允许什么**;
3. `serial_read` 的 `world` 分支返回的是**投影**(`{characters, collections}`),**不含** `world.json` 的正文与修订号 —— 模型以为读了世界观,其实没读到,于是更没线索;
4. 最贵的一点:审批门在 `execute` **之前**无条件 `ask`。于是每一次格式猜错都要审批人点一次确认,点完之后才拿到错误。

**已修**:

- `serial_apply_change` 的描述里列出七类资产的完整顶层字段表(含 `chapter-draft` 是纯 Markdown 而非 JSON);
- `rejectUnknownFields` 报错附上允许字段:`世界观 含未知字段:id, name, type;该资产只接受这些字段:setting, locations, notes`;
- 必填字段缺失改为明确措辞:`setting 是必填字段,但缺失了`;
- `serialApprovalGate` 先跑一遍规范化校验:非法内容直接 `deny` 并回传原因,**审批不再弹出**;顺手补上 `canonicalSerialInitialization` 缺失的 `creativeStrategy` 枚举校验。

**产品问题已定并落地(步 3)**:模型试的 `era`/`rules`/`glossary` 一类字段确实是"世界观"该有的东西,所以按 §7 决定 4 把 schema 扩了 —— 见 §6.10。

**仍未处理的一类无用审批**:内容合法但 `baseRevision` 已过期时,审批**仍会弹出**,批准后才以 `STALE_REVISION` 失败。审批门目前只做内容规范化(纯计算),没有做 IO 去核对修订号。要消掉这一类,得让门读一次目标资产的当前修订号 —— 代价是给审批路径引入文件系统读取。见 §7 决定 6。

### 6.8 设计错配:人物出场只认蓝图,不认正文 🟡

用真实项目实测(`F:\Projects\serial-story`:5 人物 / 1 短篇集 / 5 章正文)发现:`serial_read` 的 `appearances` 对每个人物只返回一条 `{collectionSlug, chapter: 0}`。

`chapter: 0` 不是缺陷,是事实。`readAppearances` 的人物来源只有两处:

1. 短篇集蓝图的 `characterIds`(记为 `chapter: 0`);
2. 章节蓝图文件(`*-blueprint.json`)的 `characterIds`。

它**从不读章节正文**——`.md` 里没有结构化的人物 id,按名字回退匹配会引入误报。

后果是最自然的写作顺序(**先写正文、蓝图要么后补要么不写**)会让"某人物在某章出场"这个事实对插件完全不可见,跨集人物追踪只剩"集"的粒度。上述项目的 5 章正文因此一条都不参与 `appearances`。

**已落地(M3 后)**:按 §7 决定 5 选了"只认蓝图"这一侧,并把约束写进预设引导 —— persona 里新增一段:

> A chapter's blueprint comes BEFORE its draft: create the chapter-blueprint (with characterIds and povCharacterId) first, then write the chapter-draft. Appearance facts come only from collection blueprints and chapter blueprints; a draft never records who appears in it, so skipping the blueprint makes that character invisible to `serial_read kind="appearances"`.

下一步若要**回溯**已有项目(先把正文补上、蓝图后补是历史事实),那是另一件事:要么手写章节蓝图,要么接受这一集的出场粒度只到"集"。

### 6.10 领域模型扩容(步 3):世界观与故事线

**问题**。真机试用暴露两件事:世界观只有 `{setting, locations, notes}` 三个自由文本位,写作者只能把时代、机构、赛制、术语、写作铁律全塞进 `notes` 散文;而"故事线"这一层**完全不存在** —— 最接近的只有章节蓝图的 `keyBeats`(章内节拍,不跨章、不分线)。

用真实项目验证过这个缺口:`F:\Projects\serial-story` 那本《应援色》由 5 条人物限知视角的线钉在同一条共同时钟上,而 schema 里时钟只是一个扁平字符串数组 `timeline.keyDates`,5 条线只活在 `blueprint.summary` 的散文里。

**做法**。新增字段**一律可选**,于是扩容**不需要迁移**:老文件原样通过校验,只有下一次写入才把新字段物化成空值。这一点已用真实项目端到端验过 —— 三个资产的修订号在扩容前后**完全一致**(`world.json` = `5c5d4ad1bf17`、`characters.json` = `017a096e4d0d`)。

| 资产 | 新增(全部可选) | 语义 |
|---|---|---|
| `world.json` | `era`、`organizations`、`rules`、`glossary` | 世界内**事实**:时代、机构、世界如何运转、术语表 |
| `project.json` | `writingRules` | **创作方针**("我怎么写"),与上表刻意分开 |
| `collection-blueprint` | `threads: [{id, title, summary}]` | 该集声明的故事线 |
| `chapter-blueprint` | `threadIds` | 本章推进了哪几条线 |

**四条设计约束**:

1. **线不与集分离**。`threads` 属于短篇集,不提到世界观层 —— 否则"每集是独立作品"这条不变量会被跨集的线绑死。跨集连续性继续由人物稳定 id 承担。
2. **物化而非省略**。写入选中的可选字段一律落成空值。若省略,`era: ""` 与不带 `era` 会产出不同字节 ⇒ 不同修订号 ⇒ 假冲突。规范化必须幂等。
3. **`threadIds` 不校验存在性**,与 `characterIds` 的现有做法一致。悬空引用被故事线投影**忽略**,不会凭空造线(有测试钉住)。
4. **`advances` 只来自章节蓝图**,与 `appearances` 同一套来源规则 —— 正文不参与(§6.8)。

### 6.11 M5a:只读工作台(步 4)

**定位**。同一个 `.serial/` 项目的**人类侧**:预设是模型侧,工作台是人侧。两侧读同一批文件、守同一套 schema;工作台**不写**。

**三个前置问题与解法**:

1. **通道**。自建 HTTP 通道被上游缺陷堵住(§6.1),但 Typert Remote 是通的 —— 用现成的 `workspaceFiles`(`@deepseek-ai/dsh-api-workspace-files`),它只读、以会话工作区为根、本 profile 已挂载(§6.9)。
2. **会话身份**。`main` 插槽是 root 作用域,宿主 catalog 明说 *"other keys receive no Session binding"*。解法是用该插槽给的标准 prop `useSessions`,取 **`retainedBy.mainView > 0`** 的那个会话 —— dsh 自己的会话浏览器就是这么找"主视图会话"的。没有打开的会话时面板给明确提示,不猜。
3. **修订号**。工作台要显示与人/模型都能对上的修订号,而 `workspaceFiles` 只给文件 `version`(mtime 之类),不是本插件的 SHA-256。解法是在浏览器里用 WebCrypto 复刻 Host 的 `revisionOf`:**按整文件字节**(`readBytes`,含结尾换行)做 CRLF/CR→LF 归一化后取 SHA-256。已用真实项目对账,三个资产的修订号与 Host 逐字节一致。

**面板结构**(左树右详情):世界观树 → 项目 / 世界观设定 / 人物档案 / 各短篇集 → 章节;详情区按选中节点渲染,含 `world.json` 的一句话设定·地点·机构·规则·术语表、短篇集的出场人物与**故事线推进轨迹**、人物档案的整集/章级出场、章节正文预览。

**它刻意暴露的一件事**:左树对缺章节蓝图的章打「缺蓝图」记号,集详情也汇总"有 N 章缺蓝图"。因为这些章在 `appearances` 与故事线推进里**不存在**(§6.8) —— 把这件事画在界面上,比写在文档里更容易被发现。

**数据层可测**:`src/client/serial-files.ts` 不依赖 React 也不依赖浏览器,`tests/client-serial-files.spec.ts` 用内存文件树驱动它(12 项),包括"浏览器算的修订号 === Host 算的修订号"这条交叉验证。

> **未实测**:浏览器里的端到端激活。`verify-built.mjs` 现在会**真渲染一次**面板(SSR,不发 Remote 调用)以拦住 hook 顺序与空数据分支的崩溃,但那不等于它在浏览器里跑起来了 —— 注入的是 `slots` + `remote` + `remote.workspaceFiles`,`@deepseek-ai/dsh-api-workspace-files` 也已加入 `dsh.client.inject`,写法与 dsh 自己的 `dsh-client-ui-sidebar-files` 一致。**需要一次重启 dsh + 刷新页面**来确认。

**顺带修掉的两个契约 bug**:`serial_read kind="world"` 的 `slug` 参数此前被 schema 接受但**被读取路径完全忽略**(现在真的收窄);`limit` 参数被 schema 广告、却被解析器当多余字段拒绝(已删)。

### 6.12 M4:非权威提案收件箱(步 5)

**它是什么**。一条提案落盘之后,**项目本身一个字节都没变** —— 收据里的
`authoritative: false` 与 `status: "pending"` 就是这件事的机器表达。要真的改项目,仍然只能走 Harness 原生一次性审批。

**存储**(§7 决定 1 定的 JSON 而非 SQLite):`.serial/inbox/<时间戳>-<哈希8>.json`,一条一文件。理由是收件箱不需要复杂查询、条数被 `maxPendingProposals` 限死,而 `better-sqlite3` 是原生模块、有编译风险;顺带的好处是"人审阅"可以直接用文件管理器做。

**三条不变量**:

1. **身份由 Host 供给**。会话与调用身份由工具层从执行上下文(`exec.agent.id` / `exec.callId`)取,模型既不能提供也不能猜 —— 与预设 persona 里那句 "the Host records the session, call identity, and canonical argument hash" 对齐。
2. **规范化幂等键**。键是命令**效果**的规范 JSON 哈希,由项目层的同一套规范化函数先跑一遍,所以换排版重提不会造出第二条。
3. **建议必须先合法**。内容型命令(`initialize` / `replaceAsset` / `newCollection`)走的是与写入路径**完全同一套**校验,收件箱里不可能存在一条注定被拒的建议。

**幂等键的边界(踩过一次)**:键里**剥掉 `summary`**、但**保留 `baseRevision`**。

- 剥 `summary`:那是给人看的措辞,同一处改动换个说法不该排两条。
- 保留 `baseRevision`:它不是措辞而是并发令牌。若也剥掉,模型在文件变动后重提同样内容会命中既有条目,而该条目存着**旧的**令牌 —— 将来谁按它落盘都会撞 `STALE_REVISION`。宁可多一条,不可存下一条自相矛盾的建议。有测试钉住这两侧。

**已实测的端到端回路**(在真实项目的**副本**上跑,不动原件):

```
建议 1 收据  authoritative=false  status=pending  created=true
建议 2 收据  authoritative=false  status=pending  created=true
重复提交      created=false        proposalId 与首次相同      ← 幂等
蓝图修订号    建议前 3811ab391b1b / 建议后 3811ab391b1b  未变   ← 非权威
第 1 章蓝图   仍不存在(未被写入)
.serial/     characters.json, collections, inbox, project.json, world.json
面板快照     ready,待审阅提案 2 条,蓝图 storylines 仍为 null
```

**面板可见**。工作台左树新增「待审阅提案」节点,详情区逐条列出摘要、命令 kind、状态、id 与命令 JSON,并明确写着"以下都是建议:项目本身一个字节都没有改变"。未初始化的项目若已有 `initialize` 建议,面板也会指出来而不是只说"没有项目"。

> **未定**:提案如何变成一次真实写入(§7 决定 7)。这决定了 M4 是否端到端可用 —— 目前 `./agent-v2` 的预设还没挂,而挂上它也只有"只读 + 提议"两个工具。

### 6.13 M6:跨集巡检与编年史(步 6)

集一多,两件事就看不见了:**结构缺口**(哪一章漏了蓝图、哪条线引错了 id)与**人物的跨集轨迹**。这两个投影就是为此存在的,而且都是**只读派生视图** —— 不写任何文件。

**巡检 `kind="audit"`**。一次遍历报出全部结构问题,稳定码如下:

| 码 | 级别 | 含义 |
|---|---|---|
| `world.missing` / `characters.missing` | warning | 共享设定或人物档案缺失 |
| `collection.blueprint.missing` | warning | 有目录没蓝图 ⇒ 这一集不进世界投影 |
| `collection.timeline.missing` | warning | 没有时间锚 ⇒ 编年史只能把它列为"无时间锚" |
| `collection.chapters.missing` | warning | 这一集还没有任何章 |
| `chapter.blueprint.missing` | warning | **有正文没蓝图** ⇒ 这一章的出场与故事线推进都不会被记录(§6.8) |
| `chapter.draft.missing` | warning | 有蓝图没正文 |
| `character.undeclared` | error | 集或章蓝图引用了未在 `characters.json` 声明的人物 |
| `thread.undeclared` | error | 章节蓝图引用了本集未声明的故事线(会被投影忽略) |
| `thread.unadvanced` | warning | 声明了却没有任何一章推进过的线 |
| `character.unused` | warning | 建档了却没有任何集或章引用的人物 |

**它是报告而不是校验器**:发现问题不会让读取失败 —— 一份有缺口的手稿仍然应该能读。发现数受 `queryMatches` 限制并如实标记 `truncated`。

**编年史 `kind="chronicle"`**。对某个人物,列出它在哪些集、哪些章、以什么身份(整集 / 章级 / 视角)出现。两条底线:

1. **不发明顺序**。有时间锚(该集时间线的 `startDate`)的集按时间升序进 `ordered`;没有锚的进 `undated`。绝不按 slug 硬塞进时间线 —— "短篇集之间没有隐含顺序"这条不变量不能被一个投影偷偷推翻。同锚的集保持目录名顺序,不假装分先后。
2. **不发明状态**。没有任何 schema 字段记录"人物在这一集变成什么样",所以编年史只报告站点,不编状态。要真的累计人物状态,得先有承载它的作者字段 —— 见 §7 决定 9。

**顺带的结构收敛**。四个跨集投影(`appearances` / `threads` / `audit` / `chronicle`)原先各写一遍"遍历每一集、再看每一章的蓝图"。抽成 `loadWorldIndex` 之后不只是省 IO:章节的 `hasBlueprint` 与 `characterIds`/`threadIds` 绑在同一个结构里,**「没有蓝图 ⇒ 那两项必然为空」变成了结构性规则**,而不是一条要在四个地方各自记住的纪律。重构后既有 92 项测试全绿。

**真实项目实测**(只读):

```
=== 巡检:1 集 / 5 章,6 条发现 ===
 [warning] collection.timeline.missing  cheer-color     这一集没有时间线:编年史无法把它排进时间顺序
 [warning] chapter.blueprint.missing    cheer-color#1   有正文没有章节蓝图(§6.8)
 …                                                      #2 #3 #4 #5 同
=== 周听晚编年史 ===
 有时间锚: []
 无时间锚: [{ collectionSlug: "cheer-color", title: "应援色", chapters: [], pov: false, wholeCollection: true }]
```

即:那本书的 5 章正文**全部**缺蓝图,而编年史诚实地把它放进"无时间锚"而不是发明一个顺序。

**仍未做**:批量**写**作业(如跨集改名一个 `characterId`)。它需要 O(N) 次单资产审批,或把 N 条改动同时投进 M4 收件箱 —— 两者都取决于 §7 决定 7。"批量跨集"的**读**侧(上面两个投影)已可用。

### 6.14 发布资质(步 7)

**一条命令**:`node scripts/release-check.mjs`。它跑完构建链(junction → 类型检查 → 产出 → 客户端打包 → 自链接 → 产物契约校验)、跑完测试,再断言一批**测试查不到的打包面不变量**:

| 断言 | 为什么测试查不到 |
|---|---|
| 每个 `exports` 目标真实存在 | 源码里全绿也可能产出漏了一个文件;装上去 `import` 才炸 |
| `files[]` 里每个非通配条目存在 | 声明要发布却没有这个文件 = 对用户的失实陈述 |
| `README.md` / `LICENSE` 既存在又被声明 | 门面文件不能只躺在仓库里 |
| `dsh.bundle.patch` 指向的文件存在 | 拼错路径不会让任何测试变红 |
| `dsh.client` 声明了 `inject` 与 `platform` | 缺了它插件在浏览器里起不来 |
| manifest 具备发布元数据 | `name`/`version`/`description`/`license`/`repository`/`engines.node` |
| 没有遗留临时文件 | 工作过程容易留下 `.tmp*.mjs` |
| **keyless 快照文件必须已存在** | **最容易被忽略的一条**:快照缺失时 vitest 会**新建**它并判通过,漂移检测就被自己的检查步骤静默绕过了 |

最后一条是**致命且前置**的 —— 它在跑 vitest **之前**就退出。这不是洁癖:第一版把它写成"记一条待汇总的失败然后继续跑测试",结果 vitest 顺手把快照重建了,检查自己掩盖了问题。**反向对照**(藏起快照再跑)确认了这一点,也正是它逼出了现在的写法。

**keyless 快照测试**(`tests/authoring-journey.spec.ts`)。"keyless"指**全程没有模型**:不调 LLM、不需要 API key,用的是模型真正会用的那一层 —— `createSerialToolDefinitions()` 返回的 `serial_read` / `serial_apply_change` 加真实文件系统。它从零走完一集:

```
未初始化(读 → NOT_INITIALIZED)
  → initialize
  → world(含 era/organizations/rules/glossary)
  → characters
  → collection-blueprint(含 threads)
  → timeline
  → chapter-blueprint(含 threadIds)      ← 先蓝图
  → chapter-draft                        ← 后正文
  → world / asset / appearances / threads / audit / chronicle 六种投影
```

快照(`tests/__snapshots__/authoring-journey.spec.ts.snap`)钉住:项目文件树与字节数、每个资产的**规范字节**、七条写入收据(含修订号)、七次审批决策、以及六种投影的完整输出。任何一处序列化排版、修订号算法或投影形状漂移都会变红。

另有两侧钉子:**每一次合法写入都必须弹原生审批**(`ask`),而**非法内容必须被直接拒绝且不弹审批**(`deny`)—— 后者正是曾经白烧用户审批的那个缺陷。快照首次生成时也照样断言这两条,所以它不是一个"第一次必然通过"的空壳。

**不在范围内**:真机浏览器冒烟。它需要固定提交的 Harness 源仓与 Chrome 控制,本仓库没有;工作台的浏览器内激活因此在 README 里列为已知限制。

### 6.15 死代码与重复逻辑清理(步 8-A)

三处清理,全部有据可查:

**1. loopback 通道的储备是死代码,已删。** 早期为上游缺陷准备了一整套 HTTP 读端点"等修复后挂载"。但工作台最终走的是 dsh 原生的 Typert Remote(§6.9),那条路通且只读 —— 一条**永远不需要再挂载**的处理器就是死代码。删除:

| 文件 | 行数 | 说明 |
|---|---|---|
| `src/command-rpc.ts` | 92 | 读端点 + `applySerialChange` |
| `src/context-types.ts` | 43 | **loopback 专用的第二份 AssetRef 解析器**(错误信息都写着 "Loopback payload") |
| `src/index.ts` 里的 RPC 处理器 | 71 | `createSerialRpcHandler`、两组请求校验、诊断转发 |
| `tsdown.config.ts` | 5 | 空配置,只有一条注释;`package.json` 里 **0 次**引用 |

`index.ts` 从 154 行降到 83 行。`tsdown` 那条"为什么不用 tsdown"的说明**没有丢** —— 搬进了 `build-bundle.mjs` 的文件头,那才是它该待的地方(把注释伪装成配置文件是另一种死重)。

**2. Host 与浏览器各拼一遍路径 —— 已收敛。** 新增 `src/serial-layout.ts`(148 行)作为项目内**路径与文件名的唯一事实源**:目录名、文件名、章节号补零与解析、以及 `serialAssetPath`。两端各写一份字符串拼接,等于把"`chapters/0007-blueprint.json` 长什么样"这条知识存了两份 —— 任何一次改名都会让一侧静默失配:Host 写对了、面板什么都读不到,**还不报错,只显示空白**。

它必须**零运行时依赖**:Client 半边也引它,而 `./types.ts` 会牵出 `dsh-brand` / `dsh-llm` 这些只在 Host 侧存在的包,一旦成为打包外部依赖,插件在浏览器里就起不来。因此只做 `import type`,连异常都用原生 `RangeError`,由 Host 侧的 `relativePathOf` 翻译成稳定的 `INVALID_CONTENT` / `PATH_REJECTED`。客户端打包模块数 4 → 5,`verify-built` 确认没有引入任何意外外部依赖。

`tests/serial-layout.spec.ts`(10 项)直接钉住这个模块,重点是 **`chapterSegment` 与 `chapterNumberOf` 必须互逆** —— 它们不互逆时不会报错,只会让面板显示空白。当前 **115 个测试**。

**3. 构建不清产出目录 —— 已修,并加了能抓住它的不变量。** `tsc` **不会**删除源文件已消失的产物:`command-rpc.ts` 删掉后,`lib/command-rpc.js` 仍然留在盘上,而 `package.json` 的 `files` 声明了 `lib/**` —— 于是死代码照样会被**发布出去**。`verify-built` 抓不到(它只校验声明的入口,不会去发现多出来的文件)。新增 `scripts/clean-lib.mjs` 并接进 `build` / `bundle` / `release-check`,再加一条不变量:**每个产出的 `.js` 都必须有对应的 `.ts`/`.tsx`**。

> 这条不变量写完第一次运行就抓到了**它自己的 bug**:`.tsx` 源文件被按 `.ts` 查,于是两个客户端视图被判成"陈旧产物"。已修。

发布资质检查项 **28 → 40**。当前 **119 个测试**。

### 6.16 工作台:自动刷新与正文渲染(步 8-B)

**1. 文件变更订阅(自动刷新)。** 写盘的是**会话里的模型**,读盘的是**面板**——两者是同
一个目录的两侧。在此之前模型刚写完的稿子不会出现在界面上,除非用户自己去刷新。

这条通道**不是直接可用的**:`workspaceFiles.changes` 只是"一代物理流",断线不会自己重开,
必须交给 `remote.$stream` 的重连监督器包裹。我没有自己发明协议,而是**逐条移植**了 dsh
自己的一方面板(`dsh-client-ui-sidebar-files` 的 `createWatch`):

```
remote.$stream({
  name: `serial project ${path}`,
  open: lifetime => remote.workspaceFiles.changes(sessionId, path, lifetime),
  ended: () => new Error(...),
})
→ 收到 kind === 'ready' 就 item.accept()(标记这一代健康,重置重连退避)
→ 其余 kind 只表示"有变化":面板重新读一遍整个项目快照
→ 中止 / 提前 break 都要 await stream.dispose()
```

**只关心"有变化",不关心变了什么**:重新读整个项目最简单,也最不容易漏掉跨文件的影响
(改一个 `characterId` 会同时牵动蓝图与章节)。快照本身是有界的。

`tests/client-change-watch.spec.ts`(4 项)用**脚本化的 Remote 面**驱动它 —— dsh 自己的
change feed 也是这么测的。钉住的是协议行为:`ready` 要 `accept`、中止要 `dispose`、提前
结束也要 `dispose`、已中止时不建流。

> 写这个替身时踩了两个坑,都是替身的错而不是实现的错:①`dispose()` 只记日志、没有真正
> **结束**那条流,于是消费者的 `for await` 永远等下一帧,测试挂 5 秒超时;②替身把
> `changes` 产出的裸通知与 `$stream` 包装后的条目**混成了一层**——真实分层是前者产出通知、
> 后者加 `accept`,类型检查当场指出了这一点。

**2. 正文 Markdown 渲染。** 之前正文是 `<pre>` 纯文本,`# 开场` 不会变成标题。现在渲染
标题 / 段落 / 列表 / 引用 / 围栏代码 / 分隔线,行内支持粗体、斜体、行内代码与链接。

解析器是**自写的受控子集**(`src/client/markdown.ts`),不引第三方,理由有三:解析是**纯
函数**(因此能在没有浏览器的环境里被 18 项测试完整钉住)、不引入新的打包依赖、以及
**不透传原始 HTML**(正文是模型写的,`<script>` 只会原样显示成文字)。

两个与中文写作有关的取舍:

- **段落内的换行原样保留**。标准 Markdown 会把段内换行折成空格,那在中文里会凭空插入空格。
- **刻意不支持**原始 HTML、表格、脚注、嵌套列表。不实现比实现一半更诚实。

**验证边界(必须说清)**:以上两项的正确性里,能自动验证的部分已经验证——协议行为有
测试、解析语义有测试、面板能在 `verify-built` 里被 SSR 真渲染一次(这条当场抓到过"直接
调用组件"那种必崩写法)。但**它们在真实浏览器里的样子没有被验证过**:本环境没有浏览器
控制,按 harness 的验证要求,不拿模拟 DOM 或假截图冒充视觉验证。所以"订阅真的收到了宿主的
文件变更""排版看起来对不对"仍待人工确认。

### 6.17 巡检进面板与整集导出(步 8-B2 / 8-C)

**1. 巡检搬进面板——判定收敛成一个纯函数。**

巡检有两个调用方:Host 侧 `serial_read kind="audit"`(给模型)与面板(给人)。两个调用方
各自实现一遍,就等于把十条稳定码的判定规则存了两份 —— 迟早出现"模型说没问题、面板说有
问题",而**两边都不算错**。

所以判定被抽成 `src/serial-audit.ts` 里的纯函数 `auditWorld(input, limit)`:Host 与面板各自
把数据凑成同一个 `SerialAuditInput`(一个有文件系统、一个有 Remote),判定本身只有一份。
这个模块与共享布局一样必须**零运行时依赖**(面板那一侧要引它)。

面板左树新增「跨集巡检」节点,徽标显示 `错误 N · 警告 M`,详情区逐条列出级别、稳定码、
位置与说明,并写明"这是**报告**不是校验器"。

**最有价值的一条测试**因此不是"两边各自对不对",而是**把同一个真实项目同时喂给两条路径**,
断言结论逐条相同(`tests/audit-parity.spec.ts`)。它覆盖的正是唯一可能分歧的地方:**输入是
怎么凑出来的**。若面板漏掉一个字段(例如 `hasTimeline` 或 `povCharacterId`),两边结论就会
不一致 —— 而那种 bug 极难发现。夹具因此刻意造出**每一类**缺口,并逐类点名,避免"两边都漏
同一个字段"造成的假一致。

**2. 整集导出——一个操作,两个调用方。**

`user-actions.md` 给了明确结构:插件的操作要暴露给模型,且**逻辑只写一次**。所以:

| | 调用方 |
|---|---|
| `serial_read kind="export"` | 模型(只读、有界,与其它读取一样受 `assetBytes` 限制并标 `truncated`) |
| 面板「导出整集」节点 | 人(显示完整文稿 + 下载按钮) |

两者都调 `src/serial-export.ts` 的纯函数 `assembleCollectionMarkdown` —— 所以"模型读到的
整集"与"人下载到的整集"必然逐字节相同。该函数**刻意不写时间戳**:否则同一集两次导出字节
不同,快照钉不住,人也没法判断两份导出是否真的不同。

**真实项目暴露的一个结构问题(值得记)。** 在你那本书上跑导出得到 5 章 / 50KB,但骨架是:

```
# 应援色
## 第 1 章
# 暮山紫          ← 作者的章标题,比注入的章标题**还大一级**
```

你的每章正文自带 `# 暮山紫` 这样的 H1,而注入的 `## 第 1 章` 比它小 —— 导出文档里出现
"更小的标题下面套着更大的标题"。这是我该在导出里处理的结构问题,不是让你回去改稿。改成:

- 正文**自带标题**时:整体下沉到 `##` 之下,**且不再注入**重复的章定位(作者已经写了章名);
- 正文**没有标题**时:注入 `## 第 N 章 …` 作为定位;
- 正文**缺失**时:保留注入的标题并标出缺失 —— 静默丢章会让导出看起来比实际完整;
- 下沉只改井号个数,**散文一个字节都不动**,并且跳过围栏代码(代码里的 `#` 是注释)。

改完后同一本书的骨架是:

```
# 应援色
## 暮山紫
## 石榴红
## 海盐蓝
## 银白
## 蜜柚橙
```

**下载是浏览器本地动作**:走 Blob + 临时 `<a download>`,不发任何 Host 请求、不写项目;
并且做了完整的能力探测 —— 没有 `document` / `URL.createObjectURL` 或任何一步抛错时只是
下载不了,文稿仍显示在上面可直接选取复制。绝不为了一个便利功能让面板崩掉。

### 6.18 运行时适配 0.2.0 → 0.2.1-rc.2:两个闸门与一次静默消失(步 9)

这一节是本版**唯一**的功能外改动,记录的是"插件为什么在 0.2.1 上装不上/不出现"。

#### 两个**不同**的闸门

dsh 对第三方 bundle 有两道独立的准入判定,判据来源不同,症状也不同:

| 闸门 | 位置 | 判据 | 失败症状 |
|---|---|---|---|
| **安装期** | `dsh-plugin-manager` 的 pnpm 预检 | `evaluatePluginCompatibility(manifest, exemptions)` | 命令直接失败:`installation rejected: Plugin … is incompatible with dsh …` |
| **启动期** | `dsh-app-boot` 装载 bundle 层 | 同一个函数 | bundle 被**静默跳过**,只进 `skippedBundles`,界面无任何提示 |

两者共用一个函数,而它的规则是:

```js
// 有 engines.dsh 时由它单独裁决,peerDependencies 一律忽略
if (Object.hasOwn(engines, "dsh")) return satisfies(runtimeVersion, engines.dsh) ? {} : { "engines.dsh": engines.dsh }
// 否则退化为:每个 @deepseek-ai/dsh / @deepseek-ai/dsh-* peer 都必须满足
```

`satisfies()` 用 `{ includePrerelease: true }` —— 少了这个选项,rc 版本永远匹配不上
自己的范围。**关键点:没有 `engines.dsh` 时,peer 会被当成"DSH 版本要求"来读。**

#### 0.1.1 在 0.2.1-rc.2 上的确切故障

`0.1.1` 的 peer 全是 `0.1.0-rc.6`(那是当时唯一能装到的线),且**没有 `engines.dsh`**,
于是走 peer 回退路径:

```
@deepseek-ai/dsh-agent@0.1.0-rc.6 ← 运行时 0.2.1-rc.2 不满足(共 16 条全部 unmet)
⇒ 整层 bundle 被跳过 ⇒ 侧栏没有「短篇集工作台」,预设列表里没有「短篇集作家」
```

profile 里那条 `…@0.1.1: ["0.2.0-rc.2"]` 的豁免**救不了它**:豁免按"包名@版本 + 精确
DSH 版本"双键控,DSH 从 0.2.0-rc.2 升到 0.2.1-rc.2 就不再继承。

用目标运行时自己的评估器实测(`dsh-app-boot@0.2.1-rc.2`):

| manifest | 结果 |
|---|---|
| 0.1.1 形态(peer `0.1.0-rc.6`,无 `engines.dsh`) | `{"requirements":{"@deepseek-ai/dsh-agent":"0.1.0-rc.6"},"exempted":false}` |
| 0.2.0 形态(`engines.dsh: ">=0.2.1-rc.2 <0.3.0-0"`) | `undefined`(接受,且不需要豁免) |

#### 修法:让 `engines.dsh` 单独裁决

```json
"engines": { "node": "^22.19 || >=24", "dsh": ">=0.2.1-rc.2 <0.3.0-0" }
```

上界写成 `<0.3.0-0` 而不是 `<0.3.0`:在 `includePrerelease` 下,`<0.3.0` 会把
`0.3.0-rc.1` 也放进来。实测:

| 版本 | `>=0.2.1-rc.2 <0.3.0-0` |
|---|---|
| `0.2.1-rc.2` / `0.2.1-rc.3` / `0.2.2` | ✅ |
| `0.3.0-rc.1` / `0.3.0` / `1.0.0` | ❌ |
| `0.2.0-rc.2` | ❌ —— 刻意:那一版配的是 0.1.0-rc.6 子包,本版没在上面验过 |

peer 也改用同一区间:有了 `engines.dsh` 后它们不参与裁决,只作为"这版验证过哪条线"的
文档,同时让 pnpm 的 peer 解析保持诚实。

#### 同时清掉的三处"两代运行时"脚手架

| 删除项 | 原用途 | 为什么可以删 |
|---|---|---|
| `scripts/ensure-pnpm-junctions.mjs` | 把伞包嵌套树里的 rc.2 子包提升成工作区 junction | 子包已上 npm,`pnpm install` 直接装到 |
| `scripts/link-dsh-fallback.mjs` | 把全局 dsh 安装链进工作区 | 同上 |
| `tests/fixtures/node_modules` 影子 | 让 fixture 解析到运行时副本而非工作区副本 | 只剩一套,影子没有第二份可指 |

`scripts/verify-built.mjs` 的 `runtimeRoot` 也随之从"伞包嵌套树"改成普通
`node_modules/@deepseek-ai`:校验用的就是用户机器上跑的同一套包。

#### 顺带确认的两件事

1. **`dsh.client.inject` 必须是空数组**。它只为**动态**客户端包排激活顺序,而本插件的
   bundle 只向宿主的静态模块表要 `react`。0.1.1 里列的
   `@deepseek-ai/dsh-client-runtime` 在 0.2.1 上**根本不存在**(该包已更名为
   `dsh-client-modules`,且不再是客户端运行时),列着它就是"声明一个缺失提供方"。
2. **槽位契约没变**。`sidebar.panellist`(list:`id`/`order`/`label`)与 `main`
   (keyed:`key`)在 0.2.1-rc.2 仍然成立,`remote.workspaceFiles` 与 `remote.$stream`
   也仍在。所以面板代码一行没改 —— 变的只是"能不能被装载"。

---

## 7. 未决设计决定

| # | 决定 | 选项 | 倾向 |
|---|---|---|---|
| 1 | 提案收件箱的存储 | JSON 文件 / SQLite | **已定并落地(步 5)**:JSON,`.serial/inbox/<时间戳>-<哈希8>.json` 一条一文件(§6.12) |
| 2 | 先交付哪条写入路径 | V1 原生审批(已实现,今天可用)/ V2 提案收件箱(需先建 M4) | **已定**:先 V1(M3 已按此挂载);M4 的收件箱已建好,但接线见决定 7 |
| 3 | 跨集人物状态累计的形态 | 独立投影 / 存入人物档案 | **已定并落地(步 6)**:**独立投影** —— 编年史从既有蓝图与时间线派生,不往人物档案里写任何派生值(§6.13) |
| 4 | 世界观 schema 的容量 | 保持三字段 / 扩成设定集 | **已定并落地(步 3)**:扩成 `era` + `organizations` + `rules` + `glossary` + `project.writingRules`。因为新字段全部可选,这次扩容**不需要迁移**(§6.10) |
| 5 | 出场事实的来源 | 只认章节蓝图 / 增设正文回退 | **已定:只认蓝图**,并把"先蓝图后正文"写进预设引导(§6.8) |
| 6 | 审批门要不要核对修订号 | 只做内容校验(现状)/ 读一次当前修订号 | **未定**;做了能消掉"内容合法但修订号过期"的无用审批,代价是给审批路径引入 IO(§6.7 末) |
| 7 | 提案如何变成一次写入 | ① V2 入口增设审批门控的"落实提案"工具 ② 另开一个提案模式预设,落实时切回 V1 预设 ③ 只让人在会话里照着提案手动重提 | **未定**;这决定 M4 是否端到端可用。倾向 ①:写入仍走原生一次性审批,模型无法单方面落实,而用户不必切预设(§6.12 末) |
| 8 | `./agent-v2` 要不要挂进预设 | 挂成第二个预设(提案模式)/ 暂不挂 | **未定**,与决定 7 绑定:若选 ①,挂上 V2 才有意义;若选 ③,V2 只是给人看的草稿箱 |
| 9 | 人物状态转移要不要成为作者字段 | 保持无状态(现状)/ 在人物档案加 `states` 或在集蓝图加人物状态 / 新增独立资产 | **未定**;§6.13 的编年史只能报告"在哪一集出现",不能报告"在这一集变成了什么样" —— 后者是作者事实,目前 schema 里没有位置。加字段是又一次 schema 变更,需要先想清"状态"与"集"的绑定方式 |
| 10 | 批量跨集写入的形态 | O(N) 次单资产审批 / 一次投 N 条提案进收件箱 / 新增多资产原子写入 | **倾向:投 N 条提案**。多资产原子写入会打破"单文件原子替换"这条不变量;而 N 次审批会让用户点到手软(§6.13 末) |

---

## 8. 验证现状

```sh
# 类型检查
node node_modules/typescript/lib/tsc.js --noEmit -p tsconfig.json     # 0 错误

# 构建链(不再有 junction 步骤:0.2.1 起 dsh 子包全部可从 npm 安装)
node scripts/clean-lib.mjs
node node_modules/typescript/lib/tsc.js -p tsconfig.build.json        # 按文件产出 ESM + 声明
node scripts/build-bundle.mjs                                          # 9 个客户端模块 → CJS 工厂包
node scripts/link-self.mjs
node scripts/verify-built.mjs                                          # 准入 + Host 装载 + 内联预设(含运行时 schema 校验) + 注册表发现 + Client 契约 + 面板 SSR 真渲染

# 测试
node node_modules/vitest/vitest.mjs run                                # 158 passed

# 一条命令跑完上述全部 + 打包面不变量
node scripts/release-check.mjs                                         # 51 项检查

# 组合层验证(profile 需已装本包)
dsh --profile web --dump-config | Select-String "preset-short-story-writer"
```

| 测试文件 | 用例数 | 覆盖 |
|---|---|---|
| `tests/serial-project.spec.ts` | 36 | 未初始化、初始化幂等、修订号并发、规范化幂等(**同语义不同排版 ⇒ 同修订号**)、路径穿越、未知字段(**含报错列出允许字段**)、必填字段缺失文案、`creativeStrategy` 枚举、大小上限、正文 LF 归一化、章节号补零、`world`/`appearances` 投影、缺失资产、取消(**含 AbortError 契约**)、损坏字节;以及步 3 扩容的 15 项:旧字节免迁移、世界观新字段、物化空值、`writingRules`、`worldId` 不可变、故事线投影、悬空 `threadIds`、投影收窄 |
| `tests/proposal-inbox.spec.ts` | 22 | 收件箱:**收据非权威**、**项目一个字节没变**、身份由 Host 落盘、幂等(含"换排版同键"与"换 baseRevision 不同键"两侧)、条数与字节上限、建议必须先合法、坏字节稳定失败、项目状态守卫、摘要;**以及走真实 V2 工具的端到端**(提议→读回→幂等→未初始化只收 initialize) |
| `tests/client-serial-files.spec.ts` | 16 | 工作台数据层:**浏览器修订号 === Host 修订号**、CRLF/CR 归一化、路径补零、宽容的 JSON 读取、故事线推进轨迹、悬空 `threadIds`、人物整集/章级出场、`absent` 与加载不中断、**不读正文**、**待审阅提案的只读视图**(含坏提案文件不拖垮面板) |
| `tests/cross-collection.spec.ts` | 11 | 跨集巡检:十种稳定码各就各位、**只报告不改文件**、缺时间线被点名、受 `queryMatches` 限并标截断;人物编年史:**有锚按时间排序 / 没锚单独列出**、章号与视角标记、整集声明但章级为空、没出现过的人物两栏皆空、缺人物档案仍可读 |
| `tests/agent-tools.spec.ts` | 11 | 参数解析拒绝矩阵、初始化→读取→替换端到端、审批卡片与实际落盘一致 |
| `tests/agent-surface.spec.ts` | 7 | V1 工具面收窄(允许集合、不碰其它 preset、拒绝未允许工具)、审批门(**合法才 ask;非法与形状错误直接 deny**)|
| `tests/authoring-journey.spec.ts` | 2 | **keyless 端到端快照**:从零写完一集(七次写入 + 六种投影),快照钉住规范字节/修订号/审批决策/投影形状;外加"手改坏的资产以 `INVALID_CONTENT` 失败"(§6.14) |
| `tests/serial-layout.spec.ts` | 10 | 共享布局:**章节号与文件名互逆**、非法章节号抛 `RangeError`、路径全在项目命名空间下、`serialAssetPath` 与逐个路径函数一致、只用 POSIX 分隔符(§6.15) |
| `tests/client-markdown.spec.ts` | 18 | 迷你 Markdown:标题级数、**段内换行保留**、列表分型与相邻不合并、引用、围栏(含未闭合)、分隔线、行内四类、孤立星号不算斜体、**HTML 不透传**(§6.16) |
| `tests/client-change-watch.spec.ts` | 4 | 变更订阅协议:`ready` 要 `accept`、中止与提前 `break` 都要 `dispose`、已中止时不建流(§6.16) |
| `tests/audit-parity.spec.ts` | 3 | **两端巡检逐条一致**:同一个真实项目同时喂给 Host 与面板两条路径;夹具刻意造出**每一类**缺口并逐类点名,避免"两边都漏同一字段"的假一致(§6.17) |
| `tests/serial-export.spec.ts` | 15 | 整集装配:集名/题记/章序、缺正文不静默丢章、CRLF 归一化、无时间戳因而确定性、**标题层级归一化**(自带标题时下沉且不注入重复章标题、围栏内井号不算标题、最深不超 6 级)(§6.17) |

### 8.1 实测证据

**0.2.0(运行时 `dsh 0.2.1-rc.2`)**——用目标运行时自己的评估器与包验证:

| 观测点 | 结果 |
|---|---|
| `evaluatePluginCompatibility(manifest, [])`(`dsh-app-boot@0.2.1-rc.2`) | `undefined` —— 无需 any exemption |
| 同上,喂 0.1.1 形态的 manifest | 拒绝:`requirements: {"@deepseek-ai/dsh-agent":"0.1.0-rc.6"}` |
| 与线上同构 roster(Cordis 4.0.5 + `dsh-tools`/`dsh-system-prompt`/`dsh-session-projection`/`dsh-agent`/`dsh-agent-preset-registry` 全部 `0.2.1-rc.2`) | 预设 `short-story-writer` 出现在 `agentPresets.list()`,**无 `broken`** |
| 预设子行 `Config` 逐个校验(persona / agent-instructions / 本插件 `./agent`) | 全部通过;persona 传 `{ text }` 会报 `$.prefix missing required value` |
| `pnpm install` 后的依赖树 | 83 个 `@deepseek-ai/*` 依赖与伞包声明**零偏差**,无跨版本 junction |
| `release-check` | 51 项检查通过,158 passed |

**0.1.x 时代(M3,运行时 `dsh 0.2.0-rc.2`)**——历史记录,仅供对照:

| 观测点 | 结果 |
|---|---|
| `dsh --profile web --dump-config` | 输出 `preset-short-story-writer` 行,插件列表含 `@leeguanwei/dsh-serial-story/agent` |
| 运行中 Host 的 `Config.listConfigs` | `include:preset-short-story-writer` → `status: schema` |
| 与线上同构 roster 的 `agentPresets.list()` | `[{ id: "short-story-writer", name: "短篇集作家", order: 50 }]`,**无 `broken`** |
| 同一 roster 的 `compositionInventory()` | `persona` / `agent-instructions` / `serial-agent` 三行 `fiberState: 2`(ACTIVE) |

> **仍未验证**:在真实会话里选中「短篇集作家」后,模型工具目录的确切内容(工具面收窄的端到端表现)。这需要真的开一个会话并选中该预设。
> **0.2.1-rc.2 上的安装只能在桌面应用的「设置 → 插件」里做**:`desktop` profile 由 Electron 应用独占管理,`dsh plugin --profile desktop …` 会直接拒绝(`profile "desktop" is managed exclusively by the Electron application`)。

> **环境提示**:本机 `pnpm run <script>` 会先触发依赖同步,该步骤在当前 profile 下会失败(需把已有 `node_modules` 目录 rename 为 `.ignored`)。因此上述命令均直接调用,不经 `pnpm run`。

### 8.2 改什么需要重启 dsh

本 profile 的 `hmr` 行实测为:

```yaml
- id: hmr
  name: '@deepseek-ai/dsh-hmr'
  config:
    root: []          # 只保留显式配置监听,不监听模块源码
```

`dsh-hmr` 的文档:`root` 默认 `["."]`;`[]` **retains only explicit configuration watches**。落到本插件:

| 改什么 | 生效方式 |
|---|---|
| `lib/*.js`(工具描述、校验逻辑、错误文案、审批门) | **必须重启 dsh**。HMR 不监听模块源码,Node 又按 URL 缓存 ESM;预设定义"注册即挂载一次",新会话也只是加入已有修订,不会重新 import |
| `cordis.patch.yml`(预设插件列表、persona 文案、config) | 组合层一致;但**包内** patch 不属于 HMR 注册的"user patch watches"(那两条是 profile patch 与 home patch),所以保守起见也按"需要重启"处理 |

**判断运行中的 Host 是否已含最新代码**(不用猜):

```sh
# 监听 3080 的进程启动时间
Get-NetTCPConnection -LocalPort 3080 -State Listen | Get-Process | Select-Object Id, StartTime
# 与构建产物时间比较
Get-ChildItem lib -Recurse -File | Sort-Object LastWriteTime -Descending | Select-Object -First 1
```

启动时间晚于产物时间 ⇒ 该进程已是最新代码。

---

## 9. 文件索引

| 路径 | 职责 |
|---|---|
| `src/index.ts` | Host 入口;开关注册;公共导出 |
| `src/serial-project.ts` | 项目文件层(核心) |
| `src/types.ts` | 领域类型与稳定错误码 |
| `src/agent.ts` | 两套工具定义 + 审批门 + 审批卡片 |
| `src/agent-v2.ts` | V2 入口(注入 Workspace registry) |
| `src/proposal-inbox.ts` | 非权威提案收件箱:JSON 存储、规范化幂等键、上传边界(**不写项目**) |
| `src/client/index.ts` | Client 插件:`inject: ['slots','remote','remote.workspaceFiles']` + 两处注册 + Remote 绑定 |
| `src/client/serial-files.ts` | 只读数据层:`workspaceFiles` Remote 包装、项目快照、故事线推进与人物出场(无 React 依赖) |
| `src/client/workbench-view.tsx` | 只读工作台面板:世界观树 + 资产视图 + 正文预览 |
| `src/client/panel-icon.tsx` | 侧栏图标(只用主题继承色) |
| `cordis.patch.yml` | 组合补丁:Host 行 + **内联预设声明**(M3) |
| `scripts/build-bundle.mjs` | Client 迷你打包器(带依赖表) |
| `scripts/verify-built.mjs` | 构建产物契约校验:**准入判定**(直接调运行时自己的 `evaluatePluginCompatibility`)+ Client 4 层 + **面板 SSR 真渲染** + 内联预设声明 + 运行时 schema + 注册表发现 |
| `scripts/rebuild.mjs` | 不经 `pnpm run` 的端到端构建包装 |
| `scripts/link-self.mjs` | 把工作区根暴露为 `@leeguanwei/dsh-serial-story` |
| `tests/agent-surface.spec.ts` | V1 工具面收窄与审批门的单元测试 |
| `tests/client-serial-files.spec.ts` | 工作台数据层:修订号对齐、故事线、人物出场、宽容加载 |
| `tests/proposal-inbox.spec.ts` | 收件箱:非权威、幂等、边界、项目状态守卫、V2 工具端到端 |
| `tests/cross-collection.spec.ts` | 跨集巡检与人物编年史 |
| `tests/authoring-journey.spec.ts` | keyless 端到端快照(从零写完一集) |
| `tests/serial-layout.spec.ts` | 共享布局:路径与章节命名的唯一事实源 |
| `tests/client-markdown.spec.ts` | 迷你 Markdown 解析器(纯函数) |
| `tests/client-change-watch.spec.ts` | 文件变更订阅协议(脚本化 Remote) |
| `tests/audit-parity.spec.ts` | 两端巡检一致性(真实项目 + 每一类缺口) |
| `tests/serial-export.spec.ts` | 整集装配与标题层级归一化 |
| `src/serial-audit.ts` | 跨集巡检的**纯判定**,Host 与面板共用同一份 |
| `src/serial-export.ts` | 整集装配的**纯函数**,模型导出与面板下载共用同一份 |
| `src/serial-layout.ts` | 项目内路径与文件名的**唯一事实源**,Host 与 Client 共用;必须零运行时依赖 |
| `scripts/clean-lib.mjs` | 构建前清空 `lib/`,否则已删源文件的产物会被发布 |
| `scripts/release-check.mjs` | 发布资质:构建链 + 测试 + 打包面不变量 |
| `tests/__snapshots__/` | keyless 快照(必须保留;缺失会让漂移检测失效) |
| `README.md` | 包的门面文档:定位、四条设计决定、文件布局、工具面、工作台、已知限制 |
| `docs/features-and-progress.md` | 本文件 |

---

## 10. 升级候选:0.2.1-rc.2 解锁了什么

判定前提:**能升级,而且不是因为"想加功能",而是因为宿主换了一条线,给了以前做不了的三个东西**。
已经用掉的宿主能力是:工具注册、原生一次性审批、预设内联声明、`sidebar.panellist` + `main`
槽位、Typert Remote 只读文件、文件变更订阅。**可用但没用**的、且对"写短篇集"有直接价值的,
收敛成 6 条候选。每条都写清"解决谁的什么问题",以及**是否动那四条设计决定**。

排期只是建议:**U-1 + U-4 是性价比最高的一对**,U-2 需要你先拍板改一条硬约束。

### 10.1 三条还不算功能的"解锁"

| 解锁 | 前一版为什么做不了 | 影响哪条候选 |
|---|---|---|
| **子包全部上 npm** | `0.2.0-rc.2` 的子包没发布,只能靠伞包嵌套树 + junction 凑 | U-5 / U-6(要挂 `dsh-tool-subagent`、`dsh-skill` 这类新依赖时,不再需要影子目录) |
| **`connection.rpc.handle` 的注入断言消失** | 注册 HTTP 通道必崩(§6.1) | U-2 的 B 方案(若真要走浏览器写端点,技术上是通的;但那要动硬约束) |
| **`engines.dsh` 成为独立裁决** | peer 被当版本要求读,升版本就得补豁免(§6.18) | 所有候选:以后每抬一次线不需要再求豁免 |

### 10.2 六条候选

#### U-1 斜杠命令:`/audit` `/export` `/chronicle`

- **解决什么**:现在这三件事只能靠"跟模型说一句话",而它们本质上**不产生模型消息** ——
  是人对项目的操作。`dsh-commands` 的语义正是"命令直接对 agent 执行,不产生模型消息",
  结算结果由 UI 渲染在模型历史之外。
- **怎么落**:`ctx.commands.register({ name, description, input, handler })`。handler 直接调用
  已有的纯函数(`serial-audit.ts`、`serial-export.ts`、编年史投影),返回
  `{ kind: 'success', text }`。**零新逻辑**,三份实现都已在仓库里且有测试。
- **代价**:小。命令面要挂在哪一层需要决定(跟着预设走 = 只在「短篇集作家」会话里可用,
  这是对的)。
- **动设计决定**:**不动**。命令只读,不写项目。
- **证据**:`dsh-commands@0.2.1-rc.2` 的 README 明确"插件通过 `ctx.commands.register()` 注册命令,
  提供小写名称、说明、可选 `input` 提示和处理函数"。

#### U-2 面板 → 会话:把"在面板里改稿"接上

- **解决什么**:工作台目前**只读**(README「面板不做的事」)。用户看着某一章想改一段,
  唯一路径是切回聊天窗、描述位置。这是最大的体验缺口。
- **两个方案,差别在要不要动硬约束**:
  - **A(推荐,零新通道)**:面板把"选中范围 + 想要的改法"变成**一条用户消息**发出
    (走宿主的普通输入路径),模型照旧 `serial_apply_change` + 原生审批。浏览器侧仍然
    **没有任何写入端点**,`AGENTS.md` 那条硬约束原文不动。
  - **B**:面板直接投递到提案收件箱(非权威、不碰项目)。技术上 0.2.1 已解锁 HTTP 通道,
    但它**新增了一个浏览器写端点**,必须改 `AGENTS.md` 的硬约束原文 —— 要改就得说清为什么。
- **代价**:A 是纯 Client 改动 + 一段引导文案;B 是 Host 新端点 + 契约变更。
- **动设计决定**:A **不动**;B 动第 4 条(写入必经审批)的边界定义 —— 虽然收件箱不写项目,
  但"浏览器不写"这条一旦松动,后面每次都想再松一点。
- **建议**:先 A。A 落地后你会发现 B 想解决的问题大半已经没了。

#### U-3 把 `.serial/` 资产接进宿主的文档预览

- **解决什么**:工作台为了读 `.serial/*.md` 自己写了一个迷你 Markdown 渲染器(600 行级)。
  宿主本来就有文档预览 Tab(`dsh-client-ui-sidebar-documentpreview`)与 `file` 资源模型,
  它能给到主题、行号、打字排版。重复实现是纯负债。
- **怎么落**:按 `dsh-api-workspace-files` 的"Client 文件资源"约定注册资源提供方
  (`ctx.resources` + 地址语法 `dsh-resource://file/session/<sessionId>/<path>`),把章节正文
  暴露成可被其它 UI 打开的地址;面板里点章节 = 打开宿主的预览,而不是自己渲染。
- **代价**:中。要按资源模型的地址语法与生命周期来写,不是"换个组件"那么轻。
- **动设计决定**:**不动**(仍然只读)。
- **副作用**:`client-markdown.ts` 与 18 个测试可以退役,但**先别删** —— 面板内联预览
  (不进 Tab 也能看)是真实需求,两条路可以并存。

#### U-4 会话投影 + 系统提示摘要:省掉每轮的 `serial_read`

- **解决什么**:现在模型每开始一件事都要先 `serial_read` 摸一遍项目状态(集数、章数、
  待审提案、巡检告警)。这是**每轮固定的一到两次工具往返**,而且是它最确定的一次。
- **怎么落**:两半。
  - Host 半:`ctx.sessionProjections.register({ key, stateVersion, stateSchema, init, apply, wire })`
    —— `apply(state, event)` 纯同步、忽略的事件返回同一引用,缓存与冷读由宿主负责。
  - 提示半:`ctx.systemPrompt.section()` 注入一段**紧凑摘要**(例:3 集 / 40 章 / 2 条待审提案 /
    2 处巡检告警 + 每集一行标题)。摘要里不给修订号,模型要写仍然必须 `serial_read` 拿 revision。
- **代价**:中。要克制:摘要超过十几行就变成每轮固定成本,反而亏。**先量再上**。
- **动设计决定**:**不动**,但要守住"修订号只从 `serial_read` 来"这条,否则
  "模型永远不需要复述权威旧文本"的前提会被摘要悄悄破坏。

#### U-5 「一致性审校」子智能体 + skill

- **解决什么**:短篇集的核心质量问题是**跨集连续性**——同一人物在不同集里的口吻、称呼、
  年龄、关系有没有漂。现在只有一个机械巡检(十种结构码),它查不出"这一年她 17 岁,下一集
  又写成 16 岁"。
- **怎么落**:预设里挂 `dsh-tool-subagent`(AGENTS.md 已规定路由:原生 `gpt-5.6-terra` +
  `xhigh`),给子智能体一个窄任务:只读整集导出 + 人物档案,输出**带章号/段落锚点的差异清单**;
  再把写作工艺本身做成 `dsh-skill` 随包分发(短篇集的结构、视角纪律、伏笔回收),由预设自动加载。
- **代价**:中高。子智能体的 token 成本真实存在;而且"审校建议"必须落成**提案**(非权威),
  不能直接改稿 —— 否则等于绕开审批。
- **动设计决定**:不动,但依赖决定 7(提案如何变成一次写入)。**U-5 的产出形态就是决定 7 的输入**,
  两者一起做最省。

#### U-6 批量跨集作业(决定 10 的落地)+ goal 驱动的"写完这一集"

- **解决什么**:写完一集是 8~10 次顺序写入(initialize → 世界 → 人物 → 蓝图 → 时间线 → 章蓝图 × N
  → 正文 × N),中间任何一步中断都只留下半成品。现在模型得在一个回合里把 10 次审批点完。
- **怎么落**:两条腿。
  - **批量写 = 投 N 条提案**(决定 10 的倾向):面板或命令一次生成整集的提案集,人逐条或一次性
    确认,写入仍走原生审批。
  - **长跑 = goal**:用 `dsh-goal` 把"写完这一集"变成一个跨回合目标,每回合推进一章并落一条提案,
    中断可续。这比"在一个回合里硬撑 10 次审批"稳得多。
- **代价**:高。这是本清单里唯一需要新领域概念(提案集 / 批次 id)的一条。
- **动设计决定**:不动"单文件原子替换",但给"一次审批只改一个资产"补一层**批次**语义
  (批次是编排,不是事务)。**不要**为了批量去做多资产原子写入 —— 那会打破第 2、3 条决定的前提。

### 10.3 明确不建议做的

| 想法 | 为什么不 |
|---|---|
| 面板直连项目文件的写端点 | 直接违反第 4 条设计决定;一旦有了,审批卡片展示的内容与实际落盘之间就多了一条没人审的路径 |
| 多资产原子写入 / 事务 | 第 2 条决定(修订号即并发)与第 3 条(落盘即规范字节)都建立在**单文件替换**上,事务会把"哪个字节属于哪次提交"变成新问题 |
| 把项目存进 SQLite | 项目的卖点是**可 diff、可 git、可手改**的纯文本。换存储等于换产品 |
| 导入 `.vela` | 领域模型不同(单本 vs 世界观多集),映射表会长期成为第二个事实源。真要做,做成**一次性迁移工具**,不进运行时 |
| 为"省一次工具调用"把整份资产塞进系统提示 | 与第 1 条决定(模型不复述权威旧文本)直接冲突,且会随项目变大而爆 |

### 10.4 建议排期

| 版本 | 内容 | 理由 |
|---|---|---|
| **0.3.0** | U-1 + U-4 | 两者都不动设计决定,都直接减摩擦:命令把"人对项目做的事"从对话里拿出来,摘要把"每轮固定的一次往返"省掉 |
| **0.4.0** | U-2(A 方案)+ U-3 | 面板从"只读"变成"能发起修改",但仍然没有浏览器写端点;顺带把重复的 Markdown 渲染接回宿主 |
| **0.5.0** | U-5 + 决定 7 | 审校建议与"提案如何落实"是同一个问题的两面,分开做会返工 |
| **0.6.0** | U-6 | 依赖前面所有东西:批次语义需要稳定的提案流,长跑需要 goal,而两者都要先有 U-5 的质量约束 |
