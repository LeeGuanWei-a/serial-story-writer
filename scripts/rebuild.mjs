#!/usr/bin/env node
/**
 * End-to-end build without going through `pnpm run`.
 *
 * `pnpm run <script>` re-runs a dependency sync before every script in this repo, so the
 * chain is driven with `node` directly. Since 0.2.1 every dsh subpackage is published to
 * npm, so no junction repair step is needed any more — a plain `pnpm install` produces the
 * exact runtime the user runs.
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

run('typecheck', process.execPath, ['node_modules/typescript/lib/tsc.js', '--noEmit', '-p', 'tsconfig.json'])
run('clean', process.execPath, ['scripts/clean-lib.mjs'])
run('emit', process.execPath, ['node_modules/typescript/lib/tsc.js', '-p', 'tsconfig.build.json'])
run('client bundler', process.execPath, ['scripts/build-bundle.mjs'])
run('link-self', process.execPath, ['scripts/link-self.mjs'])
run('verify-built', process.execPath, ['scripts/verify-built.mjs'])
