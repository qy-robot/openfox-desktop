/** DSH Desktop Host plugin: owns the selected native shell generation. */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-cmdline'
import {
  LOCALE_SETTINGS_NAMESPACE,
  type LocaleSettings,
} from '@deepseek-ai/dsh-client-locale'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-llm'
import {
  THEME_SETTINGS_NAMESPACE,
  type ThemeSettings,
} from '@deepseek-ai/dsh-client-ui-theme'
import {
  handleRendererBootRequest,
  RENDERER_BOOT_REPORT_PATH,
} from './renderer-boot.ts'
import {
  DESKTOP_DIRECTORY_PICKER_PATH,
  DESKTOP_DIRECTORY_VALIDATOR_PATH,
} from './directory-picker-contract.ts'
import {
  handleDesktopDirectoryPickerRequest,
  handleDesktopDirectoryValidationRequest,
} from './directory-picker-route.ts'
import { DESKTOP_WINDOW_CONTROLS_PATH } from './window-controls-contract.ts'
import { handleDesktopWindowControlRequest } from './window-controls-route.ts'
import {
  DESKTOP_DIAGNOSTICS_EXPORT_PATH,
  DESKTOP_DEVELOPER_TOOLS_TOGGLE_PATH,
  DESKTOP_AA_SELECT_PATH,
  DESKTOP_MARKET_SELECT_PATH,
  DESKTOP_PROFILE_CREATE_PATH,
  DESKTOP_PROFILE_DELETE_PATH,
  DESKTOP_PROFILE_SELECT_PATH,
  DESKTOP_RESTART_PATH,
  DESKTOP_RECOVERY_RESTART_PATH,
  DESKTOP_RENDERER_RELOAD_PATH,
  DESKTOP_SETTINGS_PATH,
  DESKTOP_TERMINAL_OPEN_PATH,
} from './desktop-settings-contract.ts'
import {
  handleDesktopDiagnosticsExportRequest,
  handleDesktopDeveloperToolsToggleRequest,
  handleDesktopAaSelectRequest,
  handleDesktopMarketSelectRequest,
  handleDesktopProfileCreateRequest,
  handleDesktopProfileDeleteRequest,
  handleDesktopProfileSelectRequest,
  handleDesktopRestartRequest,
  handleDesktopRecoveryRestartRequest,
  handleDesktopRendererReloadRequest,
  handleDesktopSettingsRequest,
  handleDesktopTerminalOpenRequest,
} from './desktop-settings-route.ts'
import type {} from './desktop-settings-controller.ts'
import { DESKTOP_LAN_HTTPS_CA_PATH } from './lan-https-runtime.ts'
import { desktopBootRecoveryInjections } from './desktop-boot-recovery.ts'
import type { DesktopLocale, DesktopShellMode } from './runtime.ts'
import type {} from './runtime.ts'
import { DESKTOP_DEFAULT_WEB_PORT } from './desktop-port.ts'
import {
  desktopBrowserAccessEnabled,
  desktopBrowserAccessAvailable,
  desktopNetworkExposureForBrowserAccess,
  desktopWebServerHost,
  type DesktopNetworkExposure,
} from './desktop-network.ts'
import { DESKTOP_FRAME_HEIGHT } from './window-chrome.ts'
import {
  DEFAULT_MACOS_WINDOW_MATERIAL,
  DEFAULT_WINDOWS_WINDOW_MATERIAL,
  effectiveDesktopWindowMaterial,
  type DesktopWindowMaterial,
  type MacosWindowMaterial,
  type PersistedWindowsWindowMaterial,
  windowsSupportsMica,
} from './window-material.ts'
import { DESKTOP_DISPLAY_NAME } from './product-identity.ts'
import {
  handleRoboSkillsProxyRequest,
  ROBO_DEVICES_CATALOG_PATH,
  ROBO_SKILLS_CATALOG_PATH,
  ROBO_SKILLS_DEMO_RUNS_PATH,
  ROBO_SKILLS_RUNS_PATH,
} from './robo-skills-proxy.ts'
import {
  handleRoboLocalSkillPickerRequest,
  handleRoboLocalSkillsRequest,
  ROBO_LOCAL_SKILLS_PATH,
  ROBO_LOCAL_SKILLS_PICK_DIRECTORY_PATH,
} from './robo-local-skills.ts'
import {
  ROBOCODING_ACCOUNT_FUNDING_PATH,
  ROBOCODING_ACCOUNT_LOGIN_PATH,
  ROBOCODING_ACCOUNT_LOGOUT_PATH,
  ROBOCODING_ACCOUNT_PATH,
  ROBOCODING_ACCOUNT_PLATFORM_PATH,
  ROBOCODING_ACCOUNT_REFRESH_PATH,
} from './robocoding-account-contract.ts'
import {
  DEFAULT_ROBOCODING_PLATFORM_URL,
  RoboCodingAccountController,
  type RoboCodingAccountSettings,
} from './robocoding-account-controller.ts'
import { handleRoboCodingAccountRequest } from './robocoding-account-route.ts'
import { RoboCodingLlmRegistration } from './robocoding-llm.ts'
import { installRoboCloudSkills } from './robo-cloud-skills.ts'

/** Stable Cordis plugin name. */
export const name = 'desktop-shell'

/** Services required before the shell can register its renderer generation. */
/** Services required by the desktop shell; `desktopRuntime` is probed, not required. */
export const inject = ['webServer', 'webRuntime', 'appExit', 'settings', 'connection']

/** Standard settings namespace shared by tray and configuration surfaces. */
export const DESKTOP_SETTINGS_NAMESPACE = 'dsh-desktop'

const UI_THEME_SETTINGS_NAMESPACE = THEME_SETTINGS_NAMESPACE
const UI_LOCALE_SETTINGS_NAMESPACE = LOCALE_SETTINGS_NAMESPACE

/** Apply the official Connection trust and browser-auth fence before a private Desktop route. */
function rejectDesktopRequest(
  ctx: Context,
  req: IncomingMessage,
  res: ServerResponse,
): boolean {
  const rejection = ctx.connection.requestRejection(req)
  if (rejection === undefined) return false
  res.writeHead(rejection)
  res.end(rejection === 401 ? 'unauthorized' : 'forbidden')
  return true
}

/** Narrow the upstream locale preference to the translations bundled by Desktop chrome. */
function desktopLocalePreference(preference: string | undefined): DesktopLocale | undefined {
  return preference === 'zh' || preference === 'en' ? preference : undefined
}

/** Desktop settings presented by the standard settings service. */
export interface DesktopSettings {
  /** Native presentation selected for the next application generation. */
  mode: DesktopShellMode
  /** Native translucency preference used on macOS custom-chrome modes. */
  macosMaterial: MacosWindowMaterial
  /** Native backdrop preference used on Windows custom-chrome modes. */
  windowsMaterial: PersistedWindowsWindowMaterial
  /** Loopback Web port selected for the next application generation; zero requests a random port. */
  port: number
  /** Whether Desktop advertises its marker-free compatibility client for browser use. */
  openBrowser: boolean
  /** Whether the next generation listens only on loopback or on every LAN interface. */
  networkExposure: DesktopNetworkExposure
  /** Log verbosity threshold applied to the file logger. */
  logLevel: 'debug' | 'info' | 'warn' | 'error'
}

/** Schema registered with the standard settings service. */
export const DesktopSettingsSchema: z<DesktopSettings> = z.object({
  mode: z.union(['compatibility', 'extended', 'advanced'] as const).default('advanced'),
  macosMaterial: z.union(['off', 'transparent'] as const).default(DEFAULT_MACOS_WINDOW_MATERIAL),
  windowsMaterial: z.union(['off', 'acrylic', 'mica'] as const).default(DEFAULT_WINDOWS_WINDOW_MATERIAL),
  port: z.number().step(1).min(0).max(65_535).default(DESKTOP_DEFAULT_WEB_PORT),
  openBrowser: z.boolean().default(false),
  networkExposure: z.union(['loopback', 'lan'] as const).default('loopback'),
  logLevel: z.union(['debug', 'info', 'warn', 'error'] as const).default('info'),
})

const RoboCodingAccountSettingsSchema: z<RoboCodingAccountSettings> = z.object({
  platformUrl: z.string().default(process.env.ROBOCODING_PLATFORM_URL || DEFAULT_ROBOCODING_PLATFORM_URL),
  fundingMode: z.union(['personal_only', 'team_only'] as const).default('personal_only'),
  teamId: z.number().step(1).min(0).default(0),
  confirmedTeamId: z.number().step(1).min(0).default(0),
  confirmedUserId: z.number().step(1).min(0).default(0),
})

/** Native window configuration. */
export interface Config {
  /** Native presentation mode selected before BrowserWindow construction. */
  mode: DesktopShellMode
  /** Native translucency preference used on macOS custom-chrome modes. */
  macosMaterial: MacosWindowMaterial
  /** Native backdrop preference used on Windows custom-chrome modes. */
  windowsMaterial: PersistedWindowsWindowMaterial
  /** Configured loopback Web port used to detect restart-applied settings changes. */
  port: number
  /** Configured listener exposure used to detect restart-applied settings changes. */
  networkExposure: DesktopNetworkExposure
  /** Initial window width in CSS pixels. */
  width: number
  /** Initial window height in CSS pixels. */
  height: number
  /** Minimum window width in CSS pixels. */
  minWidth: number
  /** Minimum window height in CSS pixels. */
  minHeight: number
}

/** Validated native window configuration. */
export const Config: z<Config> = z.object({
  mode: z.union(['compatibility', 'extended', 'advanced'] as const).default('advanced'),
  macosMaterial: z.union(['off', 'transparent'] as const).default(DEFAULT_MACOS_WINDOW_MATERIAL),
  windowsMaterial: z.union(['off', 'acrylic', 'mica'] as const).default(DEFAULT_WINDOWS_WINDOW_MATERIAL),
  port: z.number().step(1).min(0).max(65_535).default(DESKTOP_DEFAULT_WEB_PORT),
  networkExposure: z.union(['loopback', 'lan'] as const).default('loopback'),
  width: z.number().step(1).min(800).default(1280),
  height: z.number().step(1).min(600).default(840),
  minWidth: z.number().step(1).min(640).default(900),
  minHeight: z.number().step(1).min(480).default(640),
})

/**
 * Construct the unmodified upstream Web root URL.
 * @param port - active loopback Web server port.
 * @param mode - active native presentation mode.
 * @param platform - active Electron platform.
 * @returns the URL loaded by the BrowserWindow.
 */
export function desktopRendererUrl(
  port: number,
  mode: DesktopShellMode,
  platform: Context['desktopRuntime']['platform'],
  appVersion: string,
  material: DesktopWindowMaterial = 'off',
  windowsBuild?: number,
): string {
  const url = new URL(`http://127.0.0.1:${String(port)}/`)
  url.searchParams.set('dsh-desktop-mode', mode)
  url.searchParams.set('dsh-desktop-platform', platform)
  url.searchParams.set('dsh-desktop-version', appVersion)
  url.searchParams.set('dsh-desktop-material', material)
  if (mode === 'extended' || (mode === 'compatibility' && platform !== 'linux')) {
    // Body-level plugin portals do not inherit the framed root's geometry.
    // Publish the exact content boundary so they can yield Desktop chrome.
    url.searchParams.set('dsh-desktop-titlebar-inset', String(DESKTOP_FRAME_HEIGHT))
  }
  if (platform === 'win32') {
    url.searchParams.set('dsh-desktop-mica', windowsSupportsMica(windowsBuild) ? '1' : '0')
  }
  return url.href
}

/**
 * Register the Electron shell from active Web carrier values.
 * @param ctx - Host context carrying the Electron adapter and Web carrier.
 * @param config - validated native window values.
 */
export function apply(ctx: Context, config: Config): void {
  const runtime = ctx.get('desktopRuntime')
  if (runtime === undefined) {
    process.stderr.write(
      'dsh-plugin-desktop: this profile is composed with the DSH Desktop shell, which requires the desktop launcher (desktopRuntime).\n'
      + 'Start it with `dsh-desktop`, or select this profile inside the packaged DSH Desktop application.\n'
      + 'The desktop terminal, profile, and update rows stay inactive in an ordinary DSH boot.\n',
    )
    return
  }
  ctx.inject(['skills'], skillsCtx => {
    skillsCtx.effect(
      () => installRoboCloudSkills(skillsCtx),
      'dsh-plugin-desktop: OpenFox cloud skill provider',
    )
  })
  const appExit = ctx.get('appExit')
  if (appExit === undefined) {
    throw new Error('dsh-plugin-desktop: the launcher did not provide ctx.appExit')
  }
  const browserAccess = ctx.get('desktopBrowserAccess')
  if (browserAccess === undefined) {
    throw new Error('dsh-plugin-desktop: the launcher did not provide ctx.desktopBrowserAccess')
  }
  const lanHttps = ctx.get('desktopLanHttps')
  if (lanHttps === undefined) {
    throw new Error('dsh-plugin-desktop: the launcher did not provide ctx.desktopLanHttps')
  }
  if (ctx.webServer.host !== desktopWebServerHost(config.networkExposure)) {
    throw new Error('dsh-plugin-desktop: desktop shell WebServer host does not match networkExposure')
  }
  lanHttps.attach(ctx.webServer.port)
  const iconFilename = runtime.platform === 'darwin'
    ? 'app-icon-mac.png'
    : 'app-icon.png'
  const iconPath = fileURLToPath(new URL(`../build/${iconFilename}`, import.meta.url))
  const trayIcons = {
    templatePath: fileURLToPath(new URL('../build/tray-iconTemplate.png', import.meta.url)),
    bluePath: fileURLToPath(new URL('../build/tray-icon-blue.png', import.meta.url)),
  }
  const settings = ctx.settings.register(
    DESKTOP_SETTINGS_NAMESPACE,
    DesktopSettingsSchema,
    {
      applies: 'restart',
      validate: (value) => {
        if (!desktopBrowserAccessAvailable(value.mode) && value.openBrowser) {
          throw new Error('dsh-plugin-desktop: browser access requires compatibility mode')
        }
      },
    },
  )
  const rendererOrigin = `http://127.0.0.1:${String(ctx.webServer.port)}`
  ctx.settings.register('robocoding-skill-library', z.object({ skillIds: z.array(z.string().min(1).max(64)).max(2000).default([]) }))
  ctx.settings.register('robocoding-onboarding', z.object({ completed: z.boolean().default(false) }))
  if (runtime.readAccountSecret !== undefined && runtime.writeAccountSecret !== undefined
    && runtime.clearAccountSecret !== undefined && runtime.openExternalUrl !== undefined) {
    ctx.inject(['llm'], (accountCtx) => {
      const accountSettings = accountCtx.settings.register('robocoding-account', RoboCodingAccountSettingsSchema)
      const accountLlm = new RoboCodingLlmRegistration(accountCtx)
      const account = new RoboCodingAccountController({
        runtime: {
          readAccountSecret: () => runtime.readAccountSecret!(), writeAccountSecret: secret => runtime.writeAccountSecret!(secret),
          clearAccountSecret: () => runtime.clearAccountSecret!(), openExternalUrl: url => runtime.openExternalUrl!(url),
        },
        settings: accountSettings,
        onRelay: (relay, models) => accountLlm.update(relay, models),
        onModels: models => accountLlm.updateModels(models),
        onLogout: () => accountLlm.clear(),
        onRelayUnavailable: () => accountLlm.clear(),
        // Reuse Electron's proxy-aware network adapter. The Node/Undici global
        // fetch does not inherit the desktop session's proxy/TLS behavior.
        fetcher: (input, init) => runtime.updates.request(
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, init ?? {}),
        defaultPlatformUrl: process.env.ROBOCODING_PLATFORM_URL || DEFAULT_ROBOCODING_PLATFORM_URL,
      })
      accountCtx.effect(() => {
        void account.restore().catch(cause => accountCtx.logger.error(
          `dsh-plugin-desktop: failed to restore OpenFox account: ${cause instanceof Error ? cause.message : String(cause)}`,
        ))
        return () => { account.dispose(); accountLlm.dispose() }
      }, 'dsh-plugin-desktop: OpenFox account and model route')
      accountCtx.inject(['sessions'], (sessionsCtx) => {
        sessionsCtx.effect(() => {
          const stopEvents = sessionsCtx.on('session/event', (session, event) => {
            const sessionId = String(session.header.id)
            if (event.type === 'turn/start') account.turnStarted(sessionId, event.data.turn)
            else if (event.type === 'turn/end') account.turnEnded(sessionId, event.data.turn)
          })
          const stopDisposed = sessionsCtx.on('session/disposed', session => account.sessionDisposed(String(session.header.id)))
          return () => { stopDisposed(); stopEvents(); account.sessionsDetached() }
        }, 'dsh-plugin-desktop: lock OpenFox funding during active turns')
      })
      const accountRoutes = [
        [ROBOCODING_ACCOUNT_PATH, 'read'], [ROBOCODING_ACCOUNT_REFRESH_PATH, 'refresh'],
        [ROBOCODING_ACCOUNT_LOGIN_PATH, 'login'], [ROBOCODING_ACCOUNT_FUNDING_PATH, 'funding'],
        [ROBOCODING_ACCOUNT_LOGOUT_PATH, 'logout'], [ROBOCODING_ACCOUNT_PLATFORM_PATH, 'platform'],
      ] as const
      for (const [path, kind] of accountRoutes) {
        accountCtx.effect(() => accountCtx.webServer.register({ kind: 'exact', path, handler: (req, res) => {
          if (rejectDesktopRequest(accountCtx, req, res)) return
          return handleRoboCodingAccountRequest(kind, req, res, account)
        } }), `dsh-plugin-desktop: private OpenFox account route ${path}`)
      }
    })
  }
  ctx.effect(
    () => ctx.webServer.register({
      kind: 'exact',
      path: DESKTOP_LAN_HTTPS_CA_PATH,
      handler: (req, res) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          res.statusCode = 405
          res.setHeader('allow', 'GET, HEAD')
          res.setHeader('cache-control', 'no-store')
          res.end('method not allowed')
          return
        }
        const caCertificate = lanHttps.caCertificate
        if (caCertificate === null) {
          res.statusCode = 503
          res.setHeader('cache-control', 'no-store')
          res.end(req.method === 'HEAD' ? undefined : 'LAN HTTPS certificate unavailable')
          return
        }
        res.statusCode = 200
        res.setHeader('cache-control', 'no-store')
        res.setHeader('content-type', 'application/x-x509-ca-cert')
        res.setHeader('content-disposition', 'attachment; filename="dsh-desktop-local-ca.crt"')
        res.setHeader('content-length', String(Buffer.byteLength(caCertificate)))
        res.setHeader('x-content-type-options', 'nosniff')
        res.end(req.method === 'HEAD' ? undefined : caCertificate)
      },
    }),
    'dsh-plugin-desktop: public LAN HTTPS CA route',
  )
  ctx.on('webserver/index-inject', table => {
    table.push(...desktopBootRecoveryInjections())
  })
  for (const path of [ROBO_SKILLS_CATALOG_PATH, ROBO_DEVICES_CATALOG_PATH, ROBO_SKILLS_DEMO_RUNS_PATH, ROBO_SKILLS_RUNS_PATH] as const) {
    ctx.effect(
      () => ctx.webServer.register({
        kind: 'exact',
        path,
        handler: (req, res) => {
          if (rejectDesktopRequest(ctx, req, res)) return
          return handleRoboSkillsProxyRequest(req, res, rendererOrigin, path, {
            serviceUrl: process.env.ROBO_SKILLS_URL,
            catalogUrl: 'https://api.openzrob.com/api/catalog',
            // Catalog requests must use Electron's native network session too.
            // Node/Undici global fetch does not inherit the Windows desktop
            // session's proxy/TLS behavior and turns reachable endpoints into
            // a misleading local 502.
            fetch: (input, init) => runtime.updates.request(
              typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, init ?? {}),
          })
        },
      }),
      `dsh-plugin-desktop: private OpenFox skills route ${path}`,
    )
  }
  ctx.effect(
    () => ctx.webServer.register({
      kind: 'exact',
      path: ROBO_LOCAL_SKILLS_PATH,
      handler: (req, res) => {
        if (rejectDesktopRequest(ctx, req, res)) return
        return handleRoboLocalSkillsRequest(req, res, rendererOrigin, {
          reportError: cause => ctx.logger.error(
            `dsh-plugin-desktop: local skill operation failed: ${cause instanceof Error ? cause.message : String(cause)}`,
          ),
        })
      },
    }),
    'dsh-plugin-desktop: private local skills route',
  )
  ctx.effect(
    () => ctx.webServer.register({
      kind: 'exact',
      path: ROBO_LOCAL_SKILLS_PICK_DIRECTORY_PATH,
      handler: (req, res) => {
        if (rejectDesktopRequest(ctx, req, res)) return
        return handleRoboLocalSkillPickerRequest(
          req,
          res,
          rendererOrigin,
          () => runtime.pickSkillDirectory(),
          cause => ctx.logger.error(
            `dsh-plugin-desktop: native skill directory picker failed: ${cause instanceof Error ? cause.message : String(cause)}`,
          ),
        )
      },
    }),
    'dsh-plugin-desktop: private local skill directory picker route',
  )
  const desktopSettings = ctx.get('desktopSettingsController')
  if (desktopSettings !== undefined) {
    const reportSettingsError = (operation: string, cause: unknown): void => {
      ctx.logger.error(
        `dsh-plugin-desktop: failed to ${operation}: ${cause instanceof Error ? cause.message : String(cause)}`,
      )
    }
    const settingsRoutes = [
      [DESKTOP_SETTINGS_PATH, handleDesktopSettingsRequest],
      [DESKTOP_PROFILE_CREATE_PATH, handleDesktopProfileCreateRequest],
      [DESKTOP_PROFILE_DELETE_PATH, handleDesktopProfileDeleteRequest],
      [DESKTOP_PROFILE_SELECT_PATH, handleDesktopProfileSelectRequest],
      [DESKTOP_AA_SELECT_PATH, handleDesktopAaSelectRequest],
      [DESKTOP_MARKET_SELECT_PATH, handleDesktopMarketSelectRequest],
      [DESKTOP_TERMINAL_OPEN_PATH, handleDesktopTerminalOpenRequest],
      [DESKTOP_RESTART_PATH, handleDesktopRestartRequest],
      [DESKTOP_RECOVERY_RESTART_PATH, handleDesktopRecoveryRestartRequest],
      [DESKTOP_RENDERER_RELOAD_PATH, handleDesktopRendererReloadRequest],
      [DESKTOP_DEVELOPER_TOOLS_TOGGLE_PATH, handleDesktopDeveloperToolsToggleRequest],
      [DESKTOP_DIAGNOSTICS_EXPORT_PATH, handleDesktopDiagnosticsExportRequest],
    ] as const
    for (const [path, handler] of settingsRoutes) {
      ctx.effect(
        () => ctx.webServer.register({
          kind: 'exact',
          path,
          handler: (req, res) => {
            if (rejectDesktopRequest(ctx, req, res)) return
            return handler(
              req,
              res,
              rendererOrigin,
              desktopSettings,
              reportSettingsError,
            )
          },
        }),
        `dsh-plugin-desktop: private settings route ${path}`,
      )
    }
  }
  ctx.effect(
    () => ctx.webServer.register({
      kind: 'exact',
      path: RENDERER_BOOT_REPORT_PATH,
      handler: (req, res) => {
        if (rejectDesktopRequest(ctx, req, res)) return
        return handleRendererBootRequest(
          req,
          res,
          rendererOrigin,
          report => { runtime.reportRendererBoot(report) },
        )
      },
    }),
    'dsh-plugin-desktop: renderer boot report route',
  )
  if (runtime.platform === 'win32') {
    ctx.effect(
      () => ctx.webServer.register({
        kind: 'exact',
        path: DESKTOP_DIRECTORY_PICKER_PATH,
        handler: (req, res) => {
          if (rejectDesktopRequest(ctx, req, res)) return
          return handleDesktopDirectoryPickerRequest(
            req,
            res,
            rendererOrigin,
            () => runtime.pickDirectory(),
            cause => {
              ctx.logger.error(`dsh-plugin-desktop: native directory picker failed: ${cause instanceof Error ? cause.message : String(cause)}`)
            },
          )
        },
      }),
      'dsh-plugin-desktop: native directory picker route',
    )
    ctx.effect(
      () => ctx.webServer.register({
        kind: 'exact',
        path: DESKTOP_DIRECTORY_VALIDATOR_PATH,
        handler: (req, res) => {
          if (rejectDesktopRequest(ctx, req, res)) return
          return handleDesktopDirectoryValidationRequest(
            req,
            res,
            rendererOrigin,
            path => runtime.validateDirectory(path),
            cause => {
              ctx.logger.error(`dsh-plugin-desktop: workspace directory validation failed: ${cause instanceof Error ? cause.message : String(cause)}`)
            },
          )
        },
      }),
      'dsh-plugin-desktop: workspace directory validation route',
    )
  }
  if (runtime.platform === 'linux' && runtime.controlWindow !== undefined) {
    ctx.effect(
      () => ctx.webServer.register({
        kind: 'exact',
        path: DESKTOP_WINDOW_CONTROLS_PATH,
        handler: (req, res) => {
          if (rejectDesktopRequest(ctx, req, res)) return
          return handleDesktopWindowControlRequest(
            req,
            res,
            rendererOrigin,
            action => { runtime.controlWindow?.(action) },
            cause => {
              ctx.logger.error(`dsh-plugin-desktop: window control request failed: ${cause instanceof Error ? cause.message : String(cause)}`)
            },
          )
        },
      }),
      'dsh-plugin-desktop: linux window controls route',
    )
  }
  ctx.effect(() => {
    let pending: ReturnType<typeof setImmediate> | undefined
    const updateLiveWebAccess = (
      browserEnabled: boolean,
      exposure: DesktopNetworkExposure,
    ): void => {
      browserAccess.setOrdinaryBrowserEnabled(browserEnabled)
      void lanHttps.setEnabled(browserEnabled && exposure === 'lan').then((snapshot) => {
        if (snapshot.state === 'failed') {
          ctx.logger.error(
            `dsh-plugin-desktop: LAN HTTPS edge failed to start (${snapshot.errorCode ?? 'unknown'})`,
          )
        }
      }).catch((cause: unknown) => {
        ctx.logger.error(
          `dsh-plugin-desktop: LAN HTTPS edge transition failed: ${cause instanceof Error ? cause.message : String(cause)}`,
        )
      })
    }
    updateLiveWebAccess(browserAccess.ordinaryBrowserEnabled, config.networkExposure)
    const stopWatching = settings.watch((next) => {
      const nextBrowserAccess = desktopBrowserAccessEnabled(
        next.mode,
        next.openBrowser,
        next.networkExposure,
      )
      const nextNetworkExposure = desktopNetworkExposureForBrowserAccess(
        nextBrowserAccess,
        next.networkExposure,
      )
      updateLiveWebAccess(nextBrowserAccess, nextNetworkExposure)
      if (next.mode === config.mode
        && next.port === config.port
        && next.macosMaterial === config.macosMaterial
        && next.windowsMaterial === config.windowsMaterial) {
        if (pending !== undefined) clearImmediate(pending)
        pending = undefined
        return
      }
      pending ??= setImmediate(() => {
        pending = undefined
        void runtime.requestRestart().catch((cause: unknown) => {
          ctx.logger.error('dsh-plugin-desktop: failed to restart after startup setting change')
          ctx.logger.error(cause)
        })
      })
    })
    return () => {
      stopWatching()
      if (pending !== undefined) clearImmediate(pending)
      void lanHttps.stop()
    }
  }, 'dsh-plugin-desktop: live browser access and restart-applied native settings')
  if (runtime.platform !== 'linux') {
    ctx.on('settings/updated', (namespace, next) => {
      if (namespace !== UI_THEME_SETTINGS_NAMESPACE) return
      runtime.setThemeSource((next as ThemeSettings).preference)
    })
  }
  ctx.on('settings/updated', (namespace, next) => {
    if (namespace !== UI_LOCALE_SETTINGS_NAMESPACE) return
    runtime.setLocalePreference(desktopLocalePreference((next as LocaleSettings).preference))
  })
  ctx.effect(
    () => {
      const material = effectiveDesktopWindowMaterial(
        config.mode,
        runtime.platform,
        config.macosMaterial,
        config.windowsMaterial,
        runtime.windowsBuild,
      )
      const url = desktopRendererUrl(
        ctx.webServer.port,
        config.mode,
        runtime.platform,
        runtime.updates.currentVersion,
        material,
        runtime.windowsBuild,
      )
      return runtime.schedule({
        ...config,
        material,
        ...(runtime.windowsBuild === undefined ? {} : { windowsBuild: runtime.windowsBuild }),
        url,
        authenticationUrl: ctx.connection.authenticatedUrl(new URL(url).origin),
        rendererAccessHeader: browserAccess.rendererHeader,
        productName: DESKTOP_DISPLAY_NAME,
        windowTitle: DESKTOP_DISPLAY_NAME,
        iconPath,
        trayIcons,
        readLocalePreference: () => {
          return desktopLocalePreference(
            (ctx.settings.get(UI_LOCALE_SETTINGS_NAMESPACE) as LocaleSettings | undefined)?.preference,
          )
        },
        readThemeSource: () => {
          const theme = ctx.settings.get(UI_THEME_SETTINGS_NAMESPACE) as ThemeSettings | undefined
          if (theme === undefined) {
            throw new Error('dsh-plugin-desktop: custom shell requires the ui-theme settings namespace')
          }
          return theme.preference
        },
        ...(desktopSettings === undefined ? {} : {
          readRemoteControl: async () => {
            const aa = desktopSettings.read().aa
            return aa?.requested === true || aa?.effective === true
          },
          enableRemoteControl: async () => {
            const result = await desktopSettings.selectAa(true)
            result.afterResponse?.()
          },
        }),
        requestQuit: appExit,
        requestModeChange: async mode => {
          const current = settings.get()
          const storedBrowserCapability = current.openBrowser || current.networkExposure === 'lan'
          await settings.update(mode !== 'compatibility' && storedBrowserCapability
            ? { mode, openBrowser: false, networkExposure: 'loopback' }
            : { mode })
        },
      })
    },
    'dsh-plugin-desktop: native shell generation',
  )
}
