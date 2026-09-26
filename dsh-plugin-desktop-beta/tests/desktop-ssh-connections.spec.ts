import { describe, expect, it, vi } from 'vitest'
import { createDesktopSshConnections, parseDesktopSshConnections } from '../src/client/desktop-ssh-connections.ts'

class MemoryStorage implements Pick<Storage, 'getItem' | 'setItem'> {
  value: string | null = null
  getItem = vi.fn(() => this.value)
  setItem = vi.fn((_key: string, value: string) => { this.value = value })
}

describe('desktop SSH connection history', () => {
  it('parses valid profiles, drops password fields, and sorts the newest first', () => {
    const parsed = parseDesktopSshConnections(JSON.stringify([
      { id: 'older', label: 'Lab robot', host: '192.0.2.10', user: 'robot', port: 22, lastConnectedAt: 10, password: 'never-store' },
      { id: 'newer', label: 'Bumi', host: 'robot.local', port: 2222, lastConnectedAt: 20 },
    ]))
    expect(parsed.map(profile => profile.id)).toEqual(['newer', 'older'])
    expect(parsed[1]).toEqual({ id: 'older', label: 'Lab robot', host: '192.0.2.10', user: 'robot', port: 22, lastConnectedAt: 10 })
    expect(JSON.stringify(parsed)).not.toContain('never-store')
  })

  it('rejects unsafe hosts, users, ports, and duplicate ids', () => {
    const profile = { id: 'one', label: 'Robot', host: 'robot.local', user: 'robot', port: 22, lastConnectedAt: 1 }
    expect(parseDesktopSshConnections(JSON.stringify([{ ...profile, host: '-oProxyCommand=bad' }]))).toEqual([])
    expect(parseDesktopSshConnections(JSON.stringify([{ ...profile, host: 'robot@other' }]))).toEqual([])
    expect(parseDesktopSshConnections(JSON.stringify([{ ...profile, user: 'bad user' }]))).toEqual([])
    expect(parseDesktopSshConnections(JSON.stringify([{ ...profile, port: 70_000 }]))).toEqual([])
    expect(parseDesktopSshConnections(JSON.stringify([profile, profile]))).toEqual([])
  })

  it('upserts, removes, and never persists a supplied password property', () => {
    const storage = new MemoryStorage()
    const connections = createDesktopSshConnections(storage)
    connections.upsert({ id: 'robot-1', label: 'Robot 1', host: '192.0.2.20', user: 'operator', port: 22,
      lastConnectedAt: 10, password: 'top-secret' } as never)
    connections.upsert({ id: 'robot-2', label: 'Robot 2', host: '192.0.2.21', lastConnectedAt: 20 })
    expect(connections.getSnapshot().map(profile => profile.id)).toEqual(['robot-2', 'robot-1'])
    expect(storage.value).not.toContain('top-secret')
    expect(storage.value).not.toContain('password')
    connections.remove('robot-2')
    expect(connections.getSnapshot().map(profile => profile.id)).toEqual(['robot-1'])
    connections.dispose()
  })
})
