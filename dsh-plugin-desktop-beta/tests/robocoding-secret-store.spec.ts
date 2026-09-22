import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { RoboCodingSecretStore } from '../src/robocoding-secret-store.ts'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

describe('OpenFox secret store', () => {
  it('persists only protected bytes and restores the refresh grant', async () => {
    const root = await mkdtemp(join(tmpdir(), 'robocoding-secret-')); roots.push(root)
    const path = join(root, 'account', 'session.bin')
    const protector = {
      available: () => true,
      seal: (value: string) => Buffer.from(value).map(byte => byte ^ 0x5a),
      open: (value: Uint8Array) => Buffer.from(Buffer.from(value).map(byte => byte ^ 0x5a)).toString('utf8'),
    }
    const store = new RoboCodingSecretStore(path, protector)
    await store.write({ refreshToken: 'refresh-secret', sessionId: 'session-1', platformOrigin: 'https://api.example.com' })
    expect((await readFile(path, 'utf8'))).not.toContain('refresh-secret')
    await expect(store.read()).resolves.toEqual({ refreshToken: 'refresh-secret', sessionId: 'session-1', platformOrigin: 'https://api.example.com' })
    await store.clear()
    await expect(store.read()).resolves.toBeUndefined()
  })

  it('keeps the grant in memory (session-only) when OS-backed protection is unavailable', async () => {
    const root = await mkdtemp(join(tmpdir(), 'robocoding-secret-')); roots.push(root)
    const store = new RoboCodingSecretStore(join(root, 'session.bin'), {
      available: () => false, seal: () => new Uint8Array(), open: () => '',
    })
    const secret = { refreshToken: 'refresh-secret', sessionId: 'session-1', platformOrigin: 'https://api.example.com' }
    await expect(store.write(secret)).resolves.toBeUndefined()
    await expect(store.read()).resolves.toEqual(secret)
    await store.clear()
    await expect(store.read()).resolves.toBeUndefined()
  })
})
