'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useWallet } from '@solana/wallet-adapter-react'
import { WalletMultiButton, useWalletModal } from '@solana/wallet-adapter-react-ui'
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
  const { publicKey, connected, disconnect, wallet, connecting } = useWallet()
  const { setVisible } = useWalletModal()
  const [mounted, setMounted] = useState(false)
  const [showPhantomRedirectDialog, setShowPhantomRedirectDialog] = useState(false)
  const [remountKey, setRemountKey] = useState(0)
  const [showCancelButton, setShowCancelButton] = useState(false)
  const buttonRef = useRef<HTMLDivElement>(null)
  const connectingTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const connectingStartTimeRef = useRef<number | null>(null)
  const cancelButtonTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Handle stuck "connecting" state with timeout
  useEffect(() => {
    if (connecting) {
      // Track when connection started
      if (!connectingStartTimeRef.current) {
        connectingStartTimeRef.current = Date.now()
        setShowCancelButton(false)
      }

      // Show cancel button after 10 seconds of connecting
      cancelButtonTimeoutRef.current = setTimeout(() => {
        if (connecting && !connected) {
          setShowCancelButton(true)
        }
      }, 10000) // Show cancel button after 10 seconds

      // Set timeout to auto-cancel stuck connections (30 seconds)
      connectingTimeoutRef.current = setTimeout(() => {
        const elapsed = Date.now() - (connectingStartTimeRef.current || 0)
        if (elapsed >= 30000 && connecting && !connected) {
          console.warn('Wallet connection timeout - resetting connection state')
          // Disconnect to reset the stuck state
          disconnect().catch((err) => {
            console.error('Error disconnecting after timeout:', err)
          })
          // Force remount to clear any stuck state
          setRemountKey((k) => k + 1)
          // Reset tracking
          connectingStartTimeRef.current = null
          setShowCancelButton(false)
        }
      }, 30000) // 30 second timeout
    } else {
      // Connection completed or cancelled - clear timeouts and reset tracking
      if (connectingTimeoutRef.current) {
        clearTimeout(connectingTimeoutRef.current)
        connectingTimeoutRef.current = null
      }
      if (cancelButtonTimeoutRef.current) {
        clearTimeout(cancelButtonTimeoutRef.current)
        cancelButtonTimeoutRef.current = null
      }
      connectingStartTimeRef.current = null
      setShowCancelButton(false)
    }

    return () => {
      if (connectingTimeoutRef.current) {
        clearTimeout(connectingTimeoutRef.current)
        connectingTimeoutRef.current = null
      }
      if (cancelButtonTimeoutRef.current) {
        clearTimeout(cancelButtonTimeoutRef.current)
        cancelButtonTimeoutRef.current = null
      }
    }
  }, [connecting, connected, disconnect])

  // Manual cancel handler
  const handleCancelConnection = useCallback(async () => {
    console.log('User cancelled stuck wallet connection')
    // Clear timeouts
    if (connectingTimeoutRef.current) {
      clearTimeout(connectingTimeoutRef.current)
      connectingTimeoutRef.current = null
    }
    if (cancelButtonTimeoutRef.current) {
      clearTimeout(cancelButtonTimeoutRef.current)
      cancelButtonTimeoutRef.current = null
    }
    
    // Try to disconnect
    try {
      await disconnect()
    } catch (err) {
      console.error('Error disconnecting:', err)
    }
    
    // Force remount to clear any stuck state
    setRemountKey((k) => k + 1)
    // Reset tracking
    connectingStartTimeRef.current = null
    setShowCancelButton(false)
  }, [disconnect])

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

  const handleDisconnect = useCallback(async () => {
    // Clear any pending connection timeouts
    if (connectingTimeoutRef.current) {
      clearTimeout(connectingTimeoutRef.current)
      connectingTimeoutRef.current = null
    }
    if (cancelButtonTimeoutRef.current) {
      clearTimeout(cancelButtonTimeoutRef.current)
      cancelButtonTimeoutRef.current = null
    }
    connectingStartTimeRef.current = null
    setShowCancelButton(false)
    
    await disconnect()
    
    // Clear authorization cache ONLY when user explicitly disconnects
    // This ensures next connection will require approval again
    try {
      if (typeof window !== 'undefined' && 'localStorage' in window) {
        // Clear Solana Mobile Wallet authorization cache only on explicit disconnect
        const mobileWalletKeys = Object.keys(localStorage).filter(key => 
          key.includes('solana-mobile-wallet') || 
          key.includes('solana_mobile')
        )
        mobileWalletKeys.forEach(key => localStorage.removeItem(key))
        
        // Clear wallet adapter connection state (but keep other preferences)
        const adapterKeys = Object.keys(localStorage).filter(key =>
          key.includes('wallet-adapter') && key.includes('walletName')
        )
        adapterKeys.forEach(key => localStorage.removeItem(key))
        
        // Clear sessionStorage wallet-related items
        const sessionKeys = Object.keys(sessionStorage).filter(key =>
          key.includes('wallet') || key.includes('solana')
        )
        sessionKeys.forEach(key => sessionStorage.removeItem(key))
      }
    } catch (e) {
      // Ignore errors clearing storage
      console.warn('Could not clear wallet cache:', e)
    }
    
    // Force WalletMultiButton remount to clear any stuck state after disconnect.
    // Without this, reconnecting often fails on subpages until user navigates away and back.
    setRemountKey((k) => k + 1)
    // Clear mobile wallet redirect URLs so they don't interfere with reconnect.
    const walletNames = ['solflare', 'phantom', 'coinbase', 'trust', 'solana_mobile']
    walletNames.forEach((name) => sessionStorage.removeItem(`${name}_redirect_url`))
    sessionStorage.removeItem('mobile_wallet_redirect_url')
  }, [disconnect])

  // When connected, clicking should show wallet info or disconnect option
  // Don't force reconnection - let wallet stay connected until user disconnects
  useEffect(() => {
    if (!mounted || !buttonRef.current || !connected) {
      return
    }

    const timeoutId = setTimeout(() => {
      const button = buttonRef.current?.querySelector('button')
      if (!button) {
        return
      }

      // When connected, clicking disconnects (standard behavior)
      // Don't force reconnection - wallet will remember connection until disconnect
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
      // Let WalletMultiButton handle the click naturally - it will open modal when not connected
      // No need to intercept - WalletMultiButton already handles this correctly
    }, 200)
    
    return () => {
      clearTimeout(timeoutId)
    }
  }, [mounted, connected, setVisible])

  // When not connected, any click on the wrapper opens the modal (ensures desktop works even if inner button fails)
  const handleWrapperClick = useCallback(
    (e: React.MouseEvent) => {
      if (!mounted || connected || connecting) return
      setVisible(true)
    },
    [mounted, connected, connecting, setVisible]
  )

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
        onClick={handleWrapperClick}
        tabIndex={connected ? -1 : 0}
        onKeyDown={(e) => {
          if (connected) return
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setVisible(true)
          }
        }}
        aria-label={connected ? 'Disconnect wallet' : 'Connect wallet'}
      >
        {mounted ? (
          <>
            <WalletMultiButton key={remountKey} />
            {showCancelButton && connecting && !connected && (
              <Button
                onClick={handleCancelConnection}
                variant="outline"
                size="sm"
                className="ml-2"
                style={{
                  fontSize: '12px',
                  padding: '6px 12px',
                  height: 'auto',
                }}
              >
                Cancel
              </Button>
            )}
          </>
        ) : (
          <button
            className="wallet-adapter-button"
            style={{
              backgroundColor: 'rgb(34, 197, 94)',
              color: 'white',
              border: 'none',
              padding: '12px 24px',
              borderRadius: '0.5rem',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: 500,
            }}
            disabled
          >
            Loading...
          </button>
        )}
      </div>
      
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
