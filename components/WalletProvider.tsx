'use client'

import { useMemo, ReactNode } from 'react'
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react'
import { WalletAdapterNetwork } from '@solana/wallet-adapter-base'
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui'
import {
  SolflareWalletAdapter,
} from '@solana/wallet-adapter-wallets'
import { clusterApiUrl } from '@solana/web3.js'

// Import wallet adapter CSS
import '@solana/wallet-adapter-react-ui/styles.css'

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

  // @solana/wallet-adapter-wallets includes all the adapters but supports tree shaking --
  // Only the wallets you configure here will be compiled into your application
  // Note: Phantom is now a Standard Wallet and doesn't need an explicit adapter
  const wallets = useMemo(
    () => [
      new SolflareWalletAdapter(),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [network]
  )

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider 
        wallets={wallets} 
        autoConnect={false}
        onError={(error) => {
          // Suppress known harmless extension errors
          const errorMessage = (error?.message || '').toLowerCase()
          const errorString = JSON.stringify(error || '').toLowerCase()
          const errorStack = (error?.stack || '').toLowerCase()
          
          // These are common extension errors that don't affect functionality
          if (
            errorMessage.includes('solanaactionscontentscript') ||
            errorStack.includes('solanaactionscontentscript') ||
            errorMessage.includes('runtime.lasterror') ||
            errorMessage.includes('receiving end does not exist') ||
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
            // Catch "Something went wrong" from Solana extensions
            (errorMessage.includes('something went wrong') && (
              errorStack.includes('solana') ||
              errorString.includes('solana') ||
              errorMessage.includes('wallet') ||
              errorMessage.includes('extension')
            ))
          ) {
            // Silently ignore - these are from browser extensions
            return
          }
          
          // Log other wallet errors for debugging
          console.error('Wallet adapter error:', error)
        }}
      >
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  )
}
