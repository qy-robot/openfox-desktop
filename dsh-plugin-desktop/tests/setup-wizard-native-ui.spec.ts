import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  DesktopSetupWizardInput,
  DesktopSetupWizardSelection,
} from '../src/setup-wizard-contract.ts'
import {
  decodeDesktopSetupWizardInput,
  DESKTOP_SETUP_WIZARD_STEPS,
  nextDesktopSetupWizardStep,
  normalizeDesktopSetupWizardSelection,
  previousDesktopSetupWizardStep,
  SetupWizardNavigation,
  SetupWizardStepPage,
  SetupWizardSuccess,
  SetupWizardWelcome,
} from '../src/native-ui/setup-wizard/App.tsx'
import { desktopSetupWizardCopy } from '../src/setup-wizard-copy.ts'

const input: DesktopSetupWizardInput = {
  appVersion: '2.0.6-beta.1',
  profileName: 'work',
  platform: 'darwin',
  micaSupported: false,
  mode: 'extended',
  macosMaterial: 'transparent',
  windowsMaterial: 'off',
  openBrowser: false,
  networkExposure: 'loopback',
  aaEnabled: false,
  market: 'community-market',
  notifications: {
    enabled: true,
    notifyOnTurnCompletion: true,
    notifyOnTurnFailure: true,
    notifyOnJobCompletion: false,
    notifyOnJobFailure: true,
  },
}

const selection: DesktopSetupWizardSelection = {
  mode: input.mode,
  macosMaterial: input.macosMaterial,
  windowsMaterial: input.windowsMaterial,
  openBrowser: input.openBrowser,
  networkExposure: input.networkExposure,
  aaEnabled: false,
  market: input.market,
  notifications: input.notifications,
}

const copy = desktopSetupWizardCopy('zh')

function renderStep(
  step: Exclude<(typeof DESKTOP_SETUP_WIZARD_STEPS)[number], 'welcome' | 'success'>,
  current: DesktopSetupWizardSelection = selection,
): string {
  return renderToStaticMarkup(createElement(SetupWizardStepPage, {
    copy,
    input,
    selection: current,
    step,
    update: (_next: DesktopSetupWizardSelection) => {},
  }))
}

function occurrences(markup: string, fragment: string): number {
  return markup.split(fragment).length - 1
}

afterEach(() => { vi.unstubAllGlobals() })

describe('Setup Wizard step flow', () => {
  it('keeps only settings that apply to the unified extended shell', () => {
    expect(DESKTOP_SETUP_WIZARD_STEPS).toEqual([
      'welcome',
      'service',
      'material',
      'aa',
      'notifications',
      'success',
    ])
  })

  it('moves only between adjacent pages and stops at both boundaries', () => {
    expect(DESKTOP_SETUP_WIZARD_STEPS.map(step => previousDesktopSetupWizardStep(step))).toEqual([
      undefined,
      'welcome',
      'service',
      'material',
      'aa',
      'notifications',
    ])
    expect(DESKTOP_SETUP_WIZARD_STEPS.map(step => nextDesktopSetupWizardStep(step))).toEqual([
      'service',
      'material',
      'aa',
      'notifications',
      'success',
      undefined,
    ])
  })
})

describe('Setup Wizard welcome page', () => {
  it('identifies the Profile and explains why first-run Desktop setup is shown', () => {
    const markup = renderToStaticMarkup(createElement(SetupWizardWelcome, {
      appVersion: input.appVersion,
      copy,
      onSkip: () => {},
      onStart: () => {},
      profileName: input.profileName,
    }))
    expect(markup).toContain('data-setup-step="welcome"')
    expect(markup).toContain(copy.welcomeTitle)
    expect(markup).toContain(copy.beta)
    expect(markup).toContain(`v${input.appVersion}`)
    expect(markup).toContain('data-slot="badge"')
    expect(markup).toContain('data-beta-placement="title-bottom-right"')
    expect(markup).toContain('items-end')
    expect(markup).toContain('text-[10px]')
    expect(markup).toContain(copy.welcomeBody)
    expect(markup).toContain(copy.firstProfileSetup)
    expect(markup).toContain(copy.profile)
    expect(markup).toContain(input.profileName)
    expect(markup).toContain('text-left')
    expect(markup).not.toContain('text-center')
  })

  it('offers Start setup and confirmed Skip without ordinary arrow navigation', () => {
    const markup = renderToStaticMarkup(createElement(SetupWizardWelcome, {
      appVersion: input.appVersion,
      copy,
      onSkip: () => {},
      onStart: () => {},
      profileName: input.profileName,
    }))
    const navigation = renderToStaticMarkup(createElement(SetupWizardNavigation, {
      copy,
      onBack: () => {},
      onNext: () => {},
      onSkip: () => {},
      step: 'welcome',
    }))
    expect(markup).toContain(copy.startSetup)
    expect(markup).toContain(copy.skip)
    expect(markup).toContain('data-slot="dialog-trigger"')
    expect(markup).toContain('aria-haspopup="dialog"')
    expect(markup).not.toContain(`aria-label="${copy.back}"`)
    expect(markup).not.toContain(`aria-label="${copy.next}"`)
    expect(markup).not.toContain('lucide-arrow-left')
    expect(markup).not.toContain('lucide-arrow-right')
    expect(navigation).toBe('')
  })
})

describe('Setup Wizard setting pages', () => {
  it.each([
    ['service', 'serviceTitle', 'serviceBody'],
    ['material', 'windowMaterial', 'windowMaterialBody'],
    ['notifications', 'notificationsTitle', 'notificationsBody'],
  ] as const)('renders the %s page with its own title and subtitle', (step, title, body) => {
    const markup = renderStep(step)
    expect(markup).toContain(`data-setup-step="${step}"`)
    expect(markup).toContain(copy[title])
    expect(markup).toContain(copy[body])
    expect(occurrences(markup, 'data-setup-step=')).toBe(1)
  })

  it.each(['service', 'material', 'notifications'] as const)(
    'lays out the %s page options vertically',
    (step) => {
      expect(renderStep(step)).toContain('data-orientation="vertical"')
    },
  )

  it('presents account service first without collecting a provider key', () => {
    const service = renderStep('service')
    expect(service).toContain(copy.officialService)
    expect(service).toContain(copy.accountNextStep)
    expect(service).toContain(copy.customModels)
    expect(service).toContain('自动识别协议并获取模型列表')
    expect(service).not.toMatch(/<input|<textarea|type="password"/u)
    expect(service).not.toContain('DeepSeek')
  })

  it.each([
    ['material', copy.windowMaterial],
  ] as const)('uses a named shadcn RadioGroup for the %s choices', (step, accessibleName) => {
    const markup = renderStep(step)
    expect(markup).toContain('data-slot="radio-group"')
    expect(markup).toContain(`aria-label="${accessibleName}"`)
    expect(markup).toContain('data-slot="radio-group-item"')
  })

  it('removes plugin market setup and disables legacy market preferences', () => {
    expect(DESKTOP_SETUP_WIZARD_STEPS).not.toContain('market')
    expect(normalizeDesktopSetupWizardSelection(input)).toMatchObject({ market: 'disabled' })
    for (const step of ['service', 'material', 'aa', 'notifications'] as const) {
      const markup = renderStep(step)
      expect(markup).not.toContain(copy.marketTitle)
      expect(markup).not.toContain(copy.communityMarket)
      expect(markup).not.toContain(copy.dshMarket)
      expect(markup).not.toContain('setup-plugin-market')
    }
  })

  it('uses the shadcn Switch component for every wizard toggle', () => {
    const notifications = renderStep('notifications')
    expect(occurrences(notifications, 'data-slot="switch"')).toBe(5)
    expect(occurrences(notifications, 'role="switch"')).toBe(5)
  })
})

describe('Setup Wizard navigation and completion', () => {
  it('shows Skip on the left and back/forward arrow buttons on every setting page', () => {
    for (const step of DESKTOP_SETUP_WIZARD_STEPS.slice(1, -1)) {
      const markup = renderToStaticMarkup(createElement(SetupWizardNavigation, {
        copy,
        onBack: () => {},
        onNext: () => {},
        onSkip: () => {},
        step,
      }))
      expect(markup).toContain(copy.skip)
      expect(markup).toContain(`aria-label="${copy.back}"`)
      expect(markup).toContain(`aria-label="${copy.next}"`)
      expect(markup).toContain('lucide-arrow-left')
      expect(markup).toContain('lucide-arrow-right')
      expect(markup.indexOf(copy.skip)).toBeLessThan(markup.indexOf(`aria-label="${copy.back}"`))
    }
  })

  it('lets the first setting page return to the welcome page', () => {
    const markup = renderToStaticMarkup(createElement(SetupWizardNavigation, {
      copy,
      onBack: () => {},
      onNext: () => {},
      onSkip: () => {},
      step: 'service',
    }))
    expect(markup).toContain(`aria-label="${copy.back}"`)
    expect(markup).not.toMatch(new RegExp(`<button[^>]+aria-label="${copy.back}"[^>]+disabled=""`, 'u'))
  })

  it('uses a dialog trigger for Skip and explains where setup remains available', () => {
    const markup = renderToStaticMarkup(createElement(SetupWizardNavigation, {
      copy,
      onBack: () => {},
      onNext: () => {},
      onSkip: () => {},
      step: 'aa',
    }))
    expect(markup).toContain('data-slot="dialog-trigger"')
    expect(markup).toContain('aria-haspopup="dialog"')
    expect(copy.skipDialogBody).toContain('设置')
    expect(copy.skipDialogBody).toContain('桌面设置')
  })

  it('renders only centered success and Start using controls on the final page', () => {
    const success = renderToStaticMarkup(createElement(SetupWizardSuccess, {
      copy,
      onStart: () => {},
    }))
    const navigation = renderToStaticMarkup(createElement(SetupWizardNavigation, {
      copy,
      onBack: () => {},
      onNext: () => {},
      onSkip: () => {},
      step: 'success',
    }))
    expect(success).toContain('data-setup-step="success"')
    expect(success).toContain('data-align="center"')
    expect(success).toContain(copy.successTitle)
    expect(success).toContain(copy.successBody)
    expect(success).toContain(copy.startUsing)
    expect(success).not.toContain(copy.skip)
    expect(success).not.toContain(`aria-label="${copy.back}"`)
    expect(success).not.toContain(`aria-label="${copy.next}"`)
    expect(navigation).toBe('')
  })
})

describe('Setup Wizard native UI boundaries', () => {
  it('decodes only the exact bounded state tuple emitted by the owner window', () => {
    vi.stubGlobal('window', { atob: globalThis.atob })
    const state = Buffer.from(JSON.stringify(input), 'utf8').toString('base64url')
    const valid = `?locale=zh&state=${state}&platform=darwin&frame=true`
    expect(decodeDesktopSetupWizardInput(valid)).toEqual(input)
    expect(decodeDesktopSetupWizardInput(`${valid}&unexpected=true`)).toBeUndefined()
    expect(decodeDesktopSetupWizardInput(valid.replace('platform=darwin', 'platform=win32'))).toBeUndefined()
    expect(decodeDesktopSetupWizardInput(valid.replace('locale=zh', 'locale=fr'))).toBeUndefined()
    expect(decodeDesktopSetupWizardInput(valid.replace('frame=true', 'frame=yes'))).toBeUndefined()
  })
})

it('offers AA opt-in with a Beta badge after the material page', () => {
  const html = renderStep('aa')
  expect(html).toContain('Agents-Anywhere')
  expect(html).toContain('Beta')
  expect(html).toContain('setup-aa-false')
  expect(html).toContain('setup-aa-true')
})
