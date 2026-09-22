import type { NativeImage } from 'electron'
import { describe, expect, it } from 'vitest'
import type { DesktopShellSpec } from '../src/runtime.ts'
import {
  DESKTOP_RENDERER_SESSION_PARTITION,
  desktopWindowOptions,
  extendedWindowOptions,
} from '../src/window-options.ts'
import { DESKTOP_FRAME_HEIGHT, DESKTOP_FRAME_MACOS_TRAFFIC_LIGHT_TOP } from '../src/window-chrome.ts'

const spec: DesktopShellSpec = {
  mode: 'extended',
  macosMaterial: 'transparent',
  windowsMaterial: 'off',
  material: 'off',
  width: 1280,
  height: 840,
  minWidth: 900,
  minHeight: 640,
  url: 'http://127.0.0.1:43120/?dsh-desktop-mode=extended',
  authenticationUrl: 'http://127.0.0.1:43120/?token=test-token',
  rendererAccessHeader: {
    name: 'x-dsh-desktop-renderer',
    value: Buffer.alloc(32, 8).toString('base64url'),
  },
  productName: 'OpenFox',
  windowTitle: 'OpenFox',
  iconPath: '/tmp/app-icon.png',
  trayIcons: {
    templatePath: '/tmp/tray-iconTemplate.png',
    bluePath: '/tmp/tray-icon-blue.png',
  },
  readLocalePreference: () => undefined,
  readThemeSource: () => 'system',
  requestQuit: () => {},
}

const preload = '/tmp/preload.cjs'

describe('extended BrowserWindow options', () => {
  it('uses the independent 36px frame and renderer isolation on macOS', () => {
    const icon = {} as NativeImage
    const options = extendedWindowOptions(spec, icon, 'darwin', preload)
    expect(options).toEqual(expect.objectContaining({
      title: '', width: 1280, height: 840, minWidth: 900, minHeight: 640,
      show: false, backgroundColor: '#202124', icon,
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 16, y: DESKTOP_FRAME_MACOS_TRAFFIC_LIGHT_TOP },
      webPreferences: {
        preload, contextIsolation: true, nodeIntegration: false, sandbox: true,
        webSecurity: true, partition: DESKTOP_RENDERER_SESSION_PARTITION,
      },
    }))
    expect(DESKTOP_FRAME_HEIGHT).toBe(36)
    expect(desktopWindowOptions(spec, icon, 'darwin', preload)).toEqual(options)
  })

  it('reveals transparent material behind the macOS extended frame', () => {
    const options = extendedWindowOptions(
      { ...spec, material: 'transparent' }, {} as NativeImage, 'darwin', preload,
    )
    expect(options).toEqual(expect.objectContaining({
      transparent: true,
      backgroundColor: '#00000000',
      vibrancy: 'sidebar',
      visualEffectState: 'followWindow',
    }))
  })

  it('uses native Windows controls and capability-gated Mica', () => {
    const options = extendedWindowOptions(
      { ...spec, material: 'mica', windowsBuild: 22_621 }, {} as NativeImage, 'win32', preload,
    )
    expect(options).toEqual(expect.objectContaining({
      titleBarStyle: 'hidden',
      titleBarOverlay: expect.objectContaining({ height: DESKTOP_FRAME_HEIGHT }),
      backgroundMaterial: 'mica',
      hasShadow: true,
      roundedCorners: true,
      thickFrame: true,
    }))
  })

  it('rejects the unsupported Linux presentation', () => {
    expect(() => extendedWindowOptions(spec, {} as NativeImage, 'linux', preload))
      .toThrow('supported on macOS and Windows')
  })
})
