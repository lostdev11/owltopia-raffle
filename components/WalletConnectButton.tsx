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

export function WalletConnectButton() {
  const router = useRouter()
  const { publicKey, connected, disconnect, signMessage, wallet } = useWallet()
  const { setVisible } = useWalletModal()
  const [mounted, setMounted] = useState(false)
  const [showSignDialog, setShowSignDialog] = useState(false)
  const [isSigning, setIsSigning] = useState(false)
  const [signError, setSignError] = useState<string | null>(null)
  const prevConnectedRef = useRef(false)
  const buttonRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setMounted(true)
  }, [])

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

  // Ensure button is properly initialized and clickable on first interaction
  // This fixes the issue where WalletMultiButton requires two clicks/taps on desktop and mobile
  // IMPORTANT: This hook must be before any conditional returns to follow Rules of Hooks
  useEffect(() => {
    if (!mounted || !buttonRef.current || connected) {
      return
    }

    let handleInteractionFallback: ((e: MouseEvent | TouchEvent) => void) | null = null
    let wrapperClickHandler: ((e: MouseEvent) => void) | null = null
    let cleanupButton: (() => void) | null = null
    
    const timeoutId = setTimeout(() => {
      // Ensure the button is fully rendered and interactive
      const button = buttonRef.current?.querySelector('button')
      if (!button) return

      // Remove any CSS that might block interactions (works for both desktop and mobile)
      button.style.pointerEvents = 'auto'
      button.style.cursor = 'pointer'
      button.style.touchAction = 'manipulation' // Optimize touch handling on mobile
      button.style.position = 'relative'
      button.style.zIndex = '10'
      
      // Ensure the button is not disabled
      button.disabled = false
      
      // Also ensure the wrapper and any parent elements allow pointer events
      if (buttonRef.current) {
        buttonRef.current.style.pointerEvents = 'auto'
        buttonRef.current.style.zIndex = '10'
      }
      
      // Add interaction handler as fallback to ensure modal opens on first click/tap
      // This is a workaround for the double-click/tap issue on desktop and mobile
      handleInteractionFallback = (e: MouseEvent | TouchEvent) => {
        // Only intervene if the modal is not already open and wallet is not connected
        if (connected) return
        
        // Check if the modal is already open
        const modal = document.querySelector('[role="dialog"][class*="wallet-adapter"]')
        if (modal) return
        
        // Immediately open the modal - don't wait for the button's handler
        setVisible(true)
        
        // Double-check after a delay to ensure modal actually opened
        setTimeout(() => {
          const modalAfterClick = document.querySelector('[role="dialog"][class*="wallet-adapter"]')
          if (!modalAfterClick && !connected) {
            // Modal didn't open, try again
            console.log('Modal did not open, attempting to open again...')
            setVisible(true)
          }
        }, 100)
      }
      
      // Add event listeners for both click (desktop) and touchstart (mobile)
      // Using touchstart for better mobile responsiveness
      // Using capture: false so we don't interfere with the button's own handler
      button.addEventListener('click', handleInteractionFallback, { capture: false, passive: true })
      button.addEventListener('touchstart', handleInteractionFallback, { capture: false, passive: true })
      
      // Also add a direct click handler on the wrapper as a last resort
      wrapperClickHandler = (e: MouseEvent) => {
        if (connected) return
        const modal = document.querySelector('[role="dialog"][class*="wallet-adapter"]')
        if (!modal && buttonRef.current && e.target && buttonRef.current.contains(e.target as Node)) {
          console.log('Wrapper click handler triggered, opening modal...')
          setVisible(true)
        }
      }
      
      if (buttonRef.current && wrapperClickHandler) {
        buttonRef.current.addEventListener('click', wrapperClickHandler, { capture: false, passive: false })
      }
      
      // Also ensure the button can receive clicks directly
      // Remove any CSS that might prevent interaction
      const buttonStyles = window.getComputedStyle(button)
      if (buttonStyles.pointerEvents === 'none') {
        button.style.pointerEvents = 'auto'
      }
      if (buttonStyles.cursor === 'not-allowed' || buttonStyles.cursor === 'default') {
        button.style.cursor = 'pointer'
      }
      
      cleanupButton = () => {
        if (handleInteractionFallback) {
          button.removeEventListener('click', handleInteractionFallback)
          button.removeEventListener('touchstart', handleInteractionFallback)
        }
        // Cleanup wrapper click handler
        if (buttonRef.current && wrapperClickHandler) {
          buttonRef.current.removeEventListener('click', wrapperClickHandler)
        }
      }
    }, 100) // Small delay to ensure everything is initialized (works for both desktop and mobile)
    
    return () => {
      clearTimeout(timeoutId)
      if (cleanupButton) {
        cleanupButton()
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
          zIndex: 10
        }}
        onClick={(e) => {
          // Direct click handler as fallback to ensure modal opens
          // Only trigger if wallet is not connected and modal is not already open
          if (!connected) {
            const modal = document.querySelector('[role="dialog"][class*="wallet-adapter"]')
            if (!modal) {
              // Small delay to let the button's own handler run first
              setTimeout(() => {
                const modalAfterDelay = document.querySelector('[role="dialog"][class*="wallet-adapter"]')
                if (!modalAfterDelay && !connected) {
                  // Button's handler didn't open modal, open it ourselves
                  console.log('Opening wallet modal via wrapper onClick fallback...')
                  setVisible(true)
                }
              }, 50)
            }
          }
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
    </>
  )
}
