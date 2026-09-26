/** PowerShell/SSH right-Sidebar tab styles shared by every Windows presentation mode. */

const STYLE_ID = 'dsh-desktop-powershell-styles'

const CSS = `
.dshDesktopPowerShellButton {
  position: fixed;
  z-index: 2147482998;
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
  box-shadow: 0 1px 4px rgba(0,0,0,.08);
  color: var(--dsw-alias-label-secondary, #465466);
  cursor: pointer;
  font: 500 12px/1 system-ui, sans-serif;
  -webkit-app-region: no-drag;
}
.dshDesktopPowerShellButton:hover,
.dshDesktopPowerShellButton[aria-expanded="true"] {
  background: var(--dsw-alias-interactive-bg-hover, #e9edf3);
  color: var(--dsw-alias-label-primary, #17202b);
}
.dshDesktopPowerShellButton:focus-visible,
.dshDesktopPowerShellPanel button:focus-visible,
.dshDesktopPowerShellPanel input:focus-visible {
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
.dshDesktopPowerShellPanel {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto auto;
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--dsw-alias-bg-layer-1, #f8fafc);
  color: var(--dsw-alias-label-primary, #17202b);
  font-family: system-ui, sans-serif;
  -webkit-app-region: no-drag;
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
.dshDesktopPowerShellScroll {
  min-height: 0;
  padding: 14px 16px 22px;
  overflow: auto;
  overscroll-behavior: contain;
  background: #071018;
  color: #d8e2ec;
  font: 12.5px/1.55 "Cascadia Mono", "Cascadia Code", Consolas, monospace;
}
.dshDesktopPowerShellNotice { margin: 0 0 12px; color: #8fa2b5; }
.dshDesktopPowerShellNotice[data-error] { color: #ff8b94; }
.dshDesktopPowerShellLiveOutput { min-height: 100%; margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; }
.dshDesktopPowerShellConversationLog { margin-top: 24px; padding-top: 16px; border-top: 1px solid rgba(143,162,181,.2); }
.dshDesktopPowerShellConversationLog h3 { margin: 0 0 12px; color: #8fa2b5; font: 600 11px/1.4 system-ui, sans-serif; letter-spacing: .06em; text-transform: uppercase; }
.dshDesktopPowerShellConversationLog article { display: grid; gap: 6px; padding: 10px 0; }
.dshDesktopPowerShellConversationLog article + article { border-top: 1px solid rgba(143,162,181,.15); }
.dshDesktopPowerShellConversationLog pre { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; }
.dshDesktopPowerShellConversationLog pre span { color: #65d4a4; }
.dshDesktopPowerShellConversationLog small { color: #8fa2b5; }
.dshDesktopPowerShellConversationLog small[data-state="running"] { color: #f4c66a; }
.dshDesktopPowerShellConversationLog small[data-state="error"] { color: #ff808b; }
.dshDesktopPowerShellConversationLog small[data-state="complete"] { color: #65d4a4; }
.dshDesktopPowerShellInput {
  display: grid;
  grid-template-columns: auto minmax(0,1fr) auto auto;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-top: 1px solid var(--dsw-alias-border-l1, rgba(120,130,145,.28));
  background: #0b151f;
  color: #65d4a4;
  font: 12px/1.4 "Cascadia Mono", "Cascadia Code", Consolas, monospace;
}
.dshDesktopPowerShellInput input {
  min-width: 0;
  height: 32px;
  box-sizing: border-box;
  border: 1px solid rgba(143,162,181,.28);
  border-radius: 7px;
  background: #071018;
  color: #d8e2ec;
  padding: 0 9px;
  font: inherit;
}
.dshDesktopPowerShellInput input::placeholder { color: #718395; }
.dshDesktopPowerShellInput button,
.dshDesktopPowerShellApproval button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 32px;
  padding: 5px 11px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(120,130,145,.35));
  border-radius: 8px;
  background: transparent;
  color: inherit;
  cursor: pointer;
  font: 500 12px/1 system-ui, sans-serif;
}
.dshDesktopPowerShellInput button:hover:not(:disabled),
.dshDesktopPowerShellApproval button:hover:not(:disabled) { background: rgba(143,162,181,.14); }
.dshDesktopPowerShellInput button[data-primary],
.dshDesktopPowerShellApproval button[data-primary] { border-color: transparent; background: var(--dsw-alias-brand-primary, #3267d6); color: #fff; }
.dshDesktopPowerShellInput button svg,
.dshDesktopPowerShellApproval button svg { width: 14px; height: 14px; }
.dshDesktopPowerShellInput button:disabled,
.dshDesktopPowerShellApproval button:disabled { cursor: default; opacity: .5; }
.dshDesktopPowerShellApproval {
  display: grid;
  gap: 9px;
  padding: 13px 14px;
  border-top: 1px solid var(--dsw-alias-border-l1, rgba(120,130,145,.28));
  background: var(--dsw-alias-bg-layer-1, #f8fafc);
}
.dshDesktopPowerShellApprovalHeader { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 650; }
.dshDesktopPowerShellApprovalHeader svg { width: 16px; height: 16px; color: var(--dsw-alias-brand-primary, #3267d6); }
.dshDesktopPowerShellApproval p { margin: 0; color: var(--dsw-alias-label-secondary, #667085); font-size: 12px; }
.dshDesktopPowerShellApproval pre { max-height: 112px; margin: 0; padding: 9px 10px; overflow: auto; border-radius: 8px; background: #071018; color: #d8e2ec; white-space: pre-wrap; font: 12px/1.5 "Cascadia Mono", Consolas, monospace; }
.dshDesktopPowerShellApproval > div:last-child { display: flex; justify-content: flex-end; gap: 8px; }
@media (max-width: 620px) {
  .dshDesktopPowerShellButton { right: 140px; }
  .dshDesktopPowerShellInput { grid-template-columns: auto minmax(0,1fr) auto; }
  .dshDesktopPowerShellInput button[type="button"] { display: none; }
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
