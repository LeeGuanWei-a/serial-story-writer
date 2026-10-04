#!/usr/bin/env node
/**
 * 清空产出目录 `lib/`。
 *
 * ## 为什么构建前必须清
 *
 * `tsc` **不会**删除源文件已消失的产物。删掉 `src/command-rpc.ts` 之后,`lib/` 里
 * 的 `command-rpc.js` 会一直留着,而 `package.json` 的 `files` 声明了 `lib/**` ——
 * 于是死代码照样被打包发布。清理必须显式做。
 *
 * `verify-built.mjs` 只校验声明的入口,不会去发现多出来的文件;真正能抓住这类问题
 * 的是 `release-check.mjs` 里那条"每个 `.js` 都要有对应的 `.ts`"不变量。
 */

import { rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
rmSync(join(root, 'lib'), { recursive: true, force: true })
console.log('cleaned lib/')
