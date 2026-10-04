/**
 * V1 入口的专用工具面安装(M3 补上的缺口)。
 *
 * `installDedicatedPresetSurface` 决定预设内的 Agent 能看到哪些工具:
 * 少了这一步,预设会继承宿主的通用工具集(shell、通用文件读写、Code Mode),
 * 违反插件的硬约束。这里用一个最小的假 Cordis 上下文驱动它,断言:
 * 收窄只作用于本预设组合出的 Agent、允许集合恰好是两个 V1 工具、
 * 其余工具的调用被拒。
 */

import { describe, expect, it } from 'vitest'
import { apply, serialApprovalGate } from '../src/agent.ts'

interface FakeAgent {
  readonly ctx: {
    readonly tools: { restrict(options: { allow: readonly string[] }): () => void }
    effect(callback: () => () => void, name: string): () => void
  }
}

/** 记录一次 `tools.restrict` 调用的允许集合。 */
interface Restriction {
  readonly agent: FakeAgent
  readonly allow: readonly string[]
}

/**
 * 构造最小 Cordis 上下文,只实现 `apply` 真正触及的成员。
 *
 * @param composedPreset 该 Agent 上下文组合出的 preset id。
 * @returns 假上下文、已注册工具名、事件处理器表、restriction 记录。
 */
function fakeContext(composedPreset: string | undefined) {
  const registeredTools: string[] = []
  const restrictions: Restriction[] = []
  const handlers = new Map<string, (...args: never[]) => unknown>()
  const agents = new Map<string, FakeAgent>()

  const agent: FakeAgent = {
    ctx: {
      tools: {
        restrict(options) {
          restrictions.push({ agent, allow: options.allow })
          return () => undefined
        },
      },
      effect() {
        return () => undefined
      },
    },
  }

  const presetCtx = {
    get(name: string) {
      return name === 'agentPresets' ? { composedPreset: () => composedPreset } : undefined
    },
    on(event: string, handler: (...args: never[]) => unknown) {
      handlers.set(event, handler)
      return () => undefined
    },
    effect() {
      return () => undefined
    },
    agents: { get: (sessionId: string) => agents.get(sessionId) },
  }

  const ctx = {
    tools: { register: (definition: { name: string }) => registeredTools.push(definition.name) },
    on(event: string, handler: (...args: never[]) => unknown) {
      if (event === 'tools/pre-execute') handlers.set('host:tools/pre-execute', handler)
      return () => undefined
    },
    inject(_names: readonly string[], callback: (child: unknown) => void) {
      callback(presetCtx)
    },
  }

  return { ctx, agent, agents, registeredTools, restrictions, handlers, presetCtx }
}

describe('V1 入口的工具面收窄', () => {
  it('只把 serial_read 与 serial_apply_change 暴露给本预设的 Agent', () => {
    const { ctx, agent, agents, registeredTools, restrictions, handlers } = fakeContext('short-story-writer')
    apply(ctx as never)

    // 注册到宿主工具表的是两个 V1 工具。
    expect(registeredTools).toEqual(['serial_read', 'serial_apply_change'])

    // 预设内的 Agent 选中该 preset 时被收窄。
    agents.set('session-1', agent)
    const selected = handlers.get('agent-preset/selected') as never as (
      sessionId: string,
      agentPreset: string,
    ) => void
    selected('session-1', 'short-story-writer')

    expect(restrictions).toHaveLength(1)
    expect(restrictions[0].allow).toEqual(['serial_read', 'serial_apply_change'])
  })

  it('不碰其它 preset 组合出的 Agent', () => {
    const { ctx, agent, agents, restrictions, handlers } = fakeContext('standard')
    apply(ctx as never)

    agents.set('session-1', agent)
    const selected = handlers.get('agent-preset/selected') as never as (
      sessionId: string,
      agentPreset: string,
    ) => void
    selected('session-1', 'standard')

    expect(restrictions).toEqual([])
  })

  it('拒绝本预设 Agent 调用未被允许的工具', async () => {
    const { ctx, agent, restrictions, handlers } = fakeContext('short-story-writer')
    apply(ctx as never)
    expect(restrictions).toHaveLength(0)

    // `agent/created` 也会安装专用面,这里用它替代 selected 事件。
    const created = handlers.get('agent/created') as never as (payload: { agent: FakeAgent }) => void
    created({ agent })
    expect(restrictions[0].allow).toEqual(['serial_read', 'serial_apply_change'])

    const preExecute = handlers.get('tools/pre-execute') as never as (
      exec: { agent: FakeAgent; name: string },
      next: () => Promise<unknown>,
    ) => Promise<unknown>

    const next = () => Promise.resolve({ kind: 'allow' as const })
    await expect(preExecute({ agent, name: 'serial_read' }, next)).resolves.toEqual({ kind: 'allow' })
    await expect(preExecute({ agent, name: 'write' }, next)).resolves.toMatchObject({ kind: 'deny' })
  })
})

describe('原生审批门', () => {
  /** 一次内容合法的 world 替换:审批应该弹出。 */
  const validReplace = {
    kind: 'replace',
    targetKind: 'world',
    baseRevision: 'absent',
    replacement: JSON.stringify({ setting: '海边小镇', locations: ['车站'], notes: '' }),
    summary: '建立共享设定',
  }

  it('内容合法的写入才要求审批', async () => {
    const next = () => Promise.resolve({ kind: 'allow' as const })
    await expect(
      serialApprovalGate({ name: 'serial_apply_change', arguments: validReplace }, next),
    ).resolves.toMatchObject({ kind: 'ask' })
  })

  it('其它工具一律下传', async () => {
    const next = () => Promise.resolve({ kind: 'allow' as const })
    await expect(serialApprovalGate({ name: 'serial_read' }, next)).resolves.toEqual({ kind: 'allow' })
  })

  // 这是本插件最容易浪费用户耐心的地方:内容非法时 execute 必然失败,却已经
  // 让审批人点了一次确认。改判 deny 后既不弹窗,也把字段清单直接交给模型。
  it('内容非法时不弹审批,直接拒绝并列出允许字段', async () => {
    const next = () => Promise.resolve({ kind: 'allow' as const })
    const decision = await serialApprovalGate({
      name: 'serial_apply_change',
      arguments: {
        ...validReplace,
        replacement: JSON.stringify({ id: 'a', name: 'b', type: 'c' }),
      },
    }, next) as { kind: string; reason: string }

    expect(decision.kind).toBe('deny')
    expect(decision.reason).toContain('id, name, type')
    expect(decision.reason).toContain('setting, locations, notes')
  })

  it('参数形状不合法时同样不弹审批', async () => {
    const next = () => Promise.resolve({ kind: 'allow' as const })
    const decision = await serialApprovalGate(
      { name: 'serial_apply_change', arguments: { kind: 'replace' } },
      next,
    ) as { kind: string }
    expect(decision.kind).toBe('deny')
  })
})
