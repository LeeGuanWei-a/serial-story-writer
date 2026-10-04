#!/usr/bin/env node
/** End-to-end build that sidesteps pnpm run's automatic deps check.

pnpm run re-runs install before each script and then removes the hoisted junctions
tsc needs. This wrapper installs once, restores the junctions, and then drives tsc,
the client bundler, link-self, and verify-built directly without invoking pnpm again.
*/
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function run(label, command, args) {
  console.log(`\n=== ${label} ===`)
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', env: process.env })
  if (result.status !== 0) {
    console.error(`Step failed: ${label} (exit ${result.status})`)
    process.exit(result.status ?? 1)
  }
}

// 1. Install dependencies (skipping blocked postinstall scripts).
run('pnpm install', 'pnpm', ['install', '--ignore-scripts'])

// 2. Restore hoisted junctions for tools that look up the workspace node_modules.
//    `ensure-pnpm-junctions.mjs` 是这组 junction 的**唯一来源**:它同时处理
//    未发布到 npm 的 rc.2 dsh 子包(从 dsh 伞包提升),这里不再维护第二份列表。
run('junctions', 'node', ['scripts/ensure-pnpm-junctions.mjs'])

// 3. Type-check + declaration emit via tsc.
run('tsc', 'node', ['node_modules/typescript/lib/tsc.js', '-p', 'tsconfig.build.json'])

// 4. Bundle the Client CJS envelope.
run('client bundler', 'node', ['scripts/build-bundle.mjs'])

// 5. Symlink the package into node_modules so Cordis can find it.
run('link-self', 'node', ['scripts/link-self.mjs'])

// 6. Run verify-built to confirm the emitted bundle loads.
run('verify-built', 'node', ['scripts/verify-built.mjs'])
