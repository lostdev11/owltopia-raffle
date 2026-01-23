'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useWallet } from '@solana/wallet-adapter-react'
import { WalletMultiButton, useWalletModal } from '@solana/wallet-adapter-react-ui'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { isMobileDevice, isAndroidDevice, isPhantomBrowser, isPhantomExtensionAvailable, redirectToPhantomBrowser } from '@/lib/utils'

export function WalletConnectButton() {
  const router = useRouter()
  const { publicKey, connected, disconnect, signMessage, wallet, connecting, connect } = useWallet()
  const { setVisible } = useWalletModal()
  const [mounted, setMounted] = useState(false)
  const [showSignDialog, setShowSignDialog] = useState(false)
  const [isSigning, setIsSigning] = useState(false)
  const [signError, setSignError] = useState<string | null>(null)
  const [showPhantomRedirectDialog, setShowPhantomRedirectDialog] = useState(false)
  const prevConnectedRef = useRef(false)
  const buttonRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setMounted(true)
    
    // Check on mount if we're on a blank page from a previous mobile wallet connection attempt (Android fix)
    // This handles all mobile wallets: Solflare, Phantom, Coinbase, Trust, etc.
    if (isAndroidDevice()) {
      const checkBlankPage = () => {
        // Only check if document is ready
        if (document.readyState === 'loading') return
        
        const currentHref = window.location.href
        const isBlankPage = 
          currentHref === 'about:blank' ||
          currentHref === 'chrome-error://chromewebdata/' ||
          (document.body && document.body.textContent?.trim() === '' && document.body.children.length === 0 && document.body.innerHTML.trim() === '')
        
        if (isBlankPage) {
          // Check for stored redirect URL from any mobile wallet
          // Try wallet-specific keys first, then generic key
          const walletNames = ['solflare', 'phantom', 'coinbase', 'trust', 'solana_mobile']
          let storedUrl: string | null = null
          let walletName: string | null = null
          
          for (const wallet of walletNames) {
            const key = `${wallet}_redirect_url`
            const url = sessionStorage.getItem(key)
            if (url) {
              storedUrl = url
              walletName = wallet
              break
            }
          }
          
          // Fallback to generic key
          if (!storedUrl) {
            storedUrl = sessionStorage.getItem('mobile_wallet_redirect_url')
          }
          
          if (storedUrl) {
            if (process.env.NODE_ENV === 'development') {
              console.log(`Detected blank page on mount (${walletName || 'unknown wallet'}), redirecting to stored URL:`, storedUrl)
            }
            window.location.href = storedUrl
            return
          }
          
          // If no stored URL but we're on blank page, try to go back or redirect to origin
          try {
            if (window.history.length > 1) {
              window.history.back()
            } else {
              window.location.href = window.location.origin
            }
          } catch (e) {
            window.location.href = window.location.origin
          }
        }
      }
      
      // Check when document is ready
      if (document.readyState === 'complete') {
        checkBlankPage()
      } else {
        const handleReady = () => {
          checkBlankPage()
          document.removeEventListener('DOMContentLoaded', handleReady)
        }
        document.addEventListener('DOMContentLoaded', handleReady)
      }
      
      // Also check after a delay as fallback
      setTimeout(checkBlankPage, 1000)
    }
  }, [])

  // Handle mobile deep link return - clean up URL parameters
  // Enhanced for Android blank page fix - handles all mobile wallets
  useEffect(() => {
    if (!mounted) return

    const isMobile = isMobileDevice()
    if (!isMobile) return

    // Check URL for deep link callback parameters and clean them up
    const checkUrlParams = () => {
      const urlParams = new URLSearchParams(window.location.search)
      const hashParams = new URLSearchParams(window.location.hash.substring(1))
      
      // Check for deep link callback parameters from all supported wallets
      // Phantom: phantom_encryption_public_key, dapp_encryption_public_key
      // Solflare: data, nonce
      // Coinbase: account, redirect_uri (may vary)
      // Trust: account, redirect_uri (may vary)
      // Generic: any wallet-specific params
      const hasCallback = 
        urlParams.has('phantom_encryption_public_key') || 
        urlParams.has('dapp_encryption_public_key') ||
        urlParams.has('data') || // Solflare callback
        urlParams.has('nonce') || // Solflare callback
        urlParams.has('account') || // Coinbase/Trust callback
        urlParams.has('redirect_uri') || // Generic callback
        hashParams.has('phantom_encryption_public_key') ||
        hashParams.has('dapp_encryption_public_key') ||
        hashParams.has('data') || // Solflare callback
        hashParams.has('nonce') || // Solflare callback
        hashParams.has('account') || // Coinbase/Trust callback
        hashParams.has('redirect_uri') // Generic callback
      
      if (hasCallback) {
        // On Android, ensure we're not on a blank page before cleaning
        if (isAndroidDevice()) {
          const currentHref = window.location.href
          const isBlankPage = 
            currentHref === 'about:blank' ||
            currentHref === 'chrome-error://chromewebdata/'
          
          if (isBlankPage) {
            // If we're on blank page but have callback params, redirect to stored URL
            // Check for stored URLs from any mobile wallet
            const walletNames = ['solflare', 'phantom', 'coinbase', 'trust', 'solana_mobile']
            let storedUrl: string | null = null
            let walletName: string | null = null
            
            for (const wallet of walletNames) {
              const key = `${wallet}_redirect_url`
              const url = sessionStorage.getItem(key)
              if (url) {
                storedUrl = url
                walletName = wallet
                break
              }
            }
            
            // Fallback to generic key
            if (!storedUrl) {
              storedUrl = sessionStorage.getItem('mobile_wallet_redirect_url')
            }
            
            if (storedUrl) {
              // Merge callback params with stored URL
              const storedUrlObj = new URL(storedUrl)
              urlParams.forEach((value, key) => {
                storedUrlObj.searchParams.set(key, value)
              })
              hashParams.forEach((value, key) => {
                storedUrlObj.searchParams.set(key, value)
              })
              
              if (process.env.NODE_ENV === 'development') {
                console.log(`Redirecting from blank page with callback params (${walletName || 'unknown wallet'}) to:`, storedUrlObj.toString())
              }
              window.location.href = storedUrlObj.toString()
              return
            }
          }
        }
        
        // Clean up URL parameters after processing (but keep them for adapter to process)
        // Only clean if we're not in the middle of a connection
        if (!connecting) {
          setTimeout(() => {
            const cleanUrl = window.location.pathname
            window.history.replaceState({}, '', cleanUrl)
          }, 1000) // Delay to allow adapter to process callback
        }
      }
    }

    // When page becomes visible again (returning from wallet app), clean up URL
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        // Small delay to allow page to fully load
        setTimeout(checkUrlParams, 300)
      }
    }

    // Check URL on mount and when page becomes visible
    checkUrlParams()
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [mounted, connecting])

  // Monitor connection state changes (debug only in development)
  useEffect(() => {
    if (mounted && process.env.NODE_ENV === 'development') {
      console.log('Wallet state:', { 
        connected, 
        connecting, 
        wallet: wallet?.adapter?.name,
        publicKey: publicKey?.toBase58(),
        walletReadyState: wallet?.adapter?.readyState
      })
    }
  }, [mounted, connected, connecting, wallet, publicKey])

  // Handle all mobile wallet connections on Android - ensure proper deep linking
  // Fix for Android blank page issue when connecting any mobile wallet
  useEffect(() => {
    if (!mounted || !isMobileDevice() || !isAndroidDevice()) return

    // List of mobile wallets that use deep links on Android
    const mobileWalletNames = ['Solflare', 'Phantom', 'Coinbase', 'Trust', 'Solana Mobile']
    
    // Store the original URL before any mobile wallet connection on Android
    if (connecting && wallet?.adapter?.name) {
      const walletName = wallet.adapter.name
      
      // Check if this is a mobile wallet that might use deep links
      const isMobileWallet = mobileWalletNames.some(name => 
        walletName.toLowerCase().includes(name.toLowerCase())
      )
      
      if (isMobileWallet) {
        const currentUrl = window.location.href.split('?')[0].split('#')[0]
        
        // Normalize wallet name for storage key (lowercase, replace spaces with underscores)
        const walletKey = walletName.toLowerCase().replace(/\s+/g, '_')
        const storageKey = `${walletKey}_redirect_url`
        
        // Store the original URL in sessionStorage for recovery
        sessionStorage.setItem(storageKey, currentUrl)
        // Also store in generic key as fallback
        sessionStorage.setItem('mobile_wallet_redirect_url', currentUrl)
        
        if (process.env.NODE_ENV === 'development') {
          console.log(`${walletName} connection on Android - stored redirect URL:`, currentUrl)
        }

        // Set up a visibility change listener to detect when we return from wallet app
        const handleVisibilityChange = () => {
          if (document.visibilityState === 'visible') {
            // Check if we're on a blank page or error page
            setTimeout(() => {
              const currentHref = window.location.href
              const isBlankPage = 
                currentHref === 'about:blank' ||
                currentHref === 'chrome-error://chromewebdata/' ||
                document.body?.textContent?.trim() === '' ||
                (document.body?.children?.length === 0 && !document.body?.textContent)
              
              // Get stored URL (try wallet-specific first, then generic)
              let storedUrl = sessionStorage.getItem(storageKey)
              if (!storedUrl) {
                storedUrl = sessionStorage.getItem('mobile_wallet_redirect_url')
              }
              
              // If we're on a blank page, redirect back to the original URL
              if (isBlankPage && storedUrl) {
                if (process.env.NODE_ENV === 'development') {
                  console.log(`Detected blank page after ${walletName} connection, redirecting to:`, storedUrl)
                }
                window.location.href = storedUrl
                return
              }
              
              // Check for wallet callback parameters in URL
              const urlParams = new URLSearchParams(window.location.search)
              const hashParams = new URLSearchParams(window.location.hash.substring(1))
              
              // Check for callback parameters based on wallet type
              let hasCallback = false
              if (walletName.toLowerCase().includes('solflare')) {
                hasCallback = urlParams.has('data') || urlParams.has('nonce') ||
                             hashParams.has('data') || hashParams.has('nonce')
              } else if (walletName.toLowerCase().includes('phantom')) {
                hasCallback = urlParams.has('phantom_encryption_public_key') ||
                             urlParams.has('dapp_encryption_public_key') ||
                             hashParams.has('phantom_encryption_public_key') ||
                             hashParams.has('dapp_encryption_public_key')
              } else {
                // Generic callback detection for Coinbase, Trust, etc.
                hasCallback = urlParams.has('account') || urlParams.has('redirect_uri') ||
                             hashParams.has('account') || hashParams.has('redirect_uri') ||
                             urlParams.toString().length > 0 || hashParams.toString().length > 0
              }
              
              // If we have callback params but are on wrong page, redirect to stored URL
              if (hasCallback && storedUrl && !currentHref.startsWith(storedUrl.split('?')[0])) {
                // Merge callback params with stored URL
                const storedUrlObj = new URL(storedUrl)
                urlParams.forEach((value, key) => {
                  storedUrlObj.searchParams.set(key, value)
                })
                hashParams.forEach((value, key) => {
                  storedUrlObj.searchParams.set(key, value)
                })
                
                if (process.env.NODE_ENV === 'development') {
                  console.log(`Redirecting to stored URL with callback params (${walletName}):`, storedUrlObj.toString())
                }
                window.location.href = storedUrlObj.toString()
              }
            }, 500) // Small delay to allow page to load
          }
        }

        document.addEventListener('visibilitychange', handleVisibilityChange)
        
        // Also check on page load/focus in case visibility change didn't fire
        const handleFocus = () => {
          setTimeout(() => {
            const currentHref = window.location.href
            let storedUrl = sessionStorage.getItem(storageKey)
            if (!storedUrl) {
              storedUrl = sessionStorage.getItem('mobile_wallet_redirect_url')
            }
            
            if (storedUrl && (currentHref === 'about:blank' || currentHref.includes('chrome-error'))) {
              if (process.env.NODE_ENV === 'development') {
                console.log(`Detected blank/error page on focus (${walletName}), redirecting to:`, storedUrl)
              }
              window.location.href = storedUrl
            }
          }, 500)
        }

        window.addEventListener('focus', handleFocus)
        
        return () => {
          document.removeEventListener('visibilitychange', handleVisibilityChange)
          window.removeEventListener('focus', handleFocus)
          // Clean up stored URLs after a delay (connection should complete by then)
          setTimeout(() => {
            sessionStorage.removeItem(storageKey)
            // Only remove generic key if no other wallet is using it
            const hasOtherWallet = mobileWalletNames.some(name => {
              if (name.toLowerCase() === walletName.toLowerCase()) return false
              const otherKey = name.toLowerCase().replace(/\s+/g, '_') + '_redirect_url'
              return sessionStorage.getItem(otherKey) !== null
            })
            if (!hasOtherWallet) {
              sessionStorage.removeItem('mobile_wallet_redirect_url')
            }
          }, 30000) // Remove after 30 seconds
        }
      }
    }
  }, [mounted, connecting, wallet])


  // Show sign dialog when wallet connects but hasn't signed yet
  useEffect(() => {
    if (connected && publicKey && mounted) {
      // Reset error state when connecting
      setSignError(null)
      
      // Function to check if wallet adapter modal is still open and wait for it to close
      // Returns cleanup function to cancel timeouts
      const waitForWalletModalToClose = (callback: () => void, maxWaitTime = 2000): (() => void) => {
        const startTime = Date.now()
        let checkTimeoutId: NodeJS.Timeout | null = null
        let callbackTimeoutId: NodeJS.Timeout | null = null
        let cancelled = false
        
        const checkModal = () => {
          if (cancelled) return
          
          const walletModal = document.querySelector('[role="dialog"][class*="wallet-adapter"]')
          const isWalletModalOpen = walletModal && window.getComputedStyle(walletModal).display !== 'none'
          
          // If modal is closed or we've waited too long, proceed
          if (!isWalletModalOpen || (Date.now() - startTime) > maxWaitTime) {
            // Add a small additional delay to ensure modal animation has completed
            if (!cancelled) {
              callbackTimeoutId = setTimeout(() => {
                if (!cancelled) {
                  callback()
                }
              }, 300)
            }
            return
          }
          
          // Check again in 100ms
          if (!cancelled) {
            checkTimeoutId = setTimeout(checkModal, 100)
          }
        }
        
        checkModal()
        
        // Return cleanup function
        return () => {
          cancelled = true
          if (checkTimeoutId) clearTimeout(checkTimeoutId)
          if (callbackTimeoutId) clearTimeout(callbackTimeoutId)
        }
      }
      
      // First, ensure wallet is fully connected and adapter is ready
      // Then wait for wallet adapter modal to close before showing sign dialog
      let cleanupWaitFunction: (() => void) | null = null
      const initialTimeout = setTimeout(() => {
        // Verify wallet is still connected after delay
        if (!connected || !publicKey) {
          return
        }
        
        // Wait for wallet adapter modal to close before showing sign dialog
        cleanupWaitFunction = waitForWalletModalToClose(() => {
          // Verify wallet is still connected after waiting
          if (!connected || !publicKey) {
            return
          }
          
          // Check if wallet adapter supports signing
          if (!signMessage) {
            // Wallet doesn't support signing - show error
            setSignError('Your wallet does not support message signing. Please disconnect and use a wallet that supports message signing (e.g., Phantom, Solflare).')
            setShowSignDialog(true)
            prevConnectedRef.current = connected
            return
          }
          
          // Check if user has signed for this wallet address
          const hasSigned = localStorage.getItem(`wallet_signed_${publicKey.toBase58()}`)
          
          // Always show sign dialog if:
          // 1. User hasn't signed yet, OR
          // 2. User just connected (transition from disconnected to connected)
          if (!hasSigned || (prevConnectedRef.current === false && connected)) {
            setShowSignDialog(true)
          }
        })
      }, 500) // Initial delay to allow wallet to initialize
      
      return () => {
        clearTimeout(initialTimeout)
        if (cleanupWaitFunction) {
          cleanupWaitFunction()
        }
      }
    } else if (!connected && prevConnectedRef.current) {
      // Wallet just disconnected - reset state
      setShowSignDialog(false)
      setSignError(null)
      setIsSigning(false)
    }
    
    // Update previous connected state
    prevConnectedRef.current = connected
  }, [connected, publicKey, mounted, signMessage])

  const handleSignMessage = useCallback(async () => {
    // Validate wallet state before attempting to sign
    if (!publicKey || !signMessage) {
      setSignError('Wallet not available for signing. Please ensure your wallet is connected and supports message signing.')
      return
    }

    // Check if wallet is still connected before attempting to sign
    if (!connected) {
      setSignError('Wallet disconnected. Please reconnect your wallet and try again.')
      return
    }

    // Additional check: verify wallet object is available
    if (!wallet || !wallet.adapter) {
      setSignError('Wallet adapter not available. Please refresh the page and reconnect your wallet.')
      return
    }

    // Give the wallet adapter a moment to fully initialize (especially for Standard Wallets like Phantom)
    // This helps prevent service worker connection issues
    await new Promise(resolve => setTimeout(resolve, 200))

    setIsSigning(true)
    setSignError(null)

    try {
      // Double-check connection state right before signing
      if (!connected || !publicKey) {
        throw new Error('Wallet disconnected before signing could complete.')
      }

      // Create a message that clearly explains what they're signing for
      const message = new TextEncoder().encode(
        `Welcome to Owl Raffle!\n\n` +
        `By signing this message, you are:\n` +
        `• Authenticating your wallet address: ${publicKey.toBase58()}\n` +
        `• Confirming your identity to participate in raffles\n` +
        `• Agreeing to the terms of service\n\n` +
        `This signature does not authorize any transactions or payments.\n` +
        `It is only used for authentication purposes.\n\n` +
        `Timestamp: ${new Date().toISOString()}`
      )

      // Retry logic for service worker connection issues
      let lastError: any = null
      const maxRetries = 3
      let signature: Uint8Array | null = null

      for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
          // Wait before retry (exponential backoff)
          if (attempt > 0) {
            await new Promise(resolve => setTimeout(resolve, 1000 * attempt))
          }

          // Double-check connection before each attempt
          if (!connected || !publicKey) {
            throw new Error('Wallet disconnected during signing attempt.')
          }

          // Request signature from wallet with timeout (increased to 60 seconds to allow for user interaction)
          let timeoutId: NodeJS.Timeout | null = null
          signature = await Promise.race([
            signMessage(message).finally(() => {
              if (timeoutId) clearTimeout(timeoutId)
            }),
            new Promise<never>((_, reject) => {
              timeoutId = setTimeout(() => {
                reject(new Error('Signing request timed out. Please check your wallet extension and ensure it\'s open, then try again.'))
              }, 60000) // Increased to 60 seconds to allow time for user to interact with wallet
            })
          ]) as Uint8Array

          // Success - break out of retry loop
          break
        } catch (error: any) {
          lastError = error
          
          // Check if this is a retryable error
          const errorMsg = error?.message?.toLowerCase() || ''
          const errorStr = JSON.stringify(error || '').toLowerCase()
          
          const isServiceWorkerError = 
            errorMsg.includes('disconnected port') ||
            errorMsg.includes('port object') ||
            errorMsg.includes('service worker') ||
            errorStr.includes('disconnected port') ||
            errorStr.includes('port object') ||
            errorStr.includes('service worker')
          
          const isTimeoutError = 
            errorMsg.includes('timeout') ||
            errorStr.includes('timeout')

          // Retry on service worker errors or timeout errors (unless we've exhausted retries)
          const isRetryableError = isServiceWorkerError || isTimeoutError
          
          // If it's not a retryable error or we've exhausted retries, throw
          if (!isRetryableError || attempt === maxRetries - 1) {
            throw error
          }

          // Otherwise, continue to next retry
          if (isServiceWorkerError) {
            console.warn(`Signing attempt ${attempt + 1} failed with service worker error, retrying...`)
          } else if (isTimeoutError) {
            console.warn(`Signing attempt ${attempt + 1} timed out, retrying...`)
          }
        }
      }

      if (!signature) {
        throw lastError || new Error('Failed to sign message after retries.')
      }

      // Store that this wallet has signed (optional: you could also verify on backend)
      localStorage.setItem(`wallet_signed_${publicKey.toBase58()}`, 'true')
      localStorage.setItem(`wallet_signature_${publicKey.toBase58()}`, JSON.stringify({
        signature: Array.from(signature),
        timestamp: new Date().toISOString(),
      }))
      
      setShowSignDialog(false)
      
      // Check if user is an admin and redirect to admin dashboard
      try {
        const response = await fetch(`/api/admin/check?wallet=${publicKey.toBase58()}`)
        if (response.ok) {
          const data = await response.json()
          if (data.isAdmin) {
            router.push('/admin')
          }
        }
      } catch (error) {
        console.error('Error checking admin status:', error)
      }
    } catch (error: any) {
      console.error('Error signing message:', error)
      
      // Handle specific error cases with improved messages
      let errorMessage = 'Failed to sign message. Please try again.'
      let shouldDisconnect = false
      
      // Check for disconnected port errors (Phantom/extension connection issues)
      const errorMsg = error?.message?.toLowerCase() || ''
      const errorStr = JSON.stringify(error || '').toLowerCase()
      const errorStack = (error?.stack || '').toLowerCase()
      
      if (errorMsg.includes('disconnected port') || 
          errorStr.includes('disconnected port') ||
          errorMsg.includes('port object') ||
          errorStr.includes('port object') ||
          errorMsg.includes('service worker') ||
          errorStr.includes('service worker') ||
          errorStack.includes('disconnected port') ||
          errorStack.includes('port object') ||
          errorStack.includes('service worker')) {
        errorMessage = 'Wallet extension connection issue detected. Please try again - the system will automatically retry. If the problem persists, refresh the page and reconnect your wallet.'
        shouldDisconnect = false // Don't disconnect - let user retry
      } else if (errorMsg.includes('disconnected') || errorStr.includes('disconnected')) {
        errorMessage = 'Wallet disconnected. Please reconnect your wallet and try again.'
        shouldDisconnect = true
      } else if (errorMsg.includes('timeout') || errorStr.includes('timeout')) {
        errorMessage = error.message || 'Signing request timed out. Please check your wallet extension and ensure it\'s responding, then try again.'
        shouldDisconnect = false // Don't disconnect on timeout - user might want to retry
      } else if (error?.code === 4001 || 
                 errorMsg.includes('reject') || 
                 errorMsg.includes('user rejected') ||
                 errorMsg.includes('declined')) {
        errorMessage = 'Signature request was cancelled. Please try again if you want to continue.'
        shouldDisconnect = false // Don't disconnect on rejection - user might want to retry
      } else if (error?.message) {
        errorMessage = error.message
      }
      
      setSignError(errorMessage)
      
      // Only disconnect if we have a connection error
      if (shouldDisconnect) {
        // Small delay before disconnecting to show error message
        setTimeout(async () => {
          try {
            if (connected) {
              await disconnect()
            }
          } catch (disconnectError) {
            console.error('Error disconnecting wallet:', disconnectError)
          }
        }, 2500)
      }
    } finally {
      setIsSigning(false)
    }
  }, [publicKey, signMessage, disconnect, router, connected, wallet])

  const handleDisconnect = useCallback(async () => {
    if (publicKey) {
      // Clear all stored signature data for this wallet
      localStorage.removeItem(`wallet_signed_${publicKey.toBase58()}`)
      localStorage.removeItem(`wallet_signature_${publicKey.toBase58()}`)
    }
    // Reset all state
    setShowSignDialog(false)
    setSignError(null)
    setIsSigning(false)
    // Disconnect the wallet
    await disconnect()
  }, [publicKey, disconnect])

  // Intercept clicks when wallet is connected to disconnect instead of opening modal
  useEffect(() => {
    if (!mounted || !buttonRef.current || !connected) {
      return
    }

    const timeoutId = setTimeout(() => {
      const button = buttonRef.current?.querySelector('button')
      if (!button) {
        return
      }

      // Intercept click to disconnect instead of opening wallet modal
      const handleClick = (e: Event) => {
        e.preventDefault()
        e.stopPropagation()
        handleDisconnect()
      }

      // Use capture phase to intercept before WalletMultiButton's handler
      button.addEventListener('click', handleClick, { capture: true })

      return () => {
        button.removeEventListener('click', handleClick, { capture: true })
      }
    }, 200)
    
    return () => {
      clearTimeout(timeoutId)
    }
  }, [mounted, connected, handleDisconnect])

  // Ensure button is properly initialized and clickable when not connected
  useEffect(() => {
    if (!mounted || !buttonRef.current || connected) {
      return
    }

    let cleanupFn: (() => void) | null = null
    
    const timeoutId = setTimeout(() => {
      // Ensure the button is fully rendered and interactive
      const button = buttonRef.current?.querySelector('button')
      if (!button) {
        if (process.env.NODE_ENV === 'development') {
          console.warn('WalletMultiButton not found in wrapper')
        }
        return
      }

      // Ensure the button can receive clicks/touches
      button.style.pointerEvents = 'auto'
      button.style.cursor = 'pointer'
      button.style.touchAction = 'manipulation'
      button.style.position = 'relative'
      button.style.zIndex = '10'
      
      // Remove any disabled state
      if (button.hasAttribute('disabled')) {
        button.removeAttribute('disabled')
      }
      
      // Ensure the wrapper allows pointer events
      if (buttonRef.current) {
        buttonRef.current.style.pointerEvents = 'auto'
        buttonRef.current.style.zIndex = '10'
      }

      // Ensure the button opens the modal on first click for both mobile and desktop
      // Add a click handler that ensures modal opens immediately
      const handleButtonClick = (e: Event) => {
        if (!connected) {
          // Always ensure modal opens - call setVisible in a microtask so native handler
          // has a chance first, but still feels instant to the user
          Promise.resolve().then(() => {
            // Double-check connection state in case it changed
            if (!connected) {
              setVisible(true)
            }
          })
        }
      }

      // Add click handler that ensures modal opens on first click
      button.addEventListener('click', handleButtonClick, { passive: true, capture: false })

      // Store cleanup function
      cleanupFn = () => {
        button.removeEventListener('click', handleButtonClick)
      }
    }, 200)
    
    return () => {
      clearTimeout(timeoutId)
      if (cleanupFn) {
        cleanupFn()
      }
    }
  }, [mounted, connected, setVisible])

  if (!mounted) {
    return null
  }

  return (
    <>
      <div 
        ref={buttonRef}
        className="wallet-connect-wrapper"
        style={{ 
          pointerEvents: 'auto',
          display: 'inline-block',
          touchAction: 'manipulation',
          position: 'relative',
          zIndex: 10,
        }}
      >
        <WalletMultiButton />
      </div>
      
      <Dialog open={showSignDialog} onOpenChange={(open) => {
        if (!open && !isSigning) {
          // If user closes dialog without signing, disconnect
          handleDisconnect()
        }
      }}>
        <DialogContent className="sm:max-w-[500px]" style={{ zIndex: 10000 }}>
          <DialogHeader>
            <DialogTitle>Sign Message to Connect</DialogTitle>
            <DialogDescription className="pt-2">
              To complete wallet connection, please sign a message to verify your identity.
            </DialogDescription>
          </DialogHeader>
          
          <div className="py-4 space-y-4">
            <div className="bg-muted/50 p-4 rounded-lg border">
              <h4 className="font-semibold mb-2 text-sm">What you're signing for:</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li className="flex items-start gap-2">
                  <span className="text-green-500 mt-1">✓</span>
                  <span>Authenticating your wallet address</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-green-500 mt-1">✓</span>
                  <span>Confirming your identity to participate in raffles</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-green-500 mt-1">✓</span>
                  <span>Agreeing to the terms of service</span>
                </li>
              </ul>
            </div>

            <div className="bg-yellow-500/10 border border-yellow-500/20 p-3 rounded-lg">
              <p className="text-sm text-yellow-600 dark:text-yellow-400">
                <strong>Important:</strong> This signature does not authorize any transactions or payments. 
                It is only used for authentication purposes.
              </p>
            </div>

            {publicKey && (
              <div className="text-xs text-muted-foreground break-all">
                <strong>Wallet:</strong> {publicKey.toBase58()}
              </div>
            )}

            {signError && (
              <div className="bg-destructive/10 border border-destructive/20 p-3 rounded-lg">
                <p className="text-sm text-destructive">{signError}</p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={handleDisconnect}
              disabled={isSigning}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSignMessage}
              disabled={isSigning || !signMessage}
              className="bg-green-600 hover:bg-green-700"
            >
              {isSigning ? 'Signing...' : 'Sign Message'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Phantom Browser Redirect Dialog */}
      <Dialog open={showPhantomRedirectDialog} onOpenChange={setShowPhantomRedirectDialog}>
        <DialogContent className="sm:max-w-[500px]" style={{ zIndex: 10000 }}>
          <DialogHeader>
            <DialogTitle>Open in Phantom Browser</DialogTitle>
            <DialogDescription className="pt-2">
              For the best experience, we recommend opening this site in the Phantom browser app. You can also continue with other wallet options.
            </DialogDescription>
          </DialogHeader>
          
          <div className="py-4 space-y-4">
            <div className="bg-muted/50 p-4 rounded-lg border">
              <h4 className="font-semibold mb-2 text-sm">Why Phantom Browser?</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li className="flex items-start gap-2">
                  <span className="text-green-500 mt-1">✓</span>
                  <span>Seamless wallet connection</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-green-500 mt-1">✓</span>
                  <span>Better security and performance</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-green-500 mt-1">✓</span>
                  <span>Native Solana wallet integration</span>
                </li>
              </ul>
            </div>

            <div className="bg-blue-500/10 border border-blue-500/20 p-3 rounded-lg">
              <p className="text-sm text-blue-600 dark:text-blue-400">
                <strong>Don't have Phantom?</strong> Download it from the App Store or Google Play Store.
              </p>
            </div>
          </div>

          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setShowPhantomRedirectDialog(false)
                // Open wallet selection modal so they can choose other wallets
                setVisible(true)
              }}
              className="w-full sm:w-auto"
            >
              Continue with Other Wallets
            </Button>
            <Button
              onClick={() => {
                redirectToPhantomBrowser()
                setShowPhantomRedirectDialog(false)
              }}
              className="bg-purple-600 hover:bg-purple-700 w-full sm:w-auto"
            >
              Open in Phantom
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
