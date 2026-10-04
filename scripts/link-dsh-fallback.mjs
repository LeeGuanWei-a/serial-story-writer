#!/usr/bin/env node
/** Create a hoisted node_modules for the plugin by junctioning each dsh fallback entry.

dsh 0.2.0-rc.2's web profile maintains a `profiles/node_modules` flat fallback that
already contains every peer dependency the plugin needs. We mirror each entry the plugin
imports as a junction so tsc + Node resolution succeed without re-running pnpm install.
*/
import { existsSync, mkdirSync, readdirSync, statSync, symlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const fallback = join(process.env.DSH_PROFILE_DIR ?? join(process.env.USERPROFILE ?? '', '.dsh', 'profiles', 'web'), '..', 'node_modules')
const nodeModules = join(root, 'node_modules')

console.log('fallback:', fallback)
if (!existsSync(fallback)) {
  console.error('dsh fallback node_modules not found at', fallback)
  process.exit(1)
}

function listEntries(base) {
  const entries = []
  for (const name of readdirSync(base)) {
    if (name === '.bin' || name === '.pnpm' || name === '.ignored') continue
    entries.push({ name, path: join(base, name) })
  }
  return entries
}

function ensureJunction(target, linkPath) {
  if (existsSync(linkPath)) return
  mkdirSync(dirname(linkPath), { recursive: true })
  symlinkSync(target, linkPath, 'junction')
  console.log('  +', linkPath.slice(nodeModules.length + 1), '->', target)
}

// Mirror the fallback's top-level entries (e.g. react, react-dom, @types, @deepseek-ai).
for (const { name, path } of listEntries(fallback)) {
  ensureJunction(path, join(nodeModules, name))
}

console.log('done.')