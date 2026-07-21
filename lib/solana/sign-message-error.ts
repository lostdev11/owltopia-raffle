/**
 * User-facing copy for wallet `signMessage` failures (SIWS, nesting safeguards, wallet link).
 * Ledger via Phantom/Solflare often surfaces generic "Unexpected error" with no device prompt.
 */

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  if (err && typeof err === 'object' && 'message' in err && typeof (err as { message: unknown }).message === 'string') {
    return (err as { message: string }).message
  }
  return ''
}

function errorHaystack(err: unknown): string {
  const msg = errorMessage(err)
  let json = ''
  try {
    json = JSON.stringify(err ?? '')
  } catch {
    json = ''
  }
  return `${msg} ${json}`.toLowerCase()
}

export function isSignMessageUserRejection(err: unknown): boolean {
  const hay = errorHaystack(err)
  // Bare "Transaction cancelled" is NOT treated as a clear user reject — Phantom/Solflare
  // often emit that after a Ledger Sign Message attempt fails even when the user OK'd the device.
  if (isAmbiguousLedgerSignCancel(err)) return false
  return (
    hay.includes('user rejected') ||
    hay.includes('user cancelled') ||
    hay.includes('user canceled') ||
    hay.includes('user declined') ||
    hay.includes('rejected the request') ||
    hay.includes('approval denied') ||
    hay.includes('denied by the user')
  )
}

/**
 * Phantom/Solflare + Ledger frequently surface "Transaction cancelled" for failed
 * off-chain signMessage (including after the user taps OK on the device). Prefer memo-tx fallback.
 */
export function isAmbiguousLedgerSignCancel(err: unknown): boolean {
  const hay = errorHaystack(err)
  const cancelled =
    hay.includes('transaction cancelled') ||
    hay.includes('transaction canceled') ||
    hay === 'cancelled' ||
    hay === 'canceled' ||
    hay.trim() === 'transaction cancelled' ||
    hay.trim().startsWith('transaction cancelled')
  if (!cancelled) return false
  // Explicit user-reject wording still wins as a real cancel.
  if (
    hay.includes('user rejected') ||
    hay.includes('user declined') ||
    hay.includes('rejected the request') ||
    hay.includes('denied by the user')
  ) {
    return false
  }
  return true
}

export function isLikelyHardwareWalletSignMessageFailure(err: unknown): boolean {
  const hay = errorHaystack(err)
  return (
    isAmbiguousLedgerSignCancel(err) ||
    hay.includes('ledger') ||
    hay.includes('blind signing') ||
    hay.includes('blind-signing') ||
    hay.includes('device timeout') ||
    hay.includes('u2f') ||
    hay.includes('webhid') ||
    hay.includes('hid') ||
    hay.includes('bluetooth') ||
    hay.includes('transport') ||
    hay.includes("don't see any sign") ||
    hay.includes('dont see any sign') ||
    hay.includes('no sign request') ||
    (hay.includes('sign request') && hay.includes('device')) ||
    hay.includes('unexpected error') ||
    hay.includes('failed to sign') ||
    hay.includes('signing failed') ||
    hay.includes('timeout') ||
    hay.includes('timed out')
  )
}

const LEDGER_SIGN_MESSAGE_HINT =
  'Ledger tip: unlock the device, open the Solana app (close Ledger Live), then tap “Sign with Ledger transaction” on My nest (memo is not broadcast). ' +
  'On phone, reconnect Bluetooth or open this site inside Phantom/Solflare. On desktop, prefer USB/WebHID. ' +
  'If the device still never prompts, sign in from a hot wallet, then switch back for nesting.'

/**
 * Format a `signMessage` failure for SIWS / nesting “say hi” / safeguards.
 */
export function formatSignMessageError(
  err: unknown,
  opts?: { walletName?: string | null; context?: 'sign-in' | 'safeguards' | 'generic' }
): string {
  const context = opts?.context ?? 'generic'
  const walletLabel = (opts?.walletName ?? '').trim() || 'your wallet'
  const msg = errorMessage(err).trim()

  if (isSignMessageUserRejection(err)) {
    return context === 'safeguards'
      ? 'Signature cancelled in wallet.'
      : 'Sign-in cancelled in wallet.'
  }

  const hay = errorHaystack(err)

  if (
    hay.includes('does not support') ||
    hay.includes('signmessage is not a function') ||
    hay.includes('sign message not supported')
  ) {
    return `${walletLabel} does not support message signing. Try Phantom or Solflare, or a different account.`
  }

  if (isLikelyHardwareWalletSignMessageFailure(err)) {
    const lead =
      context === 'safeguards'
        ? 'Hardware wallet did not complete the safeguards signature.'
        : context === 'sign-in'
          ? isAmbiguousLedgerSignCancel(err)
            ? 'Ledger approved something, but Phantom/Solflare cancelled the Sign Message step (common with hardware wallets).'
            : 'Hardware wallet did not complete the nest sign-in message.'
          : 'Hardware wallet did not complete the message signature.'
    return `${lead} ${LEDGER_SIGN_MESSAGE_HINT}`
  }

  if (msg && msg.toLowerCase() !== 'unexpected error' && msg.toLowerCase() !== 'unknown error') {
    return msg
  }

  return (
    `Wallet signing failed (${msg || 'unexpected error'}). ` +
    `Approve the Sign Message request in ${walletLabel}, or reconnect and try again. ${LEDGER_SIGN_MESSAGE_HINT}`
  )
}
