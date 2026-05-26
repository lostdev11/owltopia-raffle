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

/**
 * User-facing copy for nest open / wallet-lock failures (Backpack, Phantom, etc.).
 */
export function formatNestingWalletError(err: unknown, walletName?: string | null): string {
  const msg = errorMessage(err)
  if (!msg && !err) return 'Nest transaction failed'

  const hay = errorHaystack(err)
  const isBackpack = (walletName ?? '').toLowerCase().includes('backpack')

  if (isMplCoreNoApprovalsError(hay)) {
    return (
      'This Owltopia coin could not be locked for nesting because its on-chain plugins did not approve the change (Metaplex error 0x1a). ' +
      'That often happens after a previous nest or when the collection restricts plugin changes. ' +
      'Close any old nest, confirm the coin is not listed for sale, or contact Owltopia support with the mint address.'
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

  if (
    hay.includes('simulation') ||
    hay.includes('simulación') ||
    hay.includes('algo salió mal') ||
    hay.includes('failed to process') ||
    hay.includes('instruction')
  ) {
    const backpackHint = isBackpack
      ? ' In Backpack, confirm you own the Owltopia coin, it is not listed for sale, and you have a little SOL for fees. If simulation keeps failing, try Phantom or Solflare for the wallet-lock step.'
      : ' Confirm you own the Owltopia coin, it is not delegated or listed, and you have SOL for fees.'
    return `Your wallet rejected the nest lock transaction during simulation.${backpackHint}`
  }

  if (
    hay.includes('user rejected') ||
    hay.includes('user cancelled') ||
    hay.includes('user declined') ||
    hay.includes('rejected the request')
  ) {
    return 'Transaction cancelled in wallet.'
  }

  return msg || 'Nest transaction failed'
}
