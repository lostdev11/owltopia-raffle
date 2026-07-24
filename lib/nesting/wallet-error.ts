import { isSolanaRpcRateLimitError } from '@/lib/solana-rpc-rate-limit'
import { isMplCoreNoApprovalsError } from '@/lib/solana/mpl-core-transfer-errors'

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
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

/** True when the holder cancelled / rejected the wallet prompt. */
export function isNestingWalletUserRejection(err: unknown): boolean {
  const hay = errorHaystack(err)
  return (
    hay.includes('user rejected') ||
    hay.includes('user cancelled') ||
    hay.includes('user canceled') ||
    hay.includes('user declined') ||
    hay.includes('rejected the request') ||
    hay.includes('transaction cancelled') ||
    hay.includes('transaction canceled')
  )
}

/**
 * True when a multi-NFT wallet tx likely exceeded size/compute limits — safe to retry one-by-one.
 * Do not use for user reject or generic failures (those should surface, not spam prompts).
 */
export function isNestingBatchSizeError(err: unknown): boolean {
  if (isNestingWalletUserRejection(err)) return false
  const hay = errorHaystack(err)
  return (
    hay.includes('transaction too large') ||
    hay.includes('too large') ||
    hay.includes('encoding overruns') ||
    hay.includes('max length') ||
    hay.includes('packet too large') ||
    hay.includes('versionedtransaction too large') ||
    hay.includes('exceeded max account') ||
    (hay.includes('computational budget') && hay.includes('exceeded'))
  )
}

/**
 * User-facing copy for nest open / wallet-lock failures (Backpack, Phantom, etc.).
 */
export function formatNestingWalletError(
  err: unknown,
  walletName?: string | null,
  assetSingular = 'NFT'
): string {
  const msg = errorMessage(err)
  if (!msg && !err) return 'Nest transaction failed'

  const hay = errorHaystack(err)
  const isBackpack = (walletName ?? '').toLowerCase().includes('backpack')
  const asset = assetSingular.trim() || 'NFT'

  if (isNestingWalletUserRejection(err)) {
    // Phantom/Solflare + Ledger often emits "Transaction cancelled" even after the user OK'd the device.
    if (
      (hay.includes('transaction cancelled') || hay.includes('transaction canceled')) &&
      !hay.includes('user rejected') &&
      !hay.includes('user declined') &&
      !hay.includes('rejected the request')
    ) {
      return (
        `Wallet reported the nest lock as cancelled after Ledger approval — common with Ledger via Phantom/Solflare on Metaplex nest locks. ` +
        `Nest one ${asset} at a time over USB, keep the Solana app open (Ledger Live closed), or nest from a hot wallet.`
      )
    }
    return 'Transaction cancelled in wallet.'
  }

  if (isMplCoreNoApprovalsError(hay)) {
    return (
      `This ${asset} could not be locked for nesting because its on-chain plugins did not approve the change (Metaplex error 0x1a). ` +
      'That often happens after a previous nest or when the collection restricts plugin changes. ' +
      'Close any old nest, confirm it is not listed for sale, or contact Owltopia support with the mint address.'
    )
  }

  if (isSolanaRpcRateLimitError(err)) {
    return (
      'Solana RPC is rate-limited, so your wallet could not load balances or prepare the nest transaction. ' +
      'Try again in a minute, switch WiFi/mobile data, or ask support to confirm NEXT_PUBLIC_SOLANA_RPC_URL uses a private RPC (Helius, etc.).'
    )
  }

  if (
    hay.includes('failed to fetch') ||
    hay.includes('networkerror') ||
    hay.includes('blockhash') ||
    hay.includes('403') ||
    hay.includes('access forbidden')
  ) {
    return (
      'Could not reach Solana RPC to prepare the nest transaction. Check your connection and try again. ' +
      'Backpack and other wallets rely on the site RPC for simulation and fees.'
    )
  }

  // Ledger + Solflare/Phantom: wallets inject Lighthouse ("Phantom protection") guard ixs that
  // Ledger's Solana app often surfaces as "Unexpected instruction" and will not clear-sign.
  // Match before the generic "instruction" / simulation branch below.
  if (
    hay.includes('unexpected instruction') ||
    hay.includes('lighthouse') ||
    hay.includes('l2texmfkdjp') ||
    hay.includes('assertaccountinfo') ||
    ((hay.includes('ledger') || hay.includes('blind signing') || hay.includes('blind-signing')) &&
      (hay.includes('instruction') || hay.includes('unknown program')))
  ) {
    return (
      `Your wallet added a Lighthouse security instruction that Ledger cannot clear-sign for this nest lock. ` +
      `That is a Solflare/Phantom + Ledger limitation (not an Owltopia nest bug). ` +
      `Nest one ${asset} at a time from a hot wallet, or transfer the ${asset} to a hot wallet and nest there.`
    )
  }

  // Ledger-via-Phantom/Solflare often never surfaces complex MPL Core nest locks on-device.
  if (
    hay.includes('ledger') ||
    hay.includes('blind signing') ||
    hay.includes('blind-signing') ||
    hay.includes('device timeout') ||
    hay.includes('u2f') ||
    hay.includes('hid') ||
    hay.includes('bluetooth') ||
    hay.includes('transport') ||
    hay.includes('unexpected error')
  ) {
    return (
      `Nest lock did not reach your hardware wallet for approval. ` +
      `Unlock Ledger, open the Solana app (close Ledger Live), enable Blind signing, and nest one ${asset} at a time. ` +
      `USB/WebHID on desktop is more reliable than Bluetooth. If the device never prompts, nest from a hot wallet.`
    )
  }

  if (
    hay.includes('simulation') ||
    hay.includes('simulación') ||
    hay.includes('algo salió mal') ||
    hay.includes('failed to process') ||
    hay.includes('instruction')
  ) {
    const backpackHint = isBackpack
      ? ` In Backpack, confirm you own the ${asset}, it is not listed for sale, and you have a little SOL for fees. If simulation keeps failing, try Phantom or Solflare for the wallet-lock step.`
      : ` Confirm you own the ${asset}, it is not delegated or listed, and you have SOL for fees.`
    return `Your wallet rejected the nest lock transaction during simulation.${backpackHint}`
  }

  return msg || 'Nest transaction failed'
}
