import type { WalletAdapter } from '@solana/wallet-adapter-base'
import type { Connection, PublicKey } from '@solana/web3.js'
import { isSolanaRpcRateLimitError } from '@/lib/solana-rpc-rate-limit'
import { getPhantomInjectedProviderForPublicKey } from '@/lib/solana/phantom-sign-and-send-transaction'

function adapterIsPhantom(adapter: WalletAdapter): boolean {
  const n = String(adapter.name).toLowerCase()
  return n === 'phantom' || n.includes('phantom')
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

  if (adapterIsPhantom(walletAdapter)) {
    const provider = getPhantomInjectedProviderForPublicKey(publicKey)
    if (!provider) {
      throw new Error(
        'Phantom is connected in the browser but the wallet app is not reachable. Open Phantom, unlock it, then refresh this page.'
      )
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
