#!/usr/bin/env node
/**
 * 把 Client 源码打成宿主 `__ModuleLoader__` 需要的 CJS 工厂包。
 *
 * **为什么不用 tsdown**:本机 Node 24 的严格导出语义会让 tsdown 打包进来的 `ansis`
 * 依赖报错。等将来 Node / ansis / tsdown 三者版本重新对齐时再考虑换回来 —— 这条说明
 * 原先放在根目录一个空的 `tsdown.config.ts` 里,而那个文件没有任何脚本引用、只把一条
 * 注释伪装成配置,已删除并把说明搬到这里。
 *
 * 早期版本用「内联正文 + 补一句 `const ns = {}`」处理相对 import,
 * 结果被内联模块的 `exports.X = ...` 全写到外层模块的 exports 上,
 * 调用方拿到的命名空间是空对象 —— 组件变成 `undefined`,
 * 浏览器里表现为 React #130(`slot entry crashed in 'sidebar.panellist'`)。
 *
 * 现在改为最小但正确的模块系统:
 * - 每个源文件一个 factory,注册到 `__factories[id]`;
 * - 每个模块记录自己的相对依赖表 `__deps[id] = { spec: depId }`;
 * - 注入给 factory 的 `require` 先查依赖表,未命中才委托宿主的 `require`。
 * 因此不需要改写被转译代码里的任何 `require(...)` 调用。
 */
import { existsSync, statSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const entryPath = join(root, 'src', 'client', 'index.ts')
const outputPath = join(root, 'lib', 'client.js')
const packageId = '@leeguanwei/dsh-serial-story'

function isFile(path) {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

/**
 * 把相对 specifier 解析成实际源文件。
 *
 * 支持 `./x`、`./x.ts`、`./x.tsx`、`./x.js`(按 TS 源码回退)与目录导入 `./x` → `./x/index.ts`。
 *
 * @param spec 转译产物里的原始 specifier。
 * @param importer 发起该 require 的文件绝对路径。
 * @returns 命中的源文件绝对路径,未命中返回 undefined。
 */
function resolveLocal(spec, importer) {
  const base = spec.replace(/\.(js|jsx|ts|tsx)$/, '')
  const candidates = [
    spec,
    base + '.ts',
    base + '.tsx',
    join(spec, 'index.ts'),
    join(spec, 'index.tsx'),
    join(base, 'index.ts'),
    join(base, 'index.tsx'),
  ]
  for (const candidate of candidates) {
    const absolute = join(dirname(importer), candidate)
    if (isFile(absolute)) return absolute
  }
  return undefined
}

const modules = []
const idByFile = new Map()
const pending = []

function addModule(file) {
  const existing = idByFile.get(file)
  if (existing !== undefined) return existing
  const id = modules.length
  idByFile.set(file, id)
  modules.push({ file, code: '', deps: {} })
  pending.push({ id, file })
  return id
}

const entryId = addModule(entryPath)

while (pending.length > 0) {
  const { id, file } = pending.shift()
  const source = await readFile(file, 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2024,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
      isolatedModules: true,
      verbatimModuleSyntax: false,
    },
    fileName: file,
  })

  const deps = {}
  const requirePattern = /require\(\s*["']([^"']+)["']\s*\)/g
  let match
  while ((match = requirePattern.exec(outputText)) !== null) {
    const spec = match[1]
    if (!spec.startsWith('.')) continue
    const target = resolveLocal(spec, file)
    if (target === undefined) throw new Error(`Cannot resolve ${spec} from ${file}`)
    deps[spec] = addModule(target)
  }

  modules[id] = { file, code: outputText, deps }
}

const depsLiteral = JSON.stringify(Object.fromEntries(modules.map((module, id) => [id, module.deps])))

const factories = modules
  .map((module, id) => {
    const relative = module.file.slice(root.length + 1).replace(/\\/g, '/')
    const indented = module.code
      .split('\n')
      .map(line => (line.length > 0 ? `      ${line}` : line))
      .join('\n')
    return `  // ${id}: ${relative}\n  ${id}: function (module, exports, require) {\n${indented}\n  },`
  })
  .join('\n')

const output = `window.__ModuleLoader__.load({ id: ${JSON.stringify(packageId)}, factory: (externalRequire) => {
  var __deps = ${depsLiteral};
  var __cache = {};
  var __factories = {
${factories}
  };
  function __load(id) {
    if (Object.prototype.hasOwnProperty.call(__cache, id)) return __cache[id].exports;
    var module = { exports: {} };
    __cache[id] = module;
    var deps = __deps[id] || {};
    var localRequire = function (spec) {
      if (Object.prototype.hasOwnProperty.call(deps, spec)) return __load(deps[spec]);
      return externalRequire(spec);
    };
    __factories[id](module, module.exports, localRequire);
    return module.exports;
  }
  return __load(${entryId});
} });
`

await writeFile(outputPath, output, 'utf8')
console.log(`bundled ${modules.length} client modules into ${outputPath.slice(root.length + 1)}`)
