'use client'

import { useMemo, ReactNode, useEffect } from 'react'
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react'
import { BaseWalletAdapter, WalletAdapterNetwork, WalletError, WalletReadyState, WalletName } from '@solana/wallet-adapter-base'
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui'
import {
  PhantomWalletAdapter,
  SolflareWalletAdapter,
  CoinbaseWalletAdapter,
  TrustWalletAdapter,
} from '@solana/wallet-adapter-wallets'
import { PublicKey, Transaction, VersionedTransaction } from '@solana/web3.js'
import {
  SolanaMobileWalletAdapter,
  createDefaultAddressSelector,
  createDefaultAuthorizationResultCache,
  createDefaultWalletNotFoundHandler,
} from '@solana-mobile/wallet-adapter-mobile'
import { clusterApiUrl } from '@solana/web3.js'

// Import wallet adapter CSS
import '@solana/wallet-adapter-react-ui/styles.css'

// Custom Jupiter Wallet Adapter
// Jupiter Wallet injects itself into window.solana when installed
const JupiterWalletName = 'Jupiter' as WalletName<'Jupiter'>

class JupiterWalletAdapter extends BaseWalletAdapter {
  readonly name = JupiterWalletName
  url = 'https://jup.ag'
  icon = 'https://jup.ag/favicon.ico'
  supportedTransactionVersions: Set<'legacy' | 0> = new Set(['legacy', 0])

  private _publicKey: PublicKey | null = null
  private _connecting = false
  private _provider: any = null

  constructor(config?: { network?: WalletAdapterNetwork }) {
    super()
    
    // Check if Jupiter Wallet is installed
    // Jupiter Wallet injects itself into window.solana following the Solana Wallet Standard
    if (typeof window !== 'undefined') {
      const solana = (window as any).solana
      // Check for Jupiter-specific identifier
      // Jupiter Wallet may identify itself via isJupiter, isJupiterWallet, or other properties
      // We check for Jupiter-specific properties first
      if (solana && (solana.isJupiter || solana.isJupiterWallet)) {
        this._provider = solana
      } else if (solana && !solana.isPhantom && !solana.isSolflare) {
        // Fallback: If window.solana exists and it's not Phantom or Solflare,
        // it could be Jupiter or another wallet. We'll check on connect if it's available.
        // Note: This is a best-effort detection and may conflict with other wallets
        // In practice, Jupiter Wallet should set a specific identifier
        this._provider = solana
      }
    }
  }

  get publicKey(): PublicKey | null {
    return this._publicKey
  }

  get connecting(): boolean {
    return this._connecting
  }

  get ready(): boolean {
    return typeof window !== 'undefined' && !!this._provider
  }

  get readyState(): WalletReadyState {
    if (typeof window === 'undefined') {
      return WalletReadyState.Unsupported
    }
    return this._provider ? WalletReadyState.Installed : WalletReadyState.NotDetected
  }

  async connect(): Promise<void> {
    try {
      if (this._publicKey || this._connecting) return
      if (!this._provider) {
        throw new WalletError(
          'Jupiter Wallet not found. Please install Jupiter Wallet extension.'
        )
      }

      this._connecting = true

      try {
        // Connect to the wallet
        const response = await this._provider.connect()
        this._publicKey = new PublicKey(response.publicKey)
        this.emit('connect', this._publicKey)
      } catch (error: any) {
        // Handle connection errors
        throw error
      } finally {
        this._connecting = false
      }
    } catch (error: any) {
      this.emit('error', error)
      throw error
    }
  }

  async disconnect(): Promise<void> {
    const provider = this._provider
    if (provider) {
      this._publicKey = null

      try {
        await provider.disconnect()
      } catch (error: any) {
        this.emit('error', error)
      }

      this.emit('disconnect')
    }
  }

  async sendTransaction<T extends Transaction | VersionedTransaction>(
    transaction: T,
    connection: any,
    options?: any
  ): Promise<string> {
    if (!this._provider) {
      throw new WalletError(
        'Wallet not connected'
      )
    }

    try {
      // Use sendTransaction if available, otherwise fall back to sign and send
      if (this._provider.sendTransaction) {
        return await this._provider.sendTransaction(transaction, connection, options)
      } else {
        // Fallback: sign and send manually
        const signed = await this.signTransaction(transaction)
        return await connection.sendRawTransaction(signed.serialize(), options)
      }
    } catch (error: any) {
      this.emit('error', error)
      throw error
    }
  }

  async signTransaction<T extends Transaction | VersionedTransaction>(
    transaction: T
  ): Promise<T> {
    if (!this._provider) {
      throw new WalletError(
        'Wallet not connected'
      )
    }

    try {
      const signed = await this._provider.signTransaction(transaction)
      return signed
    } catch (error: any) {
      this.emit('error', error)
      throw error
    }
  }

  async signAllTransactions<T extends Transaction | VersionedTransaction>(
    transactions: T[]
  ): Promise<T[]> {
    if (!this._provider) {
      throw new WalletError(
        'Wallet not connected'
      )
    }

    try {
      if (this._provider.signAllTransactions) {
        return await this._provider.signAllTransactions(transactions)
      } else {
        // Fallback: sign transactions individually
        return await Promise.all(
          transactions.map((tx) => this.signTransaction(tx))
        )
      }
    } catch (error: any) {
      this.emit('error', error)
      throw error
    }
  }

  async signMessage(message: Uint8Array): Promise<Uint8Array> {
    if (!this._provider) {
      throw new WalletError(
        'Wallet not connected'
      )
    }

    try {
      if (this._provider.signMessage) {
        const response = await this._provider.signMessage(message)
        return response.signature
      } else {
        throw new WalletError(
          'Message signing not supported'
        )
      }
    } catch (error: any) {
      this.emit('error', error)
      throw error
    }
  }
}

interface WalletContextProviderProps {
  children: ReactNode
}

export function WalletContextProvider({ children }: WalletContextProviderProps) {
  // You can also provide a custom RPC endpoint
  // IMPORTANT: Public RPC endpoints (clusterApiUrl) are rate-limited and may return 403 errors
  // For production, use a private RPC endpoint from Helius, QuickNode, or Alchemy
  // Set NEXT_PUBLIC_SOLANA_RPC_URL in your .env.local file
  const network = WalletAdapterNetwork.Mainnet
  const endpoint = useMemo(() => {
    const customRpc = process.env.NEXT_PUBLIC_SOLANA_RPC_URL
    // Validate that the RPC URL is a valid HTTP/HTTPS URL
    if (customRpc && (customRpc.startsWith('http://') || customRpc.startsWith('https://'))) {
      return customRpc
    }
    // Fallback to a more reliable public endpoint (drpc.org has better rate limits)
    // For production, always set NEXT_PUBLIC_SOLANA_RPC_URL to a private endpoint
    return 'https://solana.drpc.org'
  }, [network])

  // Configure wallet adapters
  // Note: On Android devices, Standard Wallet detection may not work reliably in regular browsers.
  // We explicitly add adapters for better mobile support, especially for Android devices.
  const wallets = useMemo(
    () => {
      // Create wallet adapters
      // For desktop: Explicitly include PhantomWalletAdapter for reliable desktop browser extension support
      // For mobile: Include Mobile Wallet Adapter (MWA) for proper Android support
      // Note: PhantomWalletAdapter works on both desktop (browser extension) and mobile (Phantom browser)
      // SolanaMobileWalletAdapter: Proper MWA support for Android devices - must be included first for mobile
      // SolflareWalletAdapter: Supports both desktop and deep links on mobile (fallback)
      // CoinbaseWalletAdapter: Additional mobile wallet option
      // TrustWalletAdapter: Popular Android wallet option
      const walletAdapters = [
        // Mobile Wallet Adapter - provides proper MWA protocol support on Android
        // This should be first to ensure it's available when needed on mobile devices
        new SolanaMobileWalletAdapter({
          addressSelector: createDefaultAddressSelector(),
          appIdentity: {
            name: 'Owl Raffle',
            uri: typeof window !== 'undefined' ? window.location.origin : 'https://owltopia.xyz',
            icon: typeof window !== 'undefined' ? `${window.location.origin}/icon.png` : '/icon.png',
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
        }),
        // Phantom wallet - explicit for desktop browser extension support
        // Also works in Phantom mobile browser
        new PhantomWalletAdapter({ network }),
        // Solflare - supports desktop and deep links on mobile (fallback if MWA not available)
        new SolflareWalletAdapter({ 
          network,
          // Ensure proper mobile deep link handling
          // The adapter will use the current page URL as redirect_link
          // Make sure the page URL is accessible for deep link callbacks
        }),
        // Jupiter Wallet - browser extension wallet
        new JupiterWalletAdapter({ network }),
        // Additional mobile wallet options for Android
        new CoinbaseWalletAdapter({ network }),
        new TrustWalletAdapter({ network }),
      ]
      
      // Log available wallets for debugging (only in development)
      if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
        // Wait a bit for wallet detection to complete
        setTimeout(() => {
          const isMobile = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(
            navigator.userAgent || navigator.vendor || (window as any).opera || ''
          )
          const isAndroid = /android/i.test(
            navigator.userAgent || navigator.vendor || (window as any).opera || ''
          )
          const isPhantomBrowser = navigator.userAgent?.toLowerCase().includes('phantom') || false
          const phantomAvailable = !!(window as any).solana?.isPhantom || !!(window as any).phantom?.solana
          
          const adapterStates = walletAdapters.map(w => ({
            name: w.name,
            readyState: w.readyState,
            icon: w.icon
          }))
          
          console.log('Wallet adapters initialized:', walletAdapters.map(w => w.name))
          console.log('Adapter states:', adapterStates)
          console.log('Environment:', {
            isMobile,
            isAndroid,
            isPhantomBrowser,
            phantomExtensionAvailable: phantomAvailable,
            solanaObject: !!(window as any).solana,
            phantomObject: !!(window as any).phantom,
            userAgent: navigator.userAgent
          })
          
            // Android-specific logging
            if (isAndroid) {
              console.log('Android device detected - Mobile Wallet Adapter (MWA) is available')
              console.log('Mobile Wallet Adapter (SolanaMobileWalletAdapter) should handle MWA-compatible wallets')
              console.log('Available wallet adapters for Android:', adapterStates.filter(a => 
                ['Solana Mobile', 'Solflare', 'Coinbase', 'Trust'].includes(a.name)
              ).map(a => a.name))
              console.log('Note: Phantom is automatically detected as a Standard Wallet and will be available if installed')
              console.log('Note: SolanaMobileWalletAdapter uses the MWA protocol for better Android wallet compatibility')
            }
        }, 500)
      }
      
      return walletAdapters
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [network]
  )

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider 
        wallets={wallets} 
        autoConnect={false}
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
            ))
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
