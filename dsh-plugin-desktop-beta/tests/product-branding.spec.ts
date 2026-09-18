import { describe, expect, it } from 'vitest'
import {
  DESKTOP_APP_ID,
  DESKTOP_BRAND_BYLINE,
  DESKTOP_DISPLAY_NAME,
  DESKTOP_PACKAGE_NAME,
  DESKTOP_PRODUCT_NAME,
} from '../src/product-identity.ts'

describe('Desktop product branding', () => {
  it('changes public copy without migrating the Beta installation identity', () => {
    expect(DESKTOP_DISPLAY_NAME).toBe('RoboCoding Beta')
    expect(DESKTOP_BRAND_BYLINE).toBe('by擎云机器人')
    expect(DESKTOP_PACKAGE_NAME).toBe('dsh-plugin-desktop-beta')
    expect(DESKTOP_PRODUCT_NAME).toBe('DSH Desktop Beta')
    expect(DESKTOP_APP_ID).toBe('ai.deepseek.dsh.desktop.beta')
  })
})
