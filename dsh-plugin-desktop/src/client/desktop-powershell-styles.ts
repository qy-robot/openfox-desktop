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
  box-shadow: 0 1px 4px color-mix(in srgb, var(--dsw-alias-label-primary, #17202b) 10%, transparent);
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
  grid-template-rows: auto minmax(0, 1fr) auto auto auto;
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--dsw-alias-bg-base, #f8fafc);
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
.dshDesktopPowerShellFooter button:disabled { cursor: default; opacity: .5; }
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
