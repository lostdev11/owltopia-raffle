/**
 * Detect Phantom / browser-extension channel failures that prevent the approve
 * popup from appearing (service worker dead, extension reload, etc.).
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
    (m.includes('phantom') && (m.includes('not reachable') || m.includes('reconnect')))
  )
}

export function walletExtensionUnreachableHint(): string {
  return (
    'Phantom (or your wallet extension) is not reachable — the approve popup cannot open. ' +
    'Open Phantom, unlock it, refresh this page, reconnect, then retry.'
  )
}
