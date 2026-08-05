import type { WalletAdapter } from '@solana/wallet-adapter-base'
import type { Connection, PublicKey } from '@solana/web3.js'
import { isSolanaRpcRateLimitError } from '@/lib/solana-rpc-rate-limit'
import { getPhantomInjectedProviderForPublicKey } from '@/lib/solana/phantom-sign-and-send-transaction'
import { walletExtensionUnreachableHint } from '@/lib/solana/wallet-extension-errors'

function adapterIsPhantom(adapter: WalletAdapter): boolean {
  const n = String(adapter.name).toLowerCase()
  return n === 'phantom' || n.includes('phantom')
}

function adapterIsJupiter(adapter: WalletAdapter): boolean {
  const n = String(adapter.name).toLowerCase()
  return n === 'jupiter' || n.includes('jupiter')
}

function getJupiterInjectedProvider(): { publicKey?: { toBase58(): string } | null } | null {
  if (typeof window === 'undefined') return null
  const w = window as Window & {
    jupiter?: { solana?: { publicKey?: { toBase58(): string } | null } }
    Jupiter?: { solana?: { publicKey?: { toBase58(): string } | null } }
  }
  return w.jupiter?.solana ?? w.Jupiter?.solana ?? null
}

/**
 * Pre-flight before escrow sendTransaction / Metaplex signing.
 * Fails fast when the UI shows "connected" but signing cannot reach the wallet.
 */
export async function assertWalletReadyForSigning(params: {
  connected: boolean
  publicKey: PublicKey | null
  walletAdapter: WalletAdapter | null
  connection?: Connection
}): Promise<void> {
  const { connected, publicKey, walletAdapter, connection } = params

  if (!connected || !publicKey) {
    throw new Error(
      'Connect your wallet to continue. If it already shows connected, disconnect and connect again.'
    )
  }

  if (!walletAdapter) {
    throw new Error('Your wallet adapter is not ready. Refresh the page and reconnect your wallet.')
  }

  const walletName = String(walletAdapter.name || 'wallet')

  if (adapterIsPhantom(walletAdapter)) {
    const provider = getPhantomInjectedProviderForPublicKey(publicKey)
    if (!provider) {
      throw new Error(walletExtensionUnreachableHint('Phantom'))
    }
  }

  if (adapterIsJupiter(walletAdapter)) {
    // Jupiter is usually Wallet Standard only (no window.jupiter.solana). Only fail when an
    // injected provider exists but points at a different account than the connected adapter.
    const provider = getJupiterInjectedProvider()
    const injected = provider?.publicKey
    if (injected) {
      try {
        if (injected.toBase58() !== publicKey.toBase58()) {
          throw new Error(walletExtensionUnreachableHint('Jupiter'))
        }
      } catch (e) {
        if (e instanceof Error && /not reachable/i.test(e.message)) throw e
      }
    }
  }

  if (connection) {
    try {
      await connection.getLatestBlockhash('confirmed')
    } catch (err) {
      if (isSolanaRpcRateLimitError(err)) {
        throw new Error('Solana network is busy right now. Try Wi‑Fi, wait a moment, then try again.')
      }
    }
  }
}
