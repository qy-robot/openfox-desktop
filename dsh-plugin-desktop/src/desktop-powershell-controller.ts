/** Host-owned PTY sessions used by the Windows PowerShell sidebar. */

import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { spawn as spawnNodePty, type IPty, type IPtyForkOptions } from 'node-pty'
import stripAnsi from 'strip-ansi'
import type {
  DesktopPowerShellOpenResponse,
  DesktopPowerShellReadResponse,
  DesktopPowerShellTarget,
} from './desktop-powershell-contract.ts'

const MAX_SESSIONS = 4
const MAX_OUTPUT_CHARS = 1_000_000
const MAX_WRITE_CHARS = 64 * 1024

export interface DesktopPowerShellPty {
  readonly pid: number
  onData(listener: (data: string) => void): { dispose(): void }
  onExit(listener: (event: { exitCode: number; signal?: number }) => void): { dispose(): void }
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(signal?: string): void
}

export type DesktopPowerShellPtySpawn = (
  executable: string,
  args: readonly string[],
  options: IPtyForkOptions,
) => DesktopPowerShellPty

export interface DesktopPowerShellControllerOptions {
  readonly platform?: NodeJS.Platform
  readonly environment?: NodeJS.ProcessEnv
  readonly cwd?: string
  readonly exists?: (path: string) => boolean
  readonly spawnPty?: DesktopPowerShellPtySpawn
}

interface SessionRecord {
  readonly id: string
  readonly target: DesktopPowerShellTarget
  readonly pty: DesktopPowerShellPty
  output: string
  baseOffset: number
  exited: boolean
  exitCode?: number
  readonly disposers: { dispose(): void }[]
}

function environmentPath(environment: NodeJS.ProcessEnv): string {
  return environment.Path ?? environment.PATH ?? ''
}

function executableCandidates(command: string, environment: NodeJS.ProcessEnv): string[] {
  const candidates = environmentPath(environment).split(delimiter).filter(Boolean).map(directory => join(directory, command))
  const systemRoot = environment.SystemRoot ?? environment.WINDIR
  if (systemRoot !== undefined) {
    if (command === 'ssh.exe') candidates.unshift(join(systemRoot, 'System32', 'OpenSSH', command))
    if (command === 'powershell.exe') candidates.unshift(join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', command))
  }
  if (command === 'pwsh.exe' && environment.ProgramFiles !== undefined) {
    candidates.unshift(join(environment.ProgramFiles, 'PowerShell', '7', command))
  }
  return [...new Set(candidates)]
}

/** Resolve an executable to an absolute trusted path without invoking a command shell. */
export function resolveDesktopTerminalExecutable(
  commands: readonly string[],
  environment: NodeJS.ProcessEnv = process.env,
  exists: (path: string) => boolean = existsSync,
): string {
  for (const command of commands) {
    const found = executableCandidates(command, environment).find(exists)
    if (found !== undefined) return found
  }
  throw new Error(`desktop terminal executable not found: ${commands.join(', ')}`)
}

export function desktopPowerShellLaunch(
  target: DesktopPowerShellTarget,
  environment: NodeJS.ProcessEnv = process.env,
  exists: (path: string) => boolean = existsSync,
): { readonly executable: string; readonly args: readonly string[] } {
  if (target.kind === 'local') {
    return {
      executable: resolveDesktopTerminalExecutable(['pwsh.exe', 'powershell.exe'], environment, exists),
      args: ['-NoLogo', '-NoExit', '-ExecutionPolicy', 'Bypass'],
    }
  }
  const executable = resolveDesktopTerminalExecutable(['ssh.exe'], environment, exists)
  const args = ['-tt', '-o', 'ServerAliveInterval=30', '-o', 'ServerAliveCountMax=3']
  if (target.ssh.port !== undefined) args.push('-p', String(target.ssh.port))
  if (target.ssh.identityFile !== undefined) args.push('-i', target.ssh.identityFile)
  args.push(target.ssh.user === undefined ? target.ssh.host : `${target.ssh.user}@${target.ssh.host}`)
  return { executable, args }
}

function cleanOutput(data: string): string {
  return stripAnsi(data).replaceAll('\r\n', '\n').replaceAll('\r', '\n')
}

function dimensions(value: number, min: number, max: number): number {
  if (!Number.isInteger(value) || value < min || value > max) throw new Error('invalid terminal dimensions')
  return value
}

/** Own the native PTY lifetime; renderer requests only reference opaque session ids. */
export class DesktopPowerShellController {
  private readonly sessions = new Map<string, SessionRecord>()
  private readonly platform: NodeJS.Platform
  private readonly environment: NodeJS.ProcessEnv
  private readonly cwd: string
  private readonly exists: (path: string) => boolean
  private readonly spawnPty: DesktopPowerShellPtySpawn
  private disposed = false

  constructor(options: DesktopPowerShellControllerOptions = {}) {
    this.platform = options.platform ?? process.platform
    this.environment = { ...(options.environment ?? process.env), TERM: 'xterm-256color' }
    this.cwd = options.cwd ?? this.environment.USERPROFILE ?? process.cwd()
    this.exists = options.exists ?? existsSync
    this.spawnPty = options.spawnPty ?? ((executable, args, ptyOptions) => spawnNodePty(executable, [...args], ptyOptions) as IPty)
  }

  open(target: DesktopPowerShellTarget, cols: number, rows: number): DesktopPowerShellOpenResponse {
    this.assertActive()
    if (this.platform !== 'win32') throw new Error('embedded PowerShell is supported only on Windows')
    if (this.sessions.size >= MAX_SESSIONS) throw new Error('too many terminal sessions')
    const size = { cols: dimensions(cols, 20, 400), rows: dimensions(rows, 5, 200) }
    const launch = desktopPowerShellLaunch(target, this.environment, this.exists)
    const pty = this.spawnPty(launch.executable, launch.args, {
      name: 'xterm-256color', cols: size.cols, rows: size.rows, cwd: this.cwd,
      env: Object.fromEntries(Object.entries(this.environment).filter((entry): entry is [string, string] => entry[1] !== undefined)),
    })
    const id = randomUUID()
    const record: SessionRecord = { id, target, pty, output: '', baseOffset: 0, exited: false, disposers: [] }
    this.sessions.set(id, record)
    try {
      // node-pty may emit startup output while a listener is being attached.
      // Publish the record first so that even synchronous early output is kept.
      record.disposers.push(pty.onData(data => { this.append(record, cleanOutput(data)) }))
      record.disposers.push(pty.onExit(event => {
        record.exited = true
        record.exitCode = event.exitCode
        this.append(record, `\n[终端已退出，代码 ${String(event.exitCode)}]\n`)
      }))
    } catch (cause) {
      this.sessions.delete(id)
      for (const disposer of record.disposers) disposer.dispose()
      pty.kill()
      throw cause
    }
    return { sessionId: id, target, output: record.output, offset: record.baseOffset + record.output.length }
  }

  read(sessionId: string, offset: number): DesktopPowerShellReadResponse {
    const record = this.expect(sessionId)
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('invalid terminal offset')
    const end = record.baseOffset + record.output.length
    const truncated = offset < record.baseOffset
    const begin = truncated ? 0 : Math.min(offset - record.baseOffset, record.output.length)
    return { output: record.output.slice(begin), offset: end, truncated, exited: record.exited,
      ...(record.exitCode === undefined ? {} : { exitCode: record.exitCode }) }
  }

  write(sessionId: string, data: string): void {
    const record = this.expect(sessionId)
    if (record.exited) throw new Error('terminal has exited')
    if (data.length === 0 || data.length > MAX_WRITE_CHARS || data.includes('\0')) throw new Error('invalid terminal input')
    record.pty.write(data)
  }

  resize(sessionId: string, cols: number, rows: number): void {
    const record = this.expect(sessionId)
    if (record.exited) return
    record.pty.resize(dimensions(cols, 20, 400), dimensions(rows, 5, 200))
  }

  close(sessionId: string): void {
    const record = this.sessions.get(sessionId)
    if (record === undefined) return
    this.sessions.delete(sessionId)
    for (const disposer of record.disposers) disposer.dispose()
    if (!record.exited) record.pty.kill()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const id of [...this.sessions.keys()]) this.close(id)
  }

  private append(record: SessionRecord, data: string): void {
    if (data.length === 0 || !this.sessions.has(record.id)) return
    record.output += data
    if (record.output.length <= MAX_OUTPUT_CHARS) return
    const remove = record.output.length - MAX_OUTPUT_CHARS
    record.output = record.output.slice(remove)
    record.baseOffset += remove
  }

  private expect(sessionId: string): SessionRecord {
    this.assertActive()
    const record = this.sessions.get(sessionId)
    if (record === undefined) throw new Error('terminal session not found')
    return record
  }

  private assertActive(): void {
    if (this.disposed) throw new Error('terminal controller disposed')
  }
}
