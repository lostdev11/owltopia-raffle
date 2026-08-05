/**
 * Detect browser-extension / mobile-wallet channel failures that prevent the approve
 * popup from appearing (service worker dead, extension reload, WebView gap, etc.).
 */
export function isWalletExtensionUnreachableError(message: string): boolean {
  const m = (message ?? '').toLowerCase()
  return (
    m.includes('receiving end does not exist') ||
    m.includes('could not establish connection') ||
    m.includes('provider injection') ||
    m.includes('extension context invalidated') ||
    m.includes('wallet app is not reachable') ||
    m.includes('adapter is not ready') ||
    (m.includes('phantom') && (m.includes('not reachable') || m.includes('reconnect'))) ||
    (m.includes('jupiter') && (m.includes('not reachable') || m.includes('reconnect')))
  )
}

/** User-facing hint — wallet-agnostic (Phantom, Jupiter, Solflare, …). */
export function walletExtensionUnreachableHint(walletName?: string | null): string {
  const name = (walletName ?? '').trim()
  const label = name || 'your wallet'
  return (
    `${label} is not reachable — the approve popup cannot open. ` +
    `Open ${label}, unlock it, hard-refresh this page, reconnect, then retry. ` +
    `On Jupiter Mobile: use the in-app globe browser on owltopia.xyz (not Safari/Chrome alone).`
  )
}
