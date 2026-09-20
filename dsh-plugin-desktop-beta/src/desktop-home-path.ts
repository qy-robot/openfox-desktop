import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'

/** OpenFox-owned default home for profiles, settings, skills, and sessions. */
export const OPENFOX_HOME_DIRECTORY = '.openfox'

export function defaultOpenFoxHome(homeDirectory: string = homedir()): string {
  return resolve(join(homeDirectory, OPENFOX_HOME_DIRECTORY))
}

function configuredDshHome(environment: NodeJS.ProcessEnv): boolean {
  return Object.keys(environment).some(key => key.toUpperCase() === 'DSH_HOME'
    && environment[key] !== undefined)
}

/** Resolve an explicit DSH_HOME when supplied, otherwise use OpenFox's home. */
export function resolveOpenFoxHome(
  environment: NodeJS.ProcessEnv = process.env,
): string {
  return configuredDshHome(environment)
    ? resolveDshHome(undefined, environment)
    : defaultOpenFoxHome()
}

export function hasConfiguredDshHome(environment: NodeJS.ProcessEnv = process.env): boolean {
  return configuredDshHome(environment)
}
