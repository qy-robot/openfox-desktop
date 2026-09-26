/** PowerShell/SSH right-Sidebar tab styles shared by every Windows presentation mode. */

const STYLE_ID = 'dsh-desktop-powershell-styles'

const CSS = `
.dshDesktopPowerShellButton {
  position: absolute;
  z-index: 1;
  top: 4px;
  right: 148px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  height: 28px;
  padding: 0 10px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(120,130,145,.35));
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-1, rgba(246,248,251,.92));
  box-shadow: 0 1px 4px color-mix(in srgb, var(--dsw-alias-label-primary, #17202b) 10%, transparent);
  color: var(--dsw-alias-label-secondary, #465466);
  cursor: pointer;
  font: 500 12px/1 system-ui, sans-serif;
  -webkit-app-region: no-drag;
}
#dsh-desktop-powershell-root .dshDesktopPowerShellButton { position: fixed; }
.dshDesktopPowerShellButton:hover,
.dshDesktopPowerShellButton[aria-expanded="true"] {
  background: var(--dsw-alias-interactive-bg-hover, #e9edf3);
  color: var(--dsw-alias-label-primary, #17202b);
}
.dshDesktopPowerShellButton:focus-visible,
.dshDesktopPowerShellPanel button:focus-visible,
.dshDesktopPowerShellPanel input:focus-visible,
.dshDesktopPowerShellPanel select:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary, #3267d6);
  outline-offset: 1px;
}
.dshDesktopPowerShellButton svg { width: 15px; height: 15px; stroke-width: 1.8; }
.dshDesktopPowerShellActivity {
  position: absolute;
  right: 4px;
  bottom: 3px;
  width: 6px;
  height: 6px;
  border: 1px solid var(--dsw-alias-bg-base, #fff);
  border-radius: 50%;
  background: var(--dsw-alias-brand-primary, #3267d6);
}
.dshDesktopPowerShellFallback {
  position: absolute;
  z-index: 2;
  inset: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--dsw-alias-bg-base, #f8fafc);
  color: var(--dsw-alias-label-primary, #17202b);
  pointer-events: auto;
  -webkit-app-region: no-drag;
}
#dsh-desktop-powershell-root .dshDesktopPowerShellFallback {
  position: fixed;
  z-index: 1001;
  top: 32px;
  right: 0;
  bottom: 0;
  left: auto;
  width: clamp(320px, 31.5vw, 520px);
  max-width: 100vw;
  border-left: 1px solid var(--dsw-alias-border-l1, rgba(120,130,145,.28));
}
.dshDesktopPowerShellFallback[data-fullscreen="true"] {
  z-index: 1100;
  position: fixed;
  inset: 0;
  width: auto;
  max-width: none;
  border-left: 0;
}
.dshDesktopPowerShellFallback > .dshDesktopPowerShellPanel { min-height: 0; }
.dshDesktopPowerShellPanel {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--dsw-alias-bg-base, #f8fafc);
  color: var(--dsw-alias-label-primary, #17202b);
  font-family: system-ui, sans-serif;
  container-type: inline-size;
  -webkit-app-region: no-drag;
}
.dshDesktopPowerShellPanel[data-terminal-mode="robot"][data-fullscreen="true"] {
  grid-template-columns: 236px minmax(0, 1fr);
}
.dshDesktopPowerShellSurface {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto auto auto;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}
.dshDesktopPowerShellSurface[data-connection-pane="true"] {
  grid-template-rows: auto auto minmax(0, 1fr) auto auto auto;
}
.dshDesktopPowerShellHeader {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 52px;
  padding: 0 10px 0 16px;
  border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(120,130,145,.28));
}
.dshDesktopPowerShellHeader > svg { width: 18px; height: 18px; color: var(--dsw-alias-brand-primary, #3267d6); }
.dshDesktopPowerShellHeader > div { display: grid; min-width: 0; gap: 2px; margin-right: auto; }
.dshDesktopPowerShellHeader strong { font-size: 14px; font-weight: 650; }
.dshDesktopPowerShellHeader small { overflow: hidden; color: var(--dsw-alias-label-secondary, #667085); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.dshDesktopPowerShellHeader button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--dsw-alias-label-secondary, #667085);
  cursor: pointer;
}
.dshDesktopPowerShellHeader button:hover { background: var(--dsw-alias-interactive-bg-hover, #e9edf3); color: var(--dsw-alias-label-primary, #17202b); }
.dshDesktopPowerShellHeader button svg { width: 16px; height: 16px; }
.dshDesktopPowerShellTabTitle { display: inline-flex; align-items: center; gap: 6px; min-width: 0; }
.dshDesktopPowerShellTabTitle svg { width: 14px; height: 14px; flex: none; stroke-width: 1.8; }
.dshDesktopSshRail,
.dshDesktopSshCompact {
  min-width: 0;
  background: var(--dsw-alias-bg-base, #f8fafc);
  color: var(--dsw-alias-label-primary, #17202b);
}
.dshDesktopSshRail {
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-right: 1px solid var(--dsw-alias-border-l1, rgba(120,130,145,.28));
}
.dshDesktopSshCompact { border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(120,130,145,.28)); }
.dshDesktopSshPaneHeader {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 52px;
  box-sizing: border-box;
  padding: 8px 10px 8px 12px;
  border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(120,130,145,.28));
}
.dshDesktopSshCompact .dshDesktopSshPaneHeader { min-height: 44px; border-bottom: 0; }
.dshDesktopSshPaneHeader > div { display: grid; flex: 1; gap: 2px; min-width: 0; }
.dshDesktopSshPaneHeader strong { font-size: 12px; }
.dshDesktopSshPaneHeader small { overflow: hidden; color: var(--dsw-alias-label-secondary, #667085); font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
.dshDesktopSshPaneHeader button,
.dshDesktopSshEditor button {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  gap: 5px;
  min-height: 30px;
  box-sizing: border-box;
  padding: 5px 9px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(120,130,145,.35));
  border-radius: 7px;
  background: var(--dsw-alias-bg-layer-1, #f3f5f8);
  color: var(--dsw-alias-label-primary, #17202b);
  cursor: pointer;
  font: 500 11px/1.2 system-ui, sans-serif;
  white-space: nowrap;
}
.dshDesktopSshPaneHeader button:hover,
.dshDesktopSshEditor button:hover { background: var(--dsw-alias-interactive-bg-hover, #e9edf3); }
.dshDesktopSshPaneHeader button svg,
.dshDesktopSshEditor button svg { width: 13px; height: 13px; }
.dshDesktopSshProfileList { flex: 1; min-height: 0; padding: 8px; overflow: auto; }
.dshDesktopSshProfileList h3 { margin: 4px 4px 8px; color: var(--dsw-alias-label-secondary, #667085); font-size: 10px; font-weight: 600; }
.dshDesktopSshProfileList > p { margin: 12px 4px; color: var(--dsw-alias-label-secondary, #667085); font-size: 11px; line-height: 1.5; }
.dshDesktopSshProfile {
  display: grid;
  grid-template-columns: minmax(0,1fr) 26px 26px;
  align-items: center;
  gap: 2px;
  margin-bottom: 3px;
  border-radius: 7px;
}
.dshDesktopSshProfile[data-active="true"] { background: var(--dsw-alias-interactive-bg-hover, #e9edf3); }
.dshDesktopSshProfile button { border: 0; background: transparent; color: inherit; cursor: pointer; }
.dshDesktopSshProfileConnect { display: grid; grid-template-columns: 18px minmax(0,1fr); align-items: center; gap: 7px; min-width: 0; padding: 7px 5px; text-align: left; }
.dshDesktopSshProfileConnect > svg { width: 15px; height: 15px; color: var(--dsw-alias-label-secondary, #667085); }
.dshDesktopSshProfileConnect > span { display: grid; gap: 2px; min-width: 0; }
.dshDesktopSshProfileConnect strong,
.dshDesktopSshProfileConnect small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dshDesktopSshProfileConnect strong { font-size: 11px; }
.dshDesktopSshProfileConnect small { color: var(--dsw-alias-label-secondary, #667085); font: 10px/1.25 "Cascadia Mono", Consolas, monospace; }
.dshDesktopSshProfileAction { display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px; padding: 0; border-radius: 6px !important; color: var(--dsw-alias-label-secondary, #667085) !important; }
.dshDesktopSshProfileAction:hover { background: var(--dsw-alias-interactive-bg-hover, #e9edf3); color: var(--dsw-alias-label-primary, #17202b) !important; }
.dshDesktopSshProfileAction svg { width: 12px; height: 12px; }
.dshDesktopSshEditor { display: grid; gap: 9px; padding: 10px 12px 12px; border-top: 1px solid var(--dsw-alias-border-l1, rgba(120,130,145,.28)); overflow: auto; }
.dshDesktopSshRail .dshDesktopSshEditor { max-height: 58%; }
.dshDesktopSshCompact .dshDesktopSshEditor { max-height: min(42vh, 360px); }
.dshDesktopSshEditor label { display: grid; gap: 4px; min-width: 0; }
.dshDesktopSshEditor label > span { color: var(--dsw-alias-label-secondary, #667085); font-size: 10px; }
.dshDesktopSshEditor input {
  width: 100%;
  height: 30px;
  min-width: 0;
  box-sizing: border-box;
  padding: 0 8px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(120,130,145,.35));
  border-radius: 7px;
  background: var(--dsw-alias-bg-layer-1, #f3f5f8);
  color: var(--dsw-alias-label-primary, #17202b);
  font: 11px/1.2 system-ui, sans-serif;
}
.dshDesktopSshEditorPair { display: grid; grid-template-columns: minmax(0,1fr) 68px; gap: 7px; }
.dshDesktopSshEditor p { margin: 0; color: var(--dsw-alias-label-secondary, #667085); font-size: 10px; line-height: 1.4; }
.dshDesktopSshEditor .dshDesktopSshEditorError { color: var(--dsw-alias-state-error-primary, #b42318); }
.dshDesktopSshEditorActions { display: flex; justify-content: flex-end; gap: 7px; }
.dshDesktopSshEditorActions button[data-primary] { border-color: transparent; background: var(--dsw-alias-button-primary-fill, var(--dsw-alias-brand-primary, #3267d6)); color: var(--dsw-alias-label-primary-foreground, #fff); }
.dshDesktopPowerShellScroll {
  min-height: 0;
  padding: 14px 16px 22px;
  overflow: auto;
  overscroll-behavior: contain;
  background: var(--dsw-alias-bg-base, #f8fafc);
  color: var(--dsw-alias-label-primary, #17202b);
  font: 12.5px/1.55 "Cascadia Mono", "Cascadia Code", Consolas, monospace;
}
.dshDesktopPowerShellNotice { margin: 0 0 12px; color: var(--dsw-alias-label-secondary, #667085); }
.dshDesktopPowerShellNotice[data-error] { color: var(--dsw-alias-state-error-primary, #b42318); }
.dshDesktopPowerShellLiveOutput { min-height: 100%; margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; }
.dshDesktopPowerShellConversationLog { margin-top: 24px; padding-top: 16px; border-top: 1px solid var(--dsw-alias-border-l1, rgba(120,130,145,.28)); }
.dshDesktopPowerShellConversationLog h3 { margin: 0 0 12px; color: var(--dsw-alias-label-secondary, #667085); font: 600 11px/1.4 system-ui, sans-serif; letter-spacing: .04em; }
.dshDesktopPowerShellConversationLog article { display: grid; gap: 6px; padding: 10px 0; }
.dshDesktopPowerShellConversationLog article + article { border-top: 1px solid var(--dsw-alias-border-l1, rgba(120,130,145,.28)); }
.dshDesktopPowerShellConversationLog pre { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; }
.dshDesktopPowerShellConversationLog pre span { color: var(--dsw-alias-brand-primary, #3267d6); }
.dshDesktopPowerShellConversationLog small { color: var(--dsw-alias-label-secondary, #667085); }
.dshDesktopPowerShellConversationLog small[data-state="running"] { color: var(--dsw-alias-state-warning-primary, #a34d14); }
.dshDesktopPowerShellConversationLog small[data-state="error"] { color: var(--dsw-alias-state-error-primary, #b42318); }
.dshDesktopPowerShellConversationLog small[data-state="complete"] { color: var(--dsw-alias-state-success-primary, #198754); }
.dshDesktopPowerShellInput {
  display: grid;
  grid-template-columns: auto minmax(0,1fr) auto auto;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-top: 1px solid var(--dsw-alias-border-l1, rgba(120,130,145,.28));
  background: var(--dsw-alias-bg-base, #f8fafc);
  color: var(--dsw-alias-brand-primary, #3267d6);
  font: 12px/1.4 "Cascadia Mono", "Cascadia Code", Consolas, monospace;
}
.dshDesktopPowerShellInput input {
  min-width: 0;
  height: 32px;
  box-sizing: border-box;
  border: 1px solid var(--dsw-alias-border-l2, rgba(120,130,145,.35));
  border-radius: 7px;
  background: var(--dsw-alias-bg-layer-1, #f3f5f8);
  color: var(--dsw-alias-label-primary, #17202b);
  padding: 0 9px;
  font: inherit;
}
.dshDesktopPowerShellInput input::placeholder { color: var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary, #667085)); }
.dshDesktopPowerShellInput button,
.dshDesktopPowerShellFooter button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 32px;
  padding: 5px 11px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(120,130,145,.35));
  border-radius: 8px;
  background: transparent;
  color: var(--dsw-alias-label-primary, #17202b);
  cursor: pointer;
  font: 500 12px/1 system-ui, sans-serif;
}
.dshDesktopPowerShellInput button:hover:not(:disabled),
.dshDesktopPowerShellFooter button:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover, #e9edf3); }
.dshDesktopPowerShellInput button[data-primary],
.dshDesktopPowerShellFooter button[data-primary] { border-color: transparent; background: var(--dsw-alias-button-primary-fill, var(--dsw-alias-brand-primary, #3267d6)); color: var(--dsw-alias-label-primary-foreground, #fff); }
.dshDesktopPowerShellInput button svg,
.dshDesktopPowerShellFooter button svg { width: 14px; height: 14px; }
.dshDesktopPowerShellInput button:disabled,
.dshDesktopPowerShellFooter button:disabled,
.dshDesktopTerminalShortcutArea button:disabled { cursor: default; opacity: .5; }
.dshDesktopTerminalShortcutArea {
  min-width: 0;
  border-top: 1px solid var(--dsw-alias-border-l1, rgba(120,130,145,.28));
  background: var(--dsw-alias-bg-base, #f8fafc);
}
.dshDesktopTerminalShortcutBar {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 46px;
  box-sizing: border-box;
  padding: 7px 12px;
}
.dshDesktopTerminalShortcutList {
  display: flex;
  flex: 1;
  gap: 6px;
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: thin;
}
.dshDesktopTerminalShortcutArea button {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 30px;
  box-sizing: border-box;
  padding: 5px 10px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(120,130,145,.35));
  border-radius: 7px;
  background: var(--dsw-alias-bg-layer-1, #f3f5f8);
  color: var(--dsw-alias-label-primary, #17202b);
  cursor: pointer;
  font: 500 11px/1.2 system-ui, sans-serif;
  white-space: nowrap;
}
.dshDesktopTerminalShortcutArea button:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover, #e9edf3); }
.dshDesktopTerminalShortcutArea button[data-terminal-shortcut="fill"] { border-style: dashed; }
.dshDesktopTerminalShortcutArea button svg { width: 14px; height: 14px; }
.dshDesktopTerminalShortcutSettings[aria-expanded="true"] { background: var(--dsw-alias-interactive-bg-hover, #e9edf3); }
.dshDesktopTerminalShortcutEditor {
  display: grid;
  gap: 10px;
  padding: 10px 12px 12px;
  border-top: 1px solid var(--dsw-alias-border-l1, rgba(120,130,145,.28));
}
.dshDesktopTerminalShortcutRows { display: grid; gap: 8px; max-height: min(38vh, 340px); overflow: auto; }
.dshDesktopTerminalShortcutRows > p { margin: 4px 0; color: var(--dsw-alias-label-secondary, #667085); font-size: 12px; }
.dshDesktopTerminalShortcutRow {
  display: grid;
  grid-template-columns: minmax(74px,.36fr) minmax(128px,1fr) minmax(94px,.38fr) 30px;
  align-items: end;
  gap: 7px;
}
.dshDesktopTerminalShortcutRow label { display: grid; gap: 4px; min-width: 0; }
.dshDesktopTerminalShortcutRow label > span { color: var(--dsw-alias-label-secondary, #667085); font-size: 10px; }
.dshDesktopTerminalShortcutRow input,
.dshDesktopTerminalShortcutRow select {
  width: 100%;
  height: 30px;
  min-width: 0;
  box-sizing: border-box;
  padding: 0 8px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(120,130,145,.35));
  border-radius: 7px;
  background: var(--dsw-alias-bg-layer-1, #f3f5f8);
  color: var(--dsw-alias-label-primary, #17202b);
  font: 11px/1.2 system-ui, sans-serif;
}
.dshDesktopTerminalShortcutRow > button { width: 30px; padding: 0; }
.dshDesktopTerminalShortcutError { margin: 0; color: var(--dsw-alias-state-error-primary, #b42318); font-size: 11px; }
.dshDesktopTerminalShortcutEditorActions { display: grid; grid-template-columns: auto auto 1fr auto auto; align-items: center; gap: 7px; }
.dshDesktopTerminalShortcutEditorActions button[data-primary] { border-color: transparent; background: var(--dsw-alias-button-primary-fill, var(--dsw-alias-brand-primary, #3267d6)); color: var(--dsw-alias-label-primary-foreground, #fff); }
.dshDesktopPowerShellApproval {
  display: grid;
  gap: 9px;
  padding: 13px 14px;
  border-top: 1px solid var(--dsw-alias-border-l1, rgba(120,130,145,.28));
  background: var(--dsw-alias-bg-base, #f8fafc);
}
.dshDesktopPowerShellApprovalHeader { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 650; }
.dshDesktopPowerShellApprovalHeader svg { width: 16px; height: 16px; color: var(--dsw-alias-brand-primary, #3267d6); }
.dshDesktopPowerShellApproval p { margin: 0; color: var(--dsw-alias-label-secondary, #667085); font-size: 12px; }
.dshDesktopPowerShellApproval pre { max-height: 112px; margin: 0; padding: 9px 10px; overflow: auto; border: 1px solid var(--dsw-alias-border-l1, rgba(120,130,145,.28)); border-radius: 8px; background: var(--dsw-alias-bg-layer-1, #f3f5f8); color: var(--dsw-alias-label-primary, #17202b); white-space: pre-wrap; font: 12px/1.5 "Cascadia Mono", Consolas, monospace; }
.dshDesktopPowerShellFooter { display: flex; align-items: center; justify-content: flex-end; min-height: 52px; box-sizing: border-box; gap: 8px; padding: 9px 12px; border-top: 1px solid var(--dsw-alias-border-l1, rgba(120,130,145,.28)); background: var(--dsw-alias-bg-base, #f8fafc); }
.dshDesktopPowerShellFooter:empty { display: none; }
.dshDesktopPowerShellDefaultActions { display: flex; align-items: center; justify-content: flex-end; gap: 8px; }
@media (max-width: 620px) {
  .dshDesktopPowerShellButton { right: 140px; }
  #dsh-desktop-powershell-root .dshDesktopPowerShellFallback { left: 0; width: auto; max-width: none; }
}
@container (max-width: 460px) {
  .dshDesktopTerminalShortcutRow { grid-template-columns: minmax(88px,.45fr) minmax(0,1fr) 30px; }
  .dshDesktopTerminalShortcutRow label:nth-child(2) { grid-column: 1 / 3; grid-row: 2; }
  .dshDesktopTerminalShortcutRow label:nth-child(3) { grid-column: 1 / 3; grid-row: 3; }
  .dshDesktopTerminalShortcutRow > button { grid-column: 3; grid-row: 1; }
  .dshDesktopTerminalShortcutEditorActions { grid-template-columns: auto auto 1fr; }
  .dshDesktopTerminalShortcutEditorActions > span { display: none; }
  .dshDesktopTerminalShortcutEditorActions button:nth-last-child(-n+2) { grid-row: 2; }
  .dshDesktopTerminalShortcutEditorActions button:last-child { grid-column: 3; }
}
`

export function installDesktopPowerShellStyles(): () => void {
  document.getElementById(STYLE_ID)?.remove()
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.dataset.pluginCss = 'dsh-plugin-desktop/powershell'
  style.textContent = CSS
  document.head.appendChild(style)
  return () => { style.remove() }
}
