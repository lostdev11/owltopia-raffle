import type { WalletAdapter } from '@solana/wallet-adapter-base'
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults'
import { createNoopSigner, publicKey, signerIdentity, type Umi } from '@metaplex-foundation/umi'
import { walletAdapterIsPhantom } from '@/lib/solana/phantom-sign-and-send-transaction'
import type { WalletSendTransactionFn } from '@/lib/solana/send-umi-builder-via-wallet'

/**
 * Phantom Blowfish / Lighthouse rules for Owltopia wallet txs:
 * - Prefer `signAndSendTransaction` (via `useSendTransactionForWallet`) so Phantom can inject
 *   Lighthouse guards — do not sign-then-sendRaw or UMI `sendAndConfirm` on Phantom.
 * - Keep txs unsigned until the wallet sends them (noop UMI identity when building).
 * - One fee-payer signer only (no partial site signers on the same prompt).
 * - Pre-simulate with `sigVerify: false` (see `phantom-presimulate.ts` + signAndSend helpers).
 *
 * @see https://docs.phantom.com/developer-powertools/domain-and-transaction-warnings
 * @see https://docs.phantom.com/developer-powertools/lighthouse
 */

export function resolveWalletAdapter(wallet: unknown): WalletAdapter | null {
  if (!wallet || typeof wallet !== 'object') return null
  const w = wallet as { adapter?: WalletAdapter; name?: string }
  if (w.adapter && typeof (w.adapter as WalletAdapter).name === 'string') return w.adapter
  if (typeof w.name === 'string') return w as WalletAdapter
  return null
}

/** Build unsigned UMI context for wallet signAndSend (Blowfish can still inject guards). */
export function createNoopUmiForPhantomSafeSend(endpoint: string, ownerBase58: string): Umi {
  return (createUmi as any)(endpoint).use(
    signerIdentity(createNoopSigner(publicKey(ownerBase58)))
  ) as Umi
}

/**
 * Phantom must not use UMI `walletAdapterIdentity` + `sendAndConfirm` — that path triggers
 * "This dApp could be malicious" because Blowfish cannot inject Lighthouse guards.
 */
export function assertPhantomUsesWalletSignAndSend(params: {
  wallet: unknown
  sendTransaction?: WalletSendTransactionFn
  action?: string
}): void {
  const adapter = resolveWalletAdapter(params.wallet)
  if (!adapter || !walletAdapterIsPhantom(adapter)) return
  if (params.sendTransaction) return
  const action = params.action ?? 'this transfer'
  throw new Error(
    `Phantom requires signAndSendTransaction for ${action} so Blowfish can validate the transaction. ` +
      'Refresh the page and try again, or use Solflare.'
  )
}

/** User-facing copy when Phantom/Blowfish blocks an escrow deposit prompt. */
export function formatPhantomBlockedEscrowMessage(raw?: string): string | null {
  const low = (raw ?? '').toLowerCase()
  if (
    !low.includes('blocked') &&
    !low.includes('malicious') &&
    !low.includes('dapp could be') &&
    !low.includes('could be malicious')
  ) {
    return null
  }
  return (
    'Your wallet blocked this escrow deposit for security. ' +
      'Owltopia uses Phantom’s signAndSend path with a pre-simulation check so Blowfish can validate the transfer. ' +
      'If this keeps happening after a successful sim, ask Phantom to review owltopia.xyz (see PHANTOM_DOMAIN_REVIEW.md) or try Solflare / another network (Wi‑Fi vs mobile data).'
  )
}
