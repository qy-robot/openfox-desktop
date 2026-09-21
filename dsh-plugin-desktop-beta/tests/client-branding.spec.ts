// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { applyRoboBranding } from '../src/client/robo-branding.ts'
import {
  ROBO_BRAND_BYLINE,
  ROBO_BRAND_NAME,
  ROBO_HERO_SLOGAN,
  ROBO_HERO_SLOGANS,
  RoboBrandMark,
  RoboHeroBrand,
  RoboBrandName,
  installRoboBrandStyles,
  selectRoboHeroSlogan,
} from '../src/client/branding.tsx'

let root: Root | undefined
let container: HTMLDivElement | undefined

afterEach(async () => {
  await act(async () => { root?.unmount() })
  root = undefined
  container?.remove()
  container = undefined
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('OpenFox branding', () => {
  it('renders the OpenFox wordmark and logo mark', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
      root!.render(createElement('div', null,
        createElement(RoboBrandMark),
        createElement(RoboBrandName),
      ))
    })

    expect(container.querySelector('.roboBrandWordmark')?.textContent).toBe(ROBO_BRAND_NAME)
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector<HTMLElement>('.roboBrandMark')?.hidden).toBe(false)
    expect(container.querySelector('.roboBrandName strong')).toBeNull()
    expect(container.querySelector('.roboBrandName small')?.textContent).toBe(ROBO_BRAND_BYLINE)
    expect(ROBO_BRAND_BYLINE).toBe('By擎云机器人')
  })

  it('chooses a preset slogan once when the hero opens', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => { root!.render(createElement(RoboHeroBrand)) })

    expect(container.querySelector('.roboHeroSlogan')?.textContent).toBe(ROBO_HERO_SLOGANS[2])
    expect(container.textContent).toBe(ROBO_HERO_SLOGANS[2])
    expect(container.querySelector('.roboBrandName')).toBeNull()
  })

  it('keeps the original slogan as a preset and selects across the complete set', () => {
    expect(ROBO_HERO_SLOGANS).toContain(ROBO_HERO_SLOGAN)
    expect(selectRoboHeroSlogan(() => 0)).toBe(ROBO_HERO_SLOGANS[0])
    expect(selectRoboHeroSlogan(() => 0.999_999)).toBe(ROBO_HERO_SLOGANS.at(-1))
  })

  it('hides the old title and preview group through the renderer slot anchor and constrains the slogan', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    container = document.createElement('div')
    document.body.append(container)
    // HeroShell's pinned owner structure, including the ui-renderer display:contents anchor.
    container.innerHTML = '<div style="width:280px"><span id="mark"><div data-slot="conversation.hero.brand.mark" style="display:contents"></div></span><span id="title-group"><span id="old">探索未至之境</span><span id="badge">Preview</span></span></div>'
    root = createRoot(container.querySelector('[data-slot]')!)
    await act(async () => { root!.render(createElement(RoboHeroBrand)) })
    const dispose = installRoboBrandStyles()
    try {
      expect(getComputedStyle(container.querySelector('#title-group')!).display).toBe('none')
      expect(getComputedStyle(container.querySelector('#mark')!).maxWidth).toBe('100%')
      expect(getComputedStyle(container.querySelector('.roboHeroBrand')!).maxWidth).toBe('100%')
    } finally { dispose() }
  })

  it('uses the sidebar brand slots and releases its style element', () => {
    const registrations: string[] = []
    const effects: (() => void)[] = []
    const slots = {
      inject: vi.fn((_name: string, factory: () => unknown) => {
        const result = factory()
        if (result !== null && typeof result === 'object' && Symbol.iterator in result) {
          return [...result as Iterable<unknown>]
        }
        return result
      }),
      register: vi.fn((options: { name: string }) => {
        registrations.push(options.name)
        return () => {}
      }),
    }
    const ctx = {
      slots,
      effect: (factory: () => (() => void)) => { effects.push(factory()) },
    } as unknown as ClientContext

    applyRoboBranding(ctx)

    expect(slots.inject.mock.calls.map(call => call[0])).toEqual([
      'sidebar.brand.mark',
      'sidebar.brand.name',
    ])
    expect(registrations).toEqual(['sidebar.brand.mark', 'sidebar.brand.name'])
    const styles = document.head.querySelector('[data-plugin-css="dsh-plugin-desktop/robo-brand"]')
    expect(styles).not.toBeNull()
    expect(styles?.textContent).toContain('[data-slot="conversation.hero.brand.mark"] .roboHeroBrand')
    expect(styles?.textContent).not.toMatch(/::(?:before|after)/u)
    effects.reverse().forEach(dispose => { dispose() })
    expect(document.head.querySelector('[data-plugin-css="dsh-plugin-desktop/robo-brand"]')).toBeNull()
  })
})
