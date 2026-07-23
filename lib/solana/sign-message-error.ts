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
    isLedgerOffchainSignApduError(err) ||
    hay.includes('ledger') ||
    hay.includes('hardware wallet') ||
    hay.includes('hardware account') ||
    hay.includes('sign message rejected') ||
    hay.includes('rejected on ledger') ||
    (hay.includes('error code 1') &&
      (hay.includes('ledger') || hay.includes('hardware') || hay.includes('phantom'))) ||
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

/**
 * Ledger APDU 0x6a81 / ledgerUnknownSignError — device rejected off-chain signMessage
 * (Phantom/Solflare formatting or unsupported path). Memo-tx sign-in is the workaround.
 */
export function isLedgerOffchainSignApduError(err: unknown): boolean {
  const hay = errorHaystack(err)
  return (
    hay.includes('0x6a81') ||
    hay.includes('ledgerunknownsignerror') ||
    hay.includes('ledger sign error') ||
    (hay.includes('unknown_error') && hay.includes('ledger')) ||
    (hay.includes('unknown error') && hay.includes('ledger'))
  )
}

function ledgerSignMessageHint(context: 'sign-in' | 'safeguards' | 'generic'): string {
  if (context === 'safeguards') {
    return (
      'Ledger cannot complete Phantom/Owltopia Sign Message (error Code 1 / 0x6a81 is common). ' +
      'Tap “Sign safeguards with Ledger” below — approve the memo on the device (not broadcast, no Owltopia fee). ' +
      'Unlock Ledger, open the Solana app, close Ledger Live; prefer USB on desktop.'
    )
  }
  return (
    'Ledger cannot complete Phantom/Solflare Sign Message (error 0x6a81 is common). ' +
    'Tap “Sign with Ledger transaction” on My nest — approve the memo on the device (not broadcast, no Owltopia fee). ' +
    'Unlock Ledger, open the Solana app, close Ledger Live; prefer USB on desktop.'
  )
}

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

  // Ledger Solana app rejects Phantom/Solflare Lighthouse guard ixs ("Unexpected instruction").
  if (
    hay.includes('lighthouse') ||
    hay.includes('l2texmfkdjp') ||
    hay.includes('assertaccountinfo') ||
    (hay.includes('unexpected instruction') &&
      (hay.includes('ledger') || context === 'sign-in' || context === 'safeguards'))
  ) {
    const action =
      context === 'safeguards'
        ? 'then use “Sign safeguards with Ledger”'
        : 'then use “Sign with Ledger transaction”'
    const fallback =
      context === 'safeguards'
        ? 'If it still fails, sign safeguards from a hot wallet — wallet + Ledger limitation, not an Owltopia fee.'
        : 'If it still fails, sign in from a hot wallet — wallet + Ledger limitation, not an Owltopia fee.'
    return (
      'Phantom/Solflare added a Lighthouse security instruction that Ledger cannot clear-sign. ' +
      `Enable Blind signing in the Ledger Solana app, unlock the device, close Ledger Live, prefer USB, ${action}. ` +
      fallback
    )
  }

  if (
    hay.includes('does not support') ||
    hay.includes('signmessage is not a function') ||
    hay.includes('sign message not supported')
  ) {
    return `${walletLabel} does not support message signing. Try Phantom or Solflare, or a different account.`
  }

  // Phantom Ledger UI often says "Sign message rejected on Ledger device" (error Code 1).
  const rejectedOnDevice =
    hay.includes('sign message rejected') ||
    hay.includes('rejected on ledger') ||
    (hay.includes('error code 1') && (hay.includes('ledger') || hay.includes('hardware')))

  if (
    rejectedOnDevice ||
    isLedgerOffchainSignApduError(err) ||
    isLikelyHardwareWalletSignMessageFailure(err)
  ) {
    const lead =
      context === 'safeguards'
        ? rejectedOnDevice
          ? 'Hardware wallet did not complete the safeguards signature. Ledger rejected Phantom/Owltopia Sign Message (error Code 1).'
          : 'Hardware wallet did not complete the safeguards signature.'
        : context === 'sign-in'
          ? isLedgerOffchainSignApduError(err)
            ? 'Ledger rejected Sign Message (0x6a81) — Phantom/Solflare cannot finish off-chain signing on this device.'
            : isAmbiguousLedgerSignCancel(err)
              ? 'Ledger approved something, but Phantom/Solflare cancelled the Sign Message step (common with hardware wallets).'
              : 'Hardware wallet did not complete the nest sign-in message.'
          : 'Hardware wallet did not complete the message signature.'
    return `${lead} ${ledgerSignMessageHint(context)}`
  }

  if (msg && msg.toLowerCase() !== 'unexpected error' && msg.toLowerCase() !== 'unknown error') {
    return msg
  }

  return (
    `Wallet signing failed (${msg || 'unexpected error'}). ` +
    `Approve the Sign Message request in ${walletLabel}, or reconnect and try again. ${LEDGER_SIGN_MESSAGE_HINT}`
  )
}
