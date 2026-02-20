'use client'

import { useMemo, useState, useEffect, ReactNode } from 'react'
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react'
import { WalletAdapterNetwork } from '@solana/wallet-adapter-base'
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui'
import {
  CoinbaseWalletAdapter,
  TrustWalletAdapter,
} from '@solana/wallet-adapter-wallets'
import { SolflareWalletAdapterMobile } from '@/lib/solflare-adapter-mobile'
import {
  SolanaMobileWalletAdapter,
  createDefaultAddressSelector,
  createDefaultAuthorizationResultCache,
  createDefaultWalletNotFoundHandler,
} from '@solana-mobile/wallet-adapter-mobile'

import { isMobileDevice } from '@/lib/utils'
import '@solana/wallet-adapter-react-ui/styles.css'

/**
 * Phantom and Jupiter register as Standard Wallets and are discovered automatically.
 * Do NOT add PhantomWalletAdapter or JupiterWalletAdapter—they cause duplicate
 * registration warnings and Phantom extension content-script errors.
 */

interface WalletContextProviderProps {
  children: ReactNode
}

/** Inner provider; mounts only when page/extensions are ready, with autoConnect true from the start. */
function WalletContextProviderInner({ children }: WalletContextProviderProps) {
  const network = WalletAdapterNetwork.Mainnet
  const endpoint = useMemo(() => {
    const customRpc = process.env.NEXT_PUBLIC_SOLANA_RPC_URL
    if (customRpc && (customRpc.startsWith('http://') || customRpc.startsWith('https://'))) {
      return customRpc
    }
    return 'https://solana.drpc.org'
  }, [])

  // Build wallets only on client so extension/Standard Wallet is available and no SSR mismatch
  const wallets = useMemo(
    () => {
      const walletAdapters = []
      if (typeof window !== 'undefined' && isMobileDevice()) {
        walletAdapters.push(
          new SolanaMobileWalletAdapter({
            addressSelector: createDefaultAddressSelector(),
            appIdentity: {
              name: 'Owl Raffle',
              uri: window.location.origin,
              icon: `${window.location.origin}/icon.png`,
            },
            authorizationResultCache: createDefaultAuthorizationResultCache(),
            cluster: network === WalletAdapterNetwork.Mainnet
              ? 'mainnet-beta'
              : network === WalletAdapterNetwork.Devnet
              ? 'devnet'
              : network === WalletAdapterNetwork.Testnet
              ? 'testnet'
              : 'mainnet-beta',
            onWalletNotFound: createDefaultWalletNotFoundHandler(),
          })
        )
      }
      // Solflare: use adapter that passes redirect_link so mobile returns to this page and connection completes.
      walletAdapters.push(
        new SolflareWalletAdapterMobile({ network }),
        new CoinbaseWalletAdapter({ network }),
        new TrustWalletAdapter({ network })
      )
      return walletAdapters
    },
    [network]
  )

  // Mount with autoConnect true from the start so the adapter's effect runs once and restores session.
  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider 
        wallets={wallets} 
        autoConnect
        onError={(error) => {
          // Log all errors in development for debugging
          if (process.env.NODE_ENV === 'development') {
            console.log('Wallet adapter error:', {
              name: error?.name,
              message: error?.message,
              stack: error?.stack
            })
          }
          // Suppress known harmless extension errors
          const errorMessage = (error?.message || '').toLowerCase()
          const errorString = JSON.stringify(error || '').toLowerCase()
          const errorStack = (error?.stack || '').toLowerCase()
          const errorName = (error?.name || '').toLowerCase()
          
          // Check for WalletConnectionError with "Unexpected error" (common with StandardWallet adapters like Phantom)
          const isConnectionError = 
            errorName.includes('walletconnectionerror') ||
            errorName.includes('connectionerror') ||
            (errorMessage.includes('connection') && errorMessage.includes('error'))
          
          const isUnexpectedError = 
            errorMessage.includes('unexpected error') ||
            errorString.includes('unexpected error')
          
          // Check for WalletNotReadyError (common on mobile when wallet isn't installed/ready)
          const isWalletNotReady = 
            errorName.includes('walletnotready') ||
            errorMessage.includes('wallet not ready') ||
            errorString.includes('walletnotready') ||
            errorStack.includes('walletnotready')
          
          // Solflare-specific: iframe/CSP, connection, or extension errors (common with Solflare)
          const isSolflareError =
            errorMessage.includes('solflare') ||
            errorString.includes('solflare') ||
            errorStack.includes('solflare') ||
            errorMessage.includes('Solflare') ||
            errorStack.includes('content security policy') ||
            errorMessage.includes('Content Security Policy') ||
            (errorMessage.includes('iframe') && (errorStack.includes('solflare') || errorString.includes('solflare')))
          
          // These are common extension errors that don't affect functionality
          if (
            // WalletNotReadyError - expected on mobile when wallet isn't installed
            isWalletNotReady ||
            errorMessage.includes('solanaactionscontentscript') ||
            errorStack.includes('solanaactionscontentscript') ||
            errorMessage.includes('runtime.lasterror') ||
            errorMessage.includes('receiving end does not exist') ||
            errorMessage.includes('could not establish connection') ||
            errorString.includes('solanaactionscontentscript') ||
            errorString.includes('runtime.lasterror') ||
            // Phantom wallet service worker connection errors
            errorMessage.includes('disconnected port') ||
            errorMessage.includes('port object') ||
            errorMessage.includes('failed to send message to service worker') ||
            errorString.includes('disconnected port') ||
            errorString.includes('port object') ||
            errorString.includes('failed to send message to service worker') ||
            errorStack.includes('disconnected port') ||
            errorStack.includes('port object') ||
            // Phantom-specific cache update errors
            errorMessage.includes('[phantom]') ||
            errorString.includes('[phantom]') ||
            (errorMessage.includes('phantom') && (errorMessage.includes('error updating cache') || errorMessage.includes('connection'))) ||
            (errorString.includes('phantom') && (errorString.includes('error updating cache') || errorString.includes('connection'))) ||
            // StandardWallet adapter connection errors (Phantom, etc.)
            // These often occur when user cancels connection or extension is temporarily unavailable
            (isConnectionError && isUnexpectedError) ||
            (isConnectionError && errorStack.includes('standardwalletadapter')) ||
            (isConnectionError && errorStack.includes('_standardwalletadapter_connect')) ||
            // Catch "Something went wrong" from Solana extensions
            (errorMessage.includes('something went wrong') && (
              errorStack.includes('solana') ||
              errorString.includes('solana') ||
              errorMessage.includes('wallet') ||
              errorMessage.includes('extension')
            )) ||
            // Solflare: iframe/CSP or connection errors — avoid noisy logs
            isSolflareError
          ) {
            // Silently ignore - these are from browser extensions or user-initiated cancellations
            // WalletNotReadyError is expected on mobile when wallet isn't installed
            return
          }
          
          // Log other wallet errors for debugging (but don't show to user if it's a connection attempt)
          // Only log if it's not a user cancellation
          if (!errorMessage.includes('user rejected') && 
              !errorMessage.includes('user cancelled') &&
              !errorMessage.includes('user declined')) {
            // On mobile, log connection errors more verbosely for debugging
            const isMobile = typeof window !== 'undefined' && /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(
              navigator.userAgent || navigator.vendor || (window as any).opera || ''
            )
            if (isMobile && isConnectionError) {
              console.warn('Mobile wallet connection error:', {
                error,
                message: error?.message,
                name: error?.name,
                stack: error?.stack
              })
            } else {
              console.error('Wallet adapter error:', error)
            }
          }
        }}
      >
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  )
}

// Delay (ms) before showing wallet provider so extensions (Phantom, Standard Wallet) can inject.
// Avoids "wallet only connects after refresh" on desktop and mobile.
const WALLET_READY_DELAY_MS = 400

/**
 * Renders the wallet provider only after client mount and a short delay (or load event) so that:
 * - SSR/hydration mismatch is avoided (wallets differ when window is undefined)
 * - Wallet extensions (Phantom, etc.) and Standard Wallet have time to inject before autoConnect runs
 * - Inner provider mounts once with autoConnect=true so the adapter restores session without needing a refresh
 */
export function WalletContextProvider({ children }: WalletContextProviderProps) {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    let loadTimeoutId: ReturnType<typeof setTimeout> | null = null
    const go = () => {
      if (!cancelled) setReady(true)
    }

    // If document already loaded (e.g. client nav), wait a short delay so extensions are ready.
    if (typeof document !== 'undefined' && document.readyState === 'complete') {
      const t = setTimeout(go, WALLET_READY_DELAY_MS)
      return () => {
        cancelled = true
        clearTimeout(t)
      }
    }

    // Otherwise wait for load event (ensures extensions have injected), then small delay.
    const onLoad = () => {
      loadTimeoutId = setTimeout(go, 50)
    }
    window.addEventListener('load', onLoad, { once: true })
    const fallback = setTimeout(go, Math.max(WALLET_READY_DELAY_MS, 800))
    return () => {
      cancelled = true
      window.removeEventListener('load', onLoad)
      if (loadTimeoutId !== null) clearTimeout(loadTimeoutId)
      clearTimeout(fallback)
    }
  }, [])

  if (!ready) {
    return (
      <div className="min-h-screen flex flex-col bg-black" aria-busy="true" aria-label="Loading">
        <div className="flex-1 flex items-center justify-center">
          <span className="text-green-500/80 text-sm">Loading…</span>
        </div>
      </div>
    )
  }

  return <WalletContextProviderInner>{children}</WalletContextProviderInner>
}
