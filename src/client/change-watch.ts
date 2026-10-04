/**
 * 订阅会话工作区里的文件变更。
 *
 * ## 为什么需要它
 *
 * 面板读的是盘上的 `.serial/`,而写盘的是**会话里的模型**(经原生审批)。两者是两个
 * 进程两侧的同一个目录:模型刚写完,面板上还是旧内容,除非用户自己去刷新。变更订阅
 * 就是把这件"该刷新了"告诉面板。
 *
 * ## 实现照抄 dsh 自己的一方面板
 *
 * 这条通道不是直接可用的:`workspaceFiles.changes` 只是**一代物理流**,必须交给
 * `remote.$stream` 的重连监督器包裹 —— 否则断线后不会重开。dsh 自己的侧栏文件树
 * 有一份 `createWatch`,本模块是它的忠实移植(结构逐条对应),而不是我另发明的协议。
 *
 * 协议要点:
 * - `open(lifetime)` 里调 `changes(sessionId, path, lifetime)`,拿一代流;
 * - 收到 `kind === 'ready'` 表示宿主侧的订阅已经生效 —— 调 `accept()` 告诉监督器
 *   "这一代健康",从而重置重连退避;
 * - 其余 kind 一律只需知道"**有变化**"就够了:面板不关心具体变了什么,重新读一遍
 *   整个项目快照最简单也最不容易错;
 * - 中止时必须 `dispose()`,否则会留下宿主侧的流。
 *
 * 这里的类型全是**结构**的:不 import 任何 Harness Client 包,因此不会给客户端打包
 * 引入新的外部依赖(见 `verify-built` 的外部依赖断言)。
 */

/** 监督流里的一个条目。 */
export interface SerialStreamItem<Item> {
  /** 解码后的一帧。 */
  readonly value: Item
  /** 标记"这一代正在正常投递",用于重置重连退避。 */
  accept(): void
}

/** 可重连的单消费者流。 */
export interface SerialSupervisedStream<Item> extends AsyncIterable<SerialStreamItem<Item>> {
  /** 彻底停止这条流。 */
  dispose(): Promise<void>
}

/** 文件变更通知;只有 `kind` 是面板需要的。 */
export interface SerialFileNotice {
  readonly kind: string
}

/** 本模块用到的 Remote 面。 */
export interface SerialChangeRemote {
  /**
   * 建一条重连流。
   *
   * @param options 开流方式与结束分类。
   * @returns 尚未启动的监督流(迭代时才启动)。
   */
  $stream<Item>(options: {
    readonly name: string
    readonly open: (lifetime: AbortSignal) => AsyncIterable<Item>
    readonly ended: (accepted: boolean) => Error
  }): SerialSupervisedStream<Item>
  /** `workspaceFiles` 命名空间。 */
  readonly workspaceFiles: {
    changes(sessionId: string, path: string, signal: AbortSignal): AsyncIterable<SerialFileNotice>
  }
}

/**
 * 跟随一个路径的变更。
 *
 * 产出每一帧的 `kind`;`ready` 帧会先 `accept()` 再产出。中止时结束迭代并释放流。
 * 迭代提前结束(`break` / `return`)同样会释放 —— 与 dsh 的实现一致。
 *
 * @param remote 带 `$stream` 与 `workspaceFiles` 的 Remote 面。
 * @param sessionId 提供读取权限的会话。
 * @param path 工作区内的相对路径。
 * @param signal 结束跟随。
 * @returns 帧 kind 的异步生成器。
 */
export async function* watchWorkspacePath(
  remote: SerialChangeRemote,
  sessionId: string,
  path: string,
  signal: AbortSignal,
): AsyncGenerator<string, void, undefined> {
  if (signal.aborted) return
  const stream = remote.$stream<SerialFileNotice>({
    name: `serial project ${path}`,
    open: lifetime => remote.workspaceFiles.changes(sessionId, path, lifetime),
    ended: () => new Error(`Serial project watch ended: ${path}`),
  })
  const abort = (): void => { void stream.dispose() }
  signal.addEventListener('abort', abort, { once: true })
  try {
    for await (const item of stream) {
      if (signal.aborted) return
      // 只有 ready 需要应答;应答之后才算这一代健康。
      if (item.value.kind === 'ready') item.accept()
      yield item.value.kind
    }
  } finally {
    signal.removeEventListener('abort', abort)
    await stream.dispose()
  }
}
