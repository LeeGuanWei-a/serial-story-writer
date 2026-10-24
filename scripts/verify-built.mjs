/**
 * 产物契约校验:确认 Cordis 能装载 Host 入口、内联预设声明能被目标运行时发现并整棵挂载。
 *
 * ## 为什么这里只认一套运行时
 *
 * 0.1.x 时代 dsh 的子包没有发布到 npm,工作区只能装 0.1.0-rc.6,而运行时是 0.2.0-rc.2,
 * 于是本脚本必须从"伞包 `@deepseek-ai/dsh` 的嵌套树"里另取一份 rc.2 来做校验,还要
 * 用 junction 影子目录让 fixture 解析到那一份。**0.2.1 起子包已全部上 npm**,因此工作区
 * 的 `node_modules` 就是用户机器上运行的那套:同一版本、同一份 schema。两代运行时的
 * 兼容层因此被整段删除。
 *
 * ## 它还守住一条最容易失效的契约
 *
 * DSH 在装载 bundle 层之前会做**准入判定**(见 `dsh-app-boot` 的 `unmetRequirements`):
 * 插件若有 `engines.dsh` 就必须满足它;否则退化为逐个检查 `@deepseek-ai/dsh` /
 * `@deepseek-ai/dsh-*` 的 peer 范围。任何一条不满足,bundle 会被**静默跳过**,只有在
 * `skippedBundles` 里留一行。0.1.1 正是这样在 0.2.1-rc.2 上消失的 —— 所以这里用与
 * 上游完全相同的判定(含 `includePrerelease`)在构建期断言一次。
 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { runInNewContext } from 'node:vm'
import { renderToStaticMarkup } from 'react-dom/server'
import { Context } from '@deepseek-ai/cordis'
import Include, { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { evaluatePluginCompatibility, readPluginMeta } from '@deepseek-ai/dsh-app-boot'
import yaml from 'js-yaml'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
/** 目标运行时树:工作区安装的 dsh 子包,与用户机器上的运行时逐版本一致。 */
const runtimeRoot = join(root, 'node_modules', '@deepseek-ai')
/** 从目标运行时树导入一个包。 */
const importRuntime = (name, file = 'lib/index.js') => import(pathToFileURL(join(runtimeRoot, name, file)).href)
/** 读取一个包的 manifest。 */
const runtimeManifest = async name => JSON.parse(await readFile(join(runtimeRoot, name, 'package.json'), 'utf8'))

const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
for (const packagedLicenseFile of ['LICENSE']) {
  await readFile(join(root, packagedLicenseFile), 'utf8')
  if (!manifest.files.includes(packagedLicenseFile)) {
    throw new Error(`${packagedLicenseFile} must be declared in package files`)
  }
}

// ── 插件卡片上显示的那两行字 ────────────────────────────────────────────────
// Plugin Manager 用运行时自己的 `readPluginMeta` 读显示文本:`<包>/locale/en.json`
// 是必需的入口(其它语言由同目录的兄弟文件补上),字段在 `meta.title` /
// `meta.description` 下;任一处写错(例如 exports 忘了映射 `./locale/*.json`)
// 都会**静默退化**成 package.json 里的开发者英文,界面上不报错。所以这里直接调
// 那个读取器,并断言译文真的读到了。
const selfBase = pathToFileURL(join(root, 'scripts', 'verify-built.mjs')).href
const meta = readPluginMeta(manifest.name, selfBase)
if (meta === undefined) throw new Error('readPluginMeta returned nothing; the package self-link is missing (run scripts/link-self.mjs)')
if (meta.error !== undefined) throw new Error(`Plugin display metadata is malformed: ${meta.error}`)
for (const language of ['en', 'zh']) {
  for (const field of ['title', 'description']) {
    const value = meta[field]?.[language]
    if (typeof value !== 'string' || value.trim() === '') {
      throw new Error(`Plugin display metadata is missing ${field}.${language}; got ${JSON.stringify(meta[field])}. The locale file must be exported as ./locale/*.json and shaped { "meta": { "title", "description" } }.`)
    }
  }
}
if (typeof meta.icon !== 'string' || !meta.icon.startsWith('data:image/svg+xml')) {
  throw new Error(`Plugin icon did not resolve to an inlined SVG; got ${JSON.stringify(meta.icon)?.slice(0, 80)}. Declare package.json "icon" or export "./icon".`)
}
// 标题不能只是包名 —— 那正是"没配上"时的回退值。
if (meta.title.zh === manifest.name || meta.title.en === manifest.name) {
  throw new Error('Plugin display title fell back to the package name, which means the locale files were not read')
}

// ── 准入判定:直接调用目标运行时自己的评估器 ─────────────────────────────────
// 两处闸门用的都是同一个函数,所以这里既覆盖**安装期**(plugin-manager 的
// `evaluatePluginCompatibility` 预检)也覆盖**启动期**(app-boot 装载 bundle 层前的
// 判定):有 `engines.dsh` 时由它单独裁决、peer 一律忽略;否则每个
// `@deepseek-ai/dsh` / `@deepseek-ai/dsh-*` peer 都必须满足。
//
// 空白的 exemption 列表是刻意的:用户机器上不该需要一次豁免。
const dshRuntime = await runtimeManifest('dsh')
const runtimeVersion = dshRuntime.version
const issue = evaluatePluginCompatibility(manifest, [])
if (issue !== undefined) {
  throw new Error(`The target runtime ${runtimeVersion} rejects ${manifest.name}@${manifest.version} at install time: ${JSON.stringify(issue)}. DSH would refuse to install it (or silently skip the bundle) without an exemption.`)
}

const clientSource = await readFile(join(root, 'lib', 'client.js'), 'utf8')
let clientHandoff
runInNewContext(clientSource, {
  window: { __ModuleLoader__: { load: handoff => { clientHandoff = handoff } } },
})
if (clientHandoff?.id !== manifest.name || typeof clientHandoff.factory !== 'function') {
  throw new Error('The emitted Client entry did not register its declared package id')
}
const clientModules = new Map([
  ['react', await import('react')],
  ['react/jsx-runtime', await import('react/jsx-runtime')],
  ['react-dom', await import('react-dom')],
  ['react-dom/client', await import('react-dom/client')],
])
const clientExports = clientHandoff.factory(specifier => {
  if (!clientModules.has(specifier)) throw new Error(`Unexpected emitted Client external: ${specifier}`)
  return clientModules.get(specifier)
})
if (typeof clientExports.apply !== 'function' || 'default' in clientExports) {
  throw new Error('The emitted Client factory must return named apply without a default export')
}
// Client 半边是一个 Cordis 客户端插件:必须声明 `inject`,并且只经 `ctx.slots` 与
// Remote 载体触达宿主。`remote.workspaceFiles` 是点号子服务 —— 注入它即保证只读
// 文件命名空间在工作台面板索取之前已绑定。
const expectedInject = ['slots', 'remote', 'remote.workspaceFiles']
if (JSON.stringify(clientExports.inject) !== JSON.stringify(expectedInject)) {
  throw new Error(`The emitted Client plugin must inject ${expectedInject.join(', ')}, got ${JSON.stringify(clientExports.inject)}`)
}
// `dsh.client.inject` 只用于给**动态**客户端包排激活顺序。本插件的 bundle 只向宿主
// 的静态模块表要 react,不引用任何 Harness 客户端包,所以它必须是空数组 —— 列一个
// 运行时并不存在的包会让组合阶段判为缺失提供方。
if (!Array.isArray(manifest.dsh?.client?.inject) || manifest.dsh.client.inject.length !== 0) {
  throw new Error(`dsh.client.inject must be an empty array (the bundle imports no Harness Client package), got ${JSON.stringify(manifest.dsh?.client?.inject)}`)
}
const registrations = []
const registeredComponents = []
clientExports.apply({
  slots: {
    inject(name, callback) {
      registrations.push(name)
      callback()
    },
    register(registration, component) {
      registeredComponents.push({ registration, component })
      return () => {}
    },
  },
  remote: {},
})
const expectedSlots = ['sidebar.panellist', 'main']
if (JSON.stringify(registrations) !== JSON.stringify(expectedSlots)) {
  throw new Error(`The emitted Client plugin must register into ${expectedSlots.join(' and ')}, got ${JSON.stringify(registrations)}`)
}
// 到达 `slots.register` 的组件若是 undefined,浏览器里表现为 React #130
// ("Element type is invalid ... got: undefined")并打崩该 slot 条目。这里逐个调用一次
// 证明它返回真实的 React 元素。
for (const { registration, component } of registeredComponents) {
  const where = `${registration.name}/${registration.id ?? registration.key}`
  if (typeof component !== 'function') {
    throw new Error(`The emitted Client plugin registered a non-component (${typeof component}) into ${where}`)
  }
  const element = component({ size: 16, active: false })
  if (typeof element !== 'object' || element === null || element.type === undefined) {
    throw new Error(`The component registered into ${where} did not return a React element`)
  }
}
// 更强的一条:把主面板真渲染一次。直接调用函数组件只能证明"返回了元素",而包装里
// 那个组件是否在 hook 顺序、空数据分支上站得住,只有真走一遍 React 才知道。SSR 不跑
// useEffect,所以这里既覆盖了渲染又不发任何 Remote 调用。
const mainComponent = registeredComponents.find(entry => entry.registration.name === 'main')?.component
const markup = renderToStaticMarkup(mainComponent({}))
if (!markup.includes('短篇集工作台')) {
  throw new Error(`The workbench panel did not render its title; got ${JSON.stringify(markup.slice(0, 200))}`)
}
const sidebarRegistration = registeredComponents.find(entry => entry.registration.name === 'sidebar.panellist')?.registration
if (sidebarRegistration?.id !== 'serial-story' || sidebarRegistration.label !== '短篇集工作台') {
  throw new Error(`The sidebar panel registration is wrong: ${JSON.stringify(sidebarRegistration)}`)
}
const mainRegistration = registeredComponents.find(entry => entry.registration.name === 'main')?.registration
if (mainRegistration?.key !== 'serial-story') {
  throw new Error(`The main panel registration is wrong: ${JSON.stringify(mainRegistration)}`)
}
const patchPath = join(root, manifest.dsh.bundle.patch)
const patches = yaml.load(await readFile(patchPath, 'utf8'), { schema: entryListSchema })
if (!Array.isArray(patches)) throw new TypeError(`${patchPath} must contain a YAML list`)

// 预设以 `@deepseek-ai/dsh-agent-preset` 的内联行随 `cordis.patch.yml` 分发。目标
// 运行时不会扫描已安装包里的 `presets/` 目录,所以内联行是唯一的发现路径。
const presetRows = patches.flatMap(patch => {
  if (Array.isArray(patch)) return patch
  if (patch && typeof patch === 'object' && 'insert' in patch) return patch.insert
  return []
}).filter(row => row && typeof row === 'object' && row.name === '@deepseek-ai/dsh-agent-preset')

const inlinePreset = presetRows.find(row => row.id === 'preset-short-story-writer')
if (inlinePreset === undefined) {
  throw new Error(`cordis.patch.yml must contain a preset-short-story-writer row inserting '@deepseek-ai/dsh-agent-preset'`)
}
if (inlinePreset.config?.id !== 'short-story-writer') {
  throw new Error(`Inline preset config.id must be "short-story-writer", got ${JSON.stringify(inlinePreset.config?.id)}`)
}
if (inlinePreset.config?.name !== '短篇集作家') {
  throw new Error(`Inline preset display name must be "短篇集作家", got ${JSON.stringify(inlinePreset.config?.name)}`)
}
if (!Array.isArray(inlinePreset.config?.plugins) || inlinePreset.config.plugins.length === 0) {
  throw new Error(`Inline preset must declare at least one child plugin, got ${JSON.stringify(inlinePreset.config?.plugins)}`)
}
const presetChildNames = inlinePreset.config.plugins
  .map(plugin => `${plugin?.name ?? '<unknown>'}`)
const bannedTools = ['@deepseek-ai/dsh-tool-bash', '@deepseek-ai/dsh-tool-pwsh', '@deepseek-ai/dsh-tool-fs', '@deepseek-ai/dsh-tool-fs-search', '@deepseek-ai/dsh-tool-str-replace-editor', '@deepseek-ai/dsh-tool-workflow', '@deepseek-ai/dsh-tool-cordis']
const bannedInPreset = presetChildNames.filter(name => bannedTools.includes(name))
if (bannedInPreset.length > 0) {
  throw new Error(`Inline preset must not mount shell, generic fs, text-replace, or Code Mode tools; got ${bannedInPreset.join(', ')}`)
}
const agentEntry = inlinePreset.config.plugins.find(plugin => plugin?.name === '@leeguanwei/dsh-serial-story/agent')
if (agentEntry === undefined) {
  throw new Error('Inline preset must mount the package\'s ./agent entry (the closed V1 surface)')
}

// 逐行用**目标运行时**导出的 `Config` schema 校验子行配置。
//
// 这一条守的是"预设能不能挂":persona / agent-instructions 的 schema 在版本之间真的
// 变过(0.1.0-rc.6 要 `text`,0.2 线要 `prefix`)。配置写错时上游不会在安装时报错,
// 而是让整棵预设挂在 `broken` 状态 —— 必须在构建期抓住。
/** 预设子行名 → 运行时包目录中的入口文件。 */
function runtimeEntryFor(specifier) {
  if (specifier === '@leeguanwei/dsh-serial-story/agent') return join(root, 'lib', 'agent.js')
  const shortName = specifier.replace(/^@deepseek-ai\//, '')
  return join(runtimeRoot, shortName, 'lib', 'index.js')
}
for (const row of inlinePreset.config.plugins) {
  const specifier = row?.name
  if (typeof specifier !== 'string') throw new Error(`Inline preset row names no plugin: ${JSON.stringify(row)}`)
  const entry = runtimeEntryFor(specifier)
  if (!existsSync(entry)) throw new Error(`Inline preset row "${specifier}" does not resolve on the target runtime: ${entry}`)
  const runtimeModule = await import(pathToFileURL(entry).href)
  if (typeof runtimeModule.Config !== 'function') continue
  try {
    runtimeModule.Config(row.config ?? {})
  } catch (error) {
    throw new Error(`Inline preset row "${specifier}" has a config the target runtime rejects: ${error.message}`)
  }
}

const host = new Context()
host.baseUrl = pathToFileURL(root).href + '/'
host.provide('workspaceRegistry', { get: () => undefined })
await host.plugin(Loader)
host.loader.builtins.include = Include
const builtModule = await import(pathToFileURL(join(root, manifest.main)).href)
if ('default' in builtModule) throw new Error('The emitted Host entry must not add a default export')
const unwrapped = host.loader.unwrapExports(builtModule)
if (unwrapped !== builtModule || unwrapped.name !== 'dsh-serial-story' || typeof unwrapped.apply !== 'function') {
  throw new Error('Loader export unwrapping did not preserve the emitted Host plugin')
}
const v2AgentModule = await import(pathToFileURL(join(root, 'lib', 'agent-v2.js')).href)
if ('default' in v2AgentModule) throw new Error('The emitted agent-v2 entry must not add a default export')
const v2Agent = host.loader.unwrapExports(v2AgentModule)
if (v2Agent !== v2AgentModule || v2Agent.name !== 'dsh-serial-story-agent-v2'
  || typeof v2Agent.apply !== 'function'
  || JSON.stringify(v2Agent.inject) !== JSON.stringify(['agents', 'systemPrompt', 'tools', 'workspaceRegistry'])) {
  throw new Error('The emitted agent-v2 entry must declare its Workspace registry dependency')
}

try {
  await host.loader.create({
    name: 'cordis:include',
    config: {
      path: pathToFileURL(join(root, 'tests', 'fixtures', 'empty.cordis.yml')).href,
      patches,
    },
  })
  await host.loader.await()
  const entry = [...host.loader.entries()].find(candidate => candidate.options.id === 'serial-story')
  if (entry?.fiber === undefined) throw new Error('Cordis Loader did not mount the emitted Host entry')
} finally {
  await host.fiber.dispose()
}

// 用目标运行时自己的包组一个与线上同构的 Cordis 花名册,再断言内联预设经注册表被
// 发现、且**整棵子行挂载成功**。这里刻意复用工作区依赖:它已经不是"另一代"了,而
// 就是用户机器上运行的那一套。
const { default: RuntimePresetRegistry } = await importRuntime('dsh-agent-preset-registry')
const { default: RuntimeAgentRegistry } = await importRuntime('dsh-agent')
const { default: RuntimeSessionProjections } = await importRuntime('dsh-session-projection')
const { default: RuntimeSystemPrompt } = await importRuntime('dsh-system-prompt')
const { default: RuntimeToolRuntime } = await importRuntime('dsh-tools')

const roster = new Context()
roster.baseUrl = pathToFileURL(root).href + '/'
await roster.plugin(Loader)
roster.loader.builtins.include = Include
await roster.plugin(RuntimeSessionProjections)
await roster.plugin(RuntimeSystemPrompt)
await roster.plugin(RuntimeToolRuntime)
await roster.plugin(RuntimeAgentRegistry)
await roster.plugin(RuntimePresetRegistry, { default: 'short-story-writer' })
// `dsh-agent-instructions`(0.2.1 起)注入 `workingDirectory`。真实的 workspace 目录
// 服务会连带拖进 fs / sandbox 整套,而这里只需要"预设子行能挂载"这一条证据:该包在
// 缺少 `ctx.fs` provider 时按设计退化为 no-op,`ensure` 根本不会被调用,所以要给它
// 一个到位的服务占位,而不是伪造文件系统行为。
roster.provide('workingDirectory', { ensure: async () => undefined })
try {
  await roster.loader.create({
    name: 'cordis:include',
    config: {
      path: pathToFileURL(join(root, 'tests', 'fixtures', 'empty.cordis.yml')).href,
      patches,
    },
  })
  await roster.loader.await()
  const presets = await roster.agentPresets.list()
  const preset = presets.find(candidate => candidate.id === 'short-story-writer')
  if (preset === undefined) {
    throw new Error(`The inline preset was not registered on the roster: ${JSON.stringify(presets)}`)
  }
  if (preset.name !== '短篇集作家') {
    throw new Error(`The inline preset display name is wrong: ${JSON.stringify(preset)}`)
  }
  // 零诊断 = 整棵子行(persona / agent-instructions / 本插件的 ./agent)在目标运行时
  // 上真的挂载成功。这是"预设能不能用"最直接的机器证据。
  if (preset.broken !== undefined) {
    throw new Error(`The inline preset did not mount cleanly on the target runtime: ${preset.broken}`)
  }
} finally {
  await roster.fiber.dispose()
}
