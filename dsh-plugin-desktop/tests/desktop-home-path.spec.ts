import { describe, expect, it } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defaultOpenFoxHome, resolveOpenFoxHome } from '../src/desktop-home-path.ts'

describe('OpenFox Home path', () => {
  it('uses .openfox as the application-owned default', () => {
    const home = defaultOpenFoxHome('C:\\Users\\Example')
    expect(home.toLowerCase()).toContain('.openfox')
    expect(home.toLowerCase()).not.toContain('.dsh')
  })

  it('keeps an explicitly configured DSH_HOME as a compatibility override', () => {
    const configured = join(tmpdir(), 'openfox-custom-home')
    expect(resolveOpenFoxHome({ DSH_HOME: configured })).toBe(configured)
  })
})
