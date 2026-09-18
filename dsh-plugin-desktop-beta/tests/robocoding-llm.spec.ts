import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { type LlmAdapter } from '@deepseek-ai/dsh-llm'
import { describe, expect, it, vi } from 'vitest'
import { RoboCodingLlmRegistration } from '../src/robocoding-llm.ts'
import type { RoboCodingRelayCredential } from '../src/robocoding-platform.ts'

const relay = (key: string, fundingMode: 'personal_only' | 'team_only' = 'personal_only', teamId = 0): RoboCodingRelayCredential => ({
  key, fundingMode, teamId, baseUrl: 'https://api.example.com', expiresAt: new Date(Date.now() + 60_000).toISOString(),
})

describe('RoboCoding LLM registration', () => {
  it('keeps an explicitly saved custom default when the official account is restored', async () => {
    const selection = { provider: 'my-gateway', model: 'my-model' }
    const saveSelection = vi.fn()
    const ctx = {
      llm: { registerAdapter: vi.fn(() => Object.assign(vi.fn(), { replace: vi.fn() })) },
      get: vi.fn((service: string) => service === 'agentDefaultModel'
        ? { currentSelection: () => selection, saveSelection }
        : service === 'settings' ? { describe: () => [{ ns: 'agent-default-model', user: selection }] } : undefined),
    } as unknown as Context
    const registration = new RoboCodingLlmRegistration(ctx)
    await registration.update(relay('restored'), ['official-model'])
    expect(saveSelection).not.toHaveBeenCalled()
    registration.dispose()
  })
  it('keeps the official route unavailable until login supplies a real model and removes it on logout', async () => {
    const replace = vi.fn()
    const dispose = Object.assign(vi.fn(), { replace })
    const registerAdapter = vi.fn(() => dispose)
    const ctx = {
      llm: { registerAdapter },
      get: vi.fn(() => undefined),
    } as unknown as Context

    const registration = new RoboCodingLlmRegistration(ctx)
    expect(registerAdapter).not.toHaveBeenCalled()

    await registration.update(relay('pending-catalog'), [])
    expect(registerAdapter).not.toHaveBeenCalled()

    await registration.update(relay('signed-in'), ['official-model'])
    expect(registerAdapter).toHaveBeenCalledWith(['robocoding'], expect.anything())

    registration.clear()
    expect(dispose).toHaveBeenCalledOnce()
    registration.dispose()
  })
  it('uses the real LLM registry without exposing a signed-out provider route', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    const registration = new RoboCodingLlmRegistration(ctx)
    try {
      expect(ctx.llm.listProviders()).toEqual([])
      await registration.update(relay('pending-catalog'), [])
      expect(ctx.llm.listProviders()).toEqual([])
      await registration.update(relay('signed-in'), ['official-model'])
      expect(ctx.llm.listProviders()).toEqual([expect.objectContaining({ id: 'robocoding', name: 'RoboCoding' })])
      await registration.updateModels(['new-model'])
      expect((await ctx.llm.listModels('robocoding')).map(model => model.id)).toEqual(['new-model'])
      await registration.updateModels([])
      expect(ctx.llm.listProviders()).toEqual([])
      await registration.updateModels(['restored-model'])
      expect((await ctx.llm.listModels('robocoding')).map(model => model.id)).toEqual(['restored-model'])
      registration.clear()
      expect(ctx.llm.listProviders()).toEqual([])
    } finally {
      registration.dispose()
      await ctx.fiber.dispose()
    }
  })
  it('selects RoboCoding once, preserves later user choices, and only repairs an unavailable RoboCoding model', async () => {
    let selection = { provider: 'deepseek', model: 'deepseek-chat' }
    const saveSelection = vi.fn(async (next: { provider: string; model: string }) => { selection = next })
    const replace = vi.fn()
    const dispose = Object.assign(vi.fn(), { replace })
    let adapter: LlmAdapter | undefined
    const ctx = {
      llm: { registerAdapter: vi.fn((_providers: string[], next: LlmAdapter) => { adapter = next; return dispose }) },
      get: vi.fn((service: string) => service === 'agentDefaultModel'
        ? { currentSelection: () => selection, saveSelection }
        : undefined),
    } as unknown as Context
    const registration = new RoboCodingLlmRegistration(ctx)

    await registration.update(relay('one'), ['model-a', 'model-b'])
    const internal = registration as unknown as { current: { ref: string } }
    const firstRef = internal.current.ref
    expect(saveSelection).toHaveBeenLastCalledWith({ provider: 'robocoding', model: 'model-a' })

    selection = { provider: 'other', model: 'user-choice' }
    await registration.update(relay('two'), ['model-a', 'model-b'])
    expect(internal.current.ref).toBe(firstRef)
    expect(saveSelection).toHaveBeenCalledTimes(1)

    selection = { provider: 'robocoding', model: 'removed-model' }
    await registration.update(relay('three'), ['model-b'])
    expect(internal.current.ref).toBe(firstRef)
    expect(saveSelection).toHaveBeenLastCalledWith({ provider: 'robocoding', model: 'model-b' })
    expect(adapter).toBeDefined()
    expect(replace).toHaveBeenCalledTimes(2)
    await registration.update(relay('team', 'team_only', 9), ['model-b'])
    expect(internal.current.ref).not.toBe(firstRef)
    registration.dispose()
  })
})
