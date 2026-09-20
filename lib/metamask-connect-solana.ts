/**
 * MetaMask Connect Solana — registers MetaMask with Wallet Standard so
 * @solana/wallet-adapter-react discovers it (same path as Phantom/Jupiter).
 * Call once on the client before mounting WalletProvider.
 */

import { createSolanaClient } from '@metamask/connect-solana'
import { getSiteBaseUrl, PLATFORM_NAME } from '@/lib/site-config'
import { resolvePublicSolanaRpcUrl, resolveWalletAdapterRpcUrl } from '@/lib/solana-rpc-url'
import { getSolanaRpcUrl, isDevnetMintEnabled, walletAdapterShouldUseDevnet } from '@/lib/solana/network'

let initPromise: Promise<void> | null = null

function resolveDappOrigin(): string {
  if (typeof window === 'undefined') return getSiteBaseUrl()
  const host = window.location.hostname
  if (host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local')) {
    return window.location.origin
  }
  try {
    return new URL(getSiteBaseUrl()).origin
  } catch {
    return window.location.origin
  }
}

function buildSupportedNetworks(): { mainnet: string; devnet?: string } {
  const mainnet = resolveWalletAdapterRpcUrl()
  if (walletAdapterShouldUseDevnet()) {
    const devnet = isDevnetMintEnabled() ? getSolanaRpcUrl() : resolvePublicSolanaRpcUrl()
    return { mainnet, devnet }
  }
  return {
    mainnet,
    // Extension can still switch to devnet; give a public fallback.
    devnet: 'https://api.devnet.solana.com',
  }
}

/**
 * Registers MetaMask with the Wallet Standard registry.
 * Safe to call multiple times (singleton). Failures are logged; callers should
 * still mount WalletProvider so Phantom/Solflare/MWA keep working.
 */
export function ensureMetaMaskSolanaRegistered(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve()
  if (!initPromise) {
    initPromise = (async () => {
      const origin = resolveDappOrigin()
      await createSolanaClient({
        dapp: {
          name: PLATFORM_NAME,
          url: origin,
          iconUrl: `${origin}/icon.png`,
        },
        api: {
          supportedNetworks: buildSupportedNetworks(),
        },
        analytics: {
          enabled: false,
        },
      })
    })().catch((err) => {
      console.warn('[metamask-connect-solana] createSolanaClient failed; MetaMask may not appear', err)
      // Allow a later retry after a soft failure (e.g. transient relay).
      initPromise = null
    })
  }
  return initPromise ?? Promise.resolve()
}
