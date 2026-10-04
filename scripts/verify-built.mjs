/** Verify that Cordis loads the emitted Host entry and the inline preset declaration. */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { runInNewContext } from 'node:vm'
import { renderToStaticMarkup } from 'react-dom/server'
import { Context } from '@deepseek-ai/cordis'
import Include, { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import yaml from 'js-yaml'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
// 目标运行时(dsh 0.2.0-rc.2)自带的子包。工作区 `node_modules/@deepseek-ai/*` 是
// 0.1.0-rc.6 线,两者 schema 不兼容(§6.5),所以花名册校验必须用**运行时那一套**。
const runtimeRoot = join(root, 'node_modules', '@deepseek-ai', 'dsh', 'node_modules', '@deepseek-ai')
/** 从运行时树导入一个包。 */
const importRuntime = (name, file = 'lib/index.js') => import(pathToFileURL(join(runtimeRoot, name, file)).href)
const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
for (const packagedLicenseFile of ['LICENSE']) {
  await readFile(join(root, packagedLicenseFile), 'utf8')
  if (!manifest.files.includes(packagedLicenseFile)) {
    throw new Error(`${packagedLicenseFile} must be declared in package files`)
  }
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
// The Client half is a Cordis client plugin: it must declare `inject` and must reach the
// host only through `ctx.slots` + the Remote carrier. A regression here previously produced
// a `failed` client fiber ("web boot: 1 entry did not activate") because apply() assumed
// DOM mount points. `remote.workspaceFiles` is the dotted sub-service that guarantees the
// read-only namespace is bound before the workbench panel asks for it.
const expectedInject = ['slots', 'remote', 'remote.workspaceFiles']
if (JSON.stringify(clientExports.inject) !== JSON.stringify(expectedInject)) {
  throw new Error(`The emitted Client plugin must inject ${expectedInject.join(', ')}, got ${JSON.stringify(clientExports.inject)}`)
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
// A component that reaches `slots.register` as undefined renders as React error #130
// ("Element type is invalid ... got: undefined") and crashes the slot entry. Also invoke
// each component once with plausible owner props to prove it returns a real React element.
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
// 更强的一条:把主面板真渲染一次。直接调用函数组件只能证明"返回了元素",而
// 包装里那个组件是否在 hook 顺序、空数据分支上站得住,只有真走一遍 React 才知道。
// SSR 不跑 useEffect,所以这里既覆盖了渲染又不发任何 Remote 调用。
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

// M3 ships the preset via an inline `@deepseek-ai/dsh-agent-preset` row in
// `cordis.patch.yml`. dsh 0.2.0-rc.2 does not scan a `presets/` directory from
// installed packages, so the inline row is the only discovery path.
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
// 本工作区的 `node_modules/@deepseek-ai/*` 仍是 0.1.0-rc.6 线(见 §6.3 的 peer 版本
// 偏差),而运行时是 0.2.0-rc.2;两者的 `@deepseek-ai/dsh-persona` schema 不同
// (rc.6 要 `text`,rc.2 要 `prefix`)。因此这里显式从运行时树解析包,验证的是
// 「组合在真实运行时上合法」,而不是本地那份过期副本的 schema。
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

// 用**运行时自己的 rc.2 包**组一个与线上同构的 Cordis roster,再断言内联预设
// 经注册表被发现且**整棵子行挂载成功**。这里刻意不复用工作区那份 rc.6 依赖:
// 混用两代包会让"挂载成功"这句话失去意义(§6.5)。
//
// 本插件自己的 `./agent` 仍从工作区解析 —— 与线上一致(profile 以 link: 装本
// 包,Node 因此用本包自己的 rc.6 依赖去调宿主的 rc.2 服务)。这正是要验的东西。
const { Context: RuntimeContext } = await importRuntime('cordis')
const { default: RuntimeLoader } = await importRuntime('cordis-plugin-loader')
const { default: RuntimeInclude } = await importRuntime('cordis-plugin-include')
const { default: RuntimePresetRegistry } = await importRuntime('dsh-agent-preset-registry')
const { default: RuntimeAgentRegistry } = await importRuntime('dsh-agent')
const { default: RuntimeSessionProjections } = await importRuntime('dsh-session-projection')
const { default: RuntimeSystemPrompt } = await importRuntime('dsh-system-prompt')
const { default: RuntimeToolRuntime } = await importRuntime('dsh-tools')

const roster = new RuntimeContext()
roster.baseUrl = pathToFileURL(root).href + '/'
await roster.plugin(RuntimeLoader)
roster.loader.builtins.include = RuntimeInclude
await roster.plugin(RuntimeSessionProjections)
await roster.plugin(RuntimeSystemPrompt)
await roster.plugin(RuntimeToolRuntime)
await roster.plugin(RuntimeAgentRegistry)
await roster.plugin(RuntimePresetRegistry, { default: 'short-story-writer' })
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
  // 零诊断 = 整棵子行(persona / agent-instructions / 本插件的 ./agent)在目标
  // 运行时上真的挂载成功。这是"预设能不能用"最直接的机器证据。
  if (preset.broken !== undefined) {
    throw new Error(`The inline preset did not mount cleanly on the target runtime: ${preset.broken}`)
  }
} finally {
  await roster.fiber.dispose()
}