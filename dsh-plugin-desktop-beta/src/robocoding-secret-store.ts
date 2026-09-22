import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { RoboCodingAccountSecret } from './robocoding-account-controller.ts'

export interface RoboCodingSecretProtector {
  readonly available: () => boolean
  readonly seal: (plaintext: string) => Uint8Array
  readonly open: (sealed: Uint8Array) => string
}

function parseSecret(value: unknown): RoboCodingAccountSecret {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('invalid account secret')
  const row = value as Record<string, unknown>
  if (typeof row.refreshToken !== 'string' || row.refreshToken === '' || typeof row.sessionId !== 'string' || row.sessionId === '') {
    throw new TypeError('invalid account secret')
  }
  if (typeof row.platformOrigin !== 'string' || row.platformOrigin === '') throw new TypeError('invalid account secret')
  return { refreshToken: row.refreshToken, sessionId: row.sessionId, platformOrigin: row.platformOrigin }
}

export class RoboCodingSecretStore {
  /** Session-only grant retained in memory when no OS-backed protector exists. */
  private sessionSecret: RoboCodingAccountSecret | undefined

  constructor(private readonly path: string, private readonly protector: RoboCodingSecretProtector) {}

  async read(): Promise<RoboCodingAccountSecret | undefined> {
    // Without an OS-backed protector there is no persisted secret; serve the
    // in-memory grant so a session-only login keeps working across refreshes.
    if (!this.protector.available()) return this.sessionSecret
    let sealed: Buffer
    try { sealed = await readFile(this.path) } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw cause
    }
    return parseSecret(JSON.parse(this.protector.open(sealed)) as unknown)
  }

  async write(secret: RoboCodingAccountSecret): Promise<void> {
    if (!this.protector.available()) {
      // Session-only: keep the grant in memory, never persist without a protector.
      this.sessionSecret = parseSecret(secret)
      return
    }
    const validated = parseSecret(secret)
    const sealed = this.protector.seal(JSON.stringify(validated))
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 })
    const temporary = `${this.path}.${String(process.pid)}.tmp`
    await writeFile(temporary, sealed, { mode: 0o600, flag: 'w' })
    await rename(temporary, this.path)
  }

  async clear(): Promise<void> {
    this.sessionSecret = undefined
    try { await unlink(this.path) } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause
    }
  }
}
