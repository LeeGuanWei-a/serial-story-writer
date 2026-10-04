/**
 * 变更订阅的行为测试。
 *
 * 这条通道在浏览器里,而这个环境没有浏览器控制 —— 所以这里用**脚本化的 Remote 面**
 * 驱动它(dsh 自己的 change feed 也是这么测的)。能在这里钉住的是协议行为:
 * ready 要 accept、中止要 dispose、提前结束也要 dispose、中止后不再产出。
 *
 * **不能**在这里证明的:它在真实浏览器里确实收到了宿主的文件变更。那需要浏览器控制,
 * 报告里必须如实说明。
 */

import { describe, expect, it } from 'vitest'
import { watchWorkspacePath, type SerialChangeRemote, type SerialFileNotice, type SerialStreamItem } from '../src/client/change-watch.ts'

/** 一个可控的流替身:先给几帧,然后挂住直到被关闭。 */
function fakeRemote(frames: readonly string[], seen: { openPath?: string; openSession?: string }) {
  const log: string[] = []
  let closed = false
  let waiter: (() => void) | undefined
  const close = (): void => { closed = true; waiter?.(); waiter = undefined }

  /**
   * 一代物理流。
   *
   * 层次必须与真实一致:`workspaceFiles.changes` 产出的是**裸通知**,把通知包成带
   * `accept` 的条目是 `$stream` 监督器干的活 —— 所以这里 `source()` 只产出通知,由
   * 下面的 `$stream` 负责包装。
   *
   * 结束靠"已关闭"标志而不是一个等到 `await` 才赋值的 resolve 句柄:消费者可能在
   * `yield` 处挂起时就被中止(第一版正是这样挂死的)。标志在任何时刻都能被观察到。
   */
  async function* source(): AsyncGenerator<SerialFileNotice> {
    for (const kind of frames) {
      if (closed) return
      yield { kind }
    }
    while (!closed) await new Promise<void>(resolve => { waiter = resolve })
  }

  // 替身按**具体**的通知类型实现,而接口的 `$stream` 是泛型的 —— 这里断言"对这个
  // 模块唯一的实例化(通知)而言,它满足契约"。真实监督器是泛型的,但本模块只拿它
  // 包一种帧。
  const remote = {
    // 真监督器就是这样:由 `open` 开出这一代流、自己迭代、并在通知外面加上 `accept`。
    $stream: (options: {
      open: (lifetime: AbortSignal) => AsyncIterable<SerialFileNotice>
    }) => {
      const generation = options.open(new AbortController().signal)
      return {
        async *[Symbol.asyncIterator](): AsyncGenerator<SerialStreamItem<SerialFileNotice>> {
          for await (const notice of generation) {
            yield { value: notice, accept: () => { log.push(`accept:${notice.kind}`) } }
          }
        },
        dispose: async () => { log.push('dispose'); close() },
      }
    },
    workspaceFiles: {
      changes: (sessionId: string, path: string) => {
        seen.openSession = sessionId
        seen.openPath = path
        return source()
      },
    },
  } as unknown as SerialChangeRemote
  return { remote, log }
}

describe('跟随工作区路径', () => {
  it('ready 会 accept,其余 kind 原样产出', async () => {
    const seen: { openPath?: string; openSession?: string } = {}
    const { remote, log } = fakeRemote(['ready', 'change', 'change'], seen)
    const controller = new AbortController()

    const kinds: string[] = []
    for await (const kind of watchWorkspacePath(remote, 'session-1', '.serial', controller.signal)) {
      kinds.push(kind)
      if (kinds.length === 3) controller.abort()
    }

    expect(kinds).toEqual(['ready', 'change', 'change'])
    expect(log).toContain('accept:ready')
    expect(seen.openSession).toBe('session-1')
    expect(seen.openPath).toBe('.serial')
  })

  it('中止时释放流(不留宿主侧订阅)', async () => {
    const seen: { openPath?: string; openSession?: string } = {}
    const { remote, log } = fakeRemote(['ready'], seen)
    const controller = new AbortController()

    const iterator = watchWorkspacePath(remote, 's', '.serial', controller.signal)
    await iterator.next()
    controller.abort()
    await iterator.return(undefined)

    expect(log).toContain('dispose')
  })

  it('已经中止时根本不建流', async () => {
    const seen: { openPath?: string; openSession?: string } = {}
    const { remote, log } = fakeRemote(['ready'], seen)
    const controller = new AbortController()
    controller.abort()

    const kinds: string[] = []
    for await (const kind of watchWorkspacePath(remote, 's', '.serial', controller.signal)) kinds.push(kind)

    expect(kinds).toEqual([])
    expect(log).toEqual([])
  })

  it('提前 break 也会释放流', async () => {
    const seen: { openPath?: string; openSession?: string } = {}
    const { remote, log } = fakeRemote(['ready', 'change', 'change'], seen)
    const controller = new AbortController()

    for await (const kind of watchWorkspacePath(remote, 's', '.serial', controller.signal)) {
      if (kind === 'change') break
    }

    expect(log).toContain('dispose')
  })
})
