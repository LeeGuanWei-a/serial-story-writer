#!/usr/bin/env node
/**
 * 发布资质:一条命令跑完构建链、测试与打包面不变量。
 *
 * ## 为什么不走 `pnpm run`
 *
 * 本机 `pnpm run <script>` 会先触发依赖同步,而该步骤在当前 profile 下会失败(见
 * docs §8 的环境提示)。所以这里直接调 `node`,与仓库其它脚本一致。
 *
 * ## 它检查什么
 *
 * 1. **构建链**:junction → 类型检查 → 产出 → 客户端打包 → 自链接 → 产物契约校验。
 * 2. **测试**:vitest 全绿。
 * 3. **打包面不变量**(单纯跑测试查不到的那些):
 *    - 每个 `exports` 目标都真实存在(否则装上去 `import` 就炸);
 *    - `files[]` 里每个非通配条目都存在(声明了却不发布 = 骗用户);
 *    - `README.md` 与 `LICENSE` 既存在又被声明;
 *    - `dsh.bundle.patch` 指向的文件存在;
 *    - **keyless 快照文件必须已经存在** —— 否则 vitest 会**新建**它并判通过,
 *      漂移检测就被静默绕过了(这条是本脚本最容易被忽略的价值);
 *    - 没有遗留的临时文件。
 *
 * 用法:`node scripts/release-check.mjs`
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const failures = []
const checks = []

/**
 * 跑一步外部命令;失败即记录并终止。
 *
 * @param label 步骤名。
 * @param command 可执行文件。
 * @param args 参数。
 */
function run(label, command, args) {
  console.log(`\n=== ${label} ===`)
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', env: process.env })
  if (result.status !== 0) {
    console.error(`\n发布资质未通过:${label} 退出码 ${result.status}`)
    process.exit(result.status ?? 1)
  }
  checks.push(label)
}

/**
 * 记录一条不变量断言。
 *
 * @param label 断言描述。
 * @param ok 是否成立。
 * @param detail 失败时补充的信息。
 */
function assert(label, ok, detail = '') {
  if (ok) checks.push(label)
  else failures.push(`${label}${detail === '' ? '' : ` — ${detail}`}`)
}

const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

// 打包面在**构建与测试之前**先查一遍。这一条必须**致命且前置**:若只记成一条待
// 汇总的失败、却继续跑 vitest,那么 vitest 会顺手把缺失的快照**新建**出来,问题就
// 被自己的检查步骤掩盖了 —— 反向对照验证过这一点。
const snapshot = join(root, 'tests', '__snapshots__', 'authoring-journey.spec.ts.snap')
if (!existsSync(snapshot)) {
  console.error('发布资质未通过:keyless 快照文件缺失')
  console.error(`  期望:${snapshot}`)
  console.error('  缺失会让 vitest 新建快照并判通过,等于静默关掉漂移检测。')
  console.error('  请先跑一次 `npx vitest run` 并把生成的快照保留下来。')
  process.exit(1)
}
checks.push('keyless 快照文件已存在')

console.log('=== 构建链与测试 ===')
run('准备 junction', process.execPath, ['scripts/ensure-pnpm-junctions.mjs'])
run('类型检查', process.execPath, ['node_modules/typescript/lib/tsc.js', '--noEmit', '-p', 'tsconfig.json'])
// 清理必须显式做:tsc 不会删除源文件已消失的产物,而那些陈旧 .js 会被 files 里的
// `lib/**` 一起发布出去。
run('清理产出目录', process.execPath, ['scripts/clean-lib.mjs'])
run('产出 ESM + 声明', process.execPath, ['node_modules/typescript/lib/tsc.js', '-p', 'tsconfig.build.json'])
run('客户端打包', process.execPath, ['scripts/build-bundle.mjs'])
run('自链接', process.execPath, ['scripts/link-self.mjs'])
run('产物契约校验', process.execPath, ['scripts/verify-built.mjs'])
run('测试', process.execPath, [join('node_modules', 'vitest', 'vitest.mjs'), 'run'])

console.log('\n=== 打包面不变量 ===')

/**
 * 递归列出目录下匹配后缀的文件(相对 root 的 POSIX 路径)。
 *
 * @param dir 绝对目录。
 * @param suffix 后缀。
 * @returns 排好序的相对路径。
 */
function listFiles(dir, suffix) {
  const rows = []
  const walk = current => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const absolute = join(current, entry.name)
      if (entry.isDirectory()) walk(absolute)
      else if (entry.name.endsWith(suffix)) rows.push(absolute.slice(root.length + 1).replaceAll('\\', '/'))
    }
  }
  if (existsSync(dir)) walk(dir)
  return rows.sort()
}

// 每个产出的 .js 都要有对应的源文件:抓"源文件已删、产物还在"的陈旧文件。
// 这是 verify-built 抓不到的 —— 它只校验声明的入口,不会去发现多出来的东西。
for (const emitted of listFiles(join(root, 'lib'), '.js')) {
  // lib/client.js 是打包器把整个 Client 半边合成一个文件的结果,没有单一源文件。
  if (emitted === 'lib/client.js') continue
  // 源文件可能是 .ts 也可能是 .tsx(客户端视图就是 tsx)。
  const stem = emitted.slice('lib/'.length).replace(/\.js$/, '')
  const ok = [`src/${stem}.ts`, `src/${stem}.tsx`].some(candidate => existsSync(join(root, candidate)))
  assert(`产物 ${emitted} 有对应源文件`, ok,
    `src/${stem}.ts(x) 不存在 —— 这是源文件删除后残留的陈旧产物,会被发布出去`)
}

// exports:每一个目标都必须真实存在。
for (const [key, value] of Object.entries(manifest.exports ?? {})) {
  const target = typeof value === 'string' ? value : value.default
  assert(`exports ${key} → ${target}`, typeof target === 'string' && existsSync(join(root, target)),
    '构建产物里没有这个文件,装上去 import 就会失败')
}

// files:声明了却不存在 = 对用户的失实陈述。
for (const entry of manifest.files ?? []) {
  if (entry.includes('*')) continue
  assert(`files 声明 ${entry}`, existsSync(join(root, entry)), '声明要发布却没有这个文件')
}

// 打包面必须带上的两件门面物。
for (const required of ['README.md', 'LICENSE']) {
  assert(`${required} 存在且被声明`,
    existsSync(join(root, required)) && (manifest.files ?? []).includes(required),
    '门面文件缺失或未声明进 files')
}

// bundle patch 指向的文件。
const patch = manifest.dsh?.bundle?.patch
assert('dsh.bundle.patch 指向的文件存在',
  typeof patch === 'string' && existsSync(join(root, patch)), `收到 ${JSON.stringify(patch)}`)

// 客户端半边必须真的声明了注入,否则插件在浏览器里起不来。
assert('dsh.client 声明了 inject 与 platform',
  Array.isArray(manifest.dsh?.client?.inject) && manifest.dsh.client.inject.length > 0
    && typeof manifest.dsh?.client?.platform === 'string',
  JSON.stringify(manifest.dsh?.client))

// 元数据:发布一个包该有的东西。
for (const key of ['name', 'version', 'description', 'license', 'repository']) {
  assert(`manifest 有 ${key}`, manifest[key] !== undefined && manifest[key] !== '')
}
assert('manifest 有 engines.node', typeof manifest.engines?.node === 'string')

// 临时文件不该留在仓库根。
const strays = readdirSync(root).filter(name => name.startsWith('.tmp'))
assert('没有遗留临时文件', strays.length === 0, strays.join(', '))

console.log('\n=== 发布资质汇总 ===')
console.log(`通过 ${checks.length} 项检查`)
if (failures.length > 0) {
  console.error(`\n不变量未通过 ${failures.length} 项:`)
  for (const failure of failures) console.error(`  · ${failure}`)
  process.exit(1)
}
console.log('发布资质:通过')
console.log('\n注:本插件不修改 DeepSeek Harness 上游或 agent loop;真机浏览器冒烟(需要固定提交的')
console.log('    Harness 源仓与 Chrome 控制)不在本脚本范围内,见 README「发布资质」。')
