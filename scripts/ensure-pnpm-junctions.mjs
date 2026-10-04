#!/usr/bin/env node
/** Re-create hoisted junctions tsc + Cordis need after every pnpm install. */

import { existsSync, mkdirSync, readdirSync, symlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pnpmRoot = join(root, 'node_modules', '.pnpm')
// 0.2.0-rc.2 的 dsh 子包没有发布到 npm,而是随伞包 `@deepseek-ai/dsh` 一起分发。
// 工作区的 `node_modules/@deepseek-ai/dsh` 是指向该伞包的 junction,所以这些子包
// 在 `node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/` 下可见;把它们
// 提升到工作区 `node_modules/@deepseek-ai/` 后,从 `tests/fixtures/` 出发解析的
// Loader 才能找到它们。
const dshJunction = join(root, 'node_modules', '@deepseek-ai', 'dsh')

if (!existsSync(pnpmRoot)) {
  console.error('No pnpm virtual store at', pnpmRoot)
  process.exit(0)
}

/** pnpm 目录名前缀 -> 包名路径段(`@scope+name@` 形式的尾部 `@` 是版本分隔符,不是包名的一部分)。 */
function packageSegments(prefix) {
  const segments = prefix.split('+')
  const last = segments.length - 1
  segments[last] = segments[last].replace(/@$/, '')
  return segments
}

function findPkg(prefix) {
  const entries = readdirSync(pnpmRoot)
  for (const entry of entries) {
    if (entry.startsWith(prefix)) {
      const candidate = join(pnpmRoot, entry, 'node_modules', ...packageSegments(prefix))
      if (existsSync(candidate)) return candidate
    }
  }
  // Fallback to the nested `dsh` runtime store for 0.2.0-rc.2 packages that
  // are not published to npm but ship under the `@deepseek-ai/dsh` umbrella.
  if (existsSync(dshJunction)) {
    const nested = join(dshJunction, 'node_modules', ...packageSegments(prefix))
    if (existsSync(nested)) return nested
  }
  return undefined
}

function ensureJunction(target, linkPath) {
  if (existsSync(linkPath)) return
  mkdirSync(dirname(linkPath), { recursive: true })
  symlinkSync(target, linkPath, 'junction')
  console.log('junction:', linkPath, '->', target)
}

// Mapping: which virtual package to hoist, and which hoisted path to create.
// The hoisted path mirrors pnpm's node_modules/<scope>/<name> structure so tsc + Node
// module resolution find them at the workspace root.
const junctions = [
  ['@types+node', 'node_modules/@types/node'],
  ['@deepseek-ai+cosmokit', 'node_modules/@deepseek-ai/cosmokit'],
  ['react@', 'node_modules/react'],
  ['react-dom@', 'node_modules/react-dom'],
  ['@deepseek-ai+cordis@', 'node_modules/@deepseek-ai/cordis'],
  ['@deepseek-ai+schemastery@', 'node_modules/@deepseek-ai/schemastery'],
  ['@deepseek-ai+dsh-brand@', 'node_modules/@deepseek-ai/dsh-brand'],
  ['@deepseek-ai+dsh-llm@', 'node_modules/@deepseek-ai/dsh-llm'],
  ['@deepseek-ai+dsh-workspace@', 'node_modules/@deepseek-ai/dsh-workspace'],
  ['@deepseek-ai+dsh-home-paths@', 'node_modules/@deepseek-ai/dsh-home-paths'],
  ['@deepseek-ai+dsh-agent@', 'node_modules/@deepseek-ai/dsh-agent'],
  ['@deepseek-ai+dsh-agent-instructions@', 'node_modules/@deepseek-ai/dsh-agent-instructions'],
  ['@deepseek-ai+dsh-agent-preset@', 'node_modules/@deepseek-ai/dsh-agent-preset'],
  ['@deepseek-ai+dsh-agent-preset-registry@', 'node_modules/@deepseek-ai/dsh-agent-preset-registry'],
  ['@deepseek-ai+dsh-session-projection@', 'node_modules/@deepseek-ai/dsh-session-projection'],
  ['@deepseek-ai+dsh-system-prompt@', 'node_modules/@deepseek-ai/dsh-system-prompt'],
  ['@deepseek-ai+dsh-client-connection@', 'node_modules/@deepseek-ai/dsh-client-connection'],
  ['@deepseek-ai+dsh-client-runtime@', 'node_modules/@deepseek-ai/dsh-client-runtime'],
  ['@deepseek-ai+dsh-persona@', 'node_modules/@deepseek-ai/dsh-persona'],
  ['@deepseek-ai+dsh-tools@', 'node_modules/@deepseek-ai/dsh-tools'],
  ['@deepseek-ai+dsh-session@', 'node_modules/@deepseek-ai/dsh-session'],
  ['@deepseek-ai+dsh-typert-protocol@', 'node_modules/@deepseek-ai/dsh-typert-protocol'],
  ['@deepseek-ai+cordis-plugin-include@', 'node_modules/@deepseek-ai/cordis-plugin-include'],
  ['@deepseek-ai+cordis-plugin-loader@', 'node_modules/@deepseek-ai/cordis-plugin-loader'],
]

for (const [prefix, hoistedRelative] of junctions) {
  const target = findPkg(prefix)
  if (target !== undefined) {
    ensureJunction(target, join(root, hoistedRelative))
  }
}

// `tests/fixtures/node_modules` 只服务一件事:让 Cordis Loader 在组合
// `tests/fixtures/empty.cordis.yml` 的补丁时,把预设子行解析到**运行时的 rc.2
// 副本**,而不是工作区那份 rc.6。Node 从 fixture 目录逐级上溯,未在此放影子的
// 包仍然落回工作区根,所以 `@leeguanwei/dsh-serial-story` 依旧按线上方式解析
// (即本插件用自己那份 rc.6 依赖,和线上一样)。
//
// 这两个包是 §6.5 记录的破坏性 schema 差异所在:用 rc.6 的 persona 校验
// `prefix` 必然失败,那会让"预设能否挂载"的校验失去意义。
for (const name of ['dsh-persona', 'dsh-agent-instructions']) {
  if (!existsSync(dshJunction)) continue
  const runtimeCopy = join(dshJunction, 'node_modules', '@deepseek-ai', name)
  if (existsSync(runtimeCopy)) {
    ensureJunction(runtimeCopy, join(root, 'tests', 'fixtures', 'node_modules', '@deepseek-ai', name))
  }
}