'use client'

import { useEffect } from 'react'

/**
 * ErrorHandler component that suppresses harmless browser extension errors
 * These errors are common with wallet extensions and don't affect functionality
 */
export function ErrorHandler() {
  useEffect(() => {
    // Suppress known harmless extension errors
    const originalError = console.error
    const originalWarn = console.warn

    // Override console.error to filter out extension errors
    console.error = (...args: any[]) => {
      // Join all arguments into a single string for pattern matching
      const errorString = args.map(arg => {
        if (typeof arg === 'object' && arg !== null) {
          // Include stack trace if available
          return JSON.stringify(arg) + (arg.stack || '')
        }
        return String(arg)
      }).join(' ').toLowerCase()
      
      // Check each argument individually for error objects
      const errorObj = args.find(arg => arg && typeof arg === 'object' && (arg instanceof Error || arg.stack))
      const errorStack = errorObj?.stack?.toLowerCase() || ''
      const errorMessage = errorObj?.message?.toLowerCase() || ''
      
      // More aggressive pattern matching - check all possible combinations
      const hasSolanaScript = errorString.includes('solanaactionscontentscript') || 
                              errorStack.includes('solanaactionscontentscript')
      const hasSomethingWentWrong = errorString.includes('something went wrong') || 
                                    errorMessage.includes('something went wrong')
      const hasExtension = errorString.includes('extension://') || 
                          errorString.includes('extension') ||
                          errorStack.includes('extension')
      const hasPromiseCatch = errorString.includes('promise.catch') || 
                              errorString.includes('promise') && errorString.includes('catch')
      
      // Check for WalletConnectionError patterns
      const isConnectionError = 
        errorString.includes('walletconnectionerror') ||
        errorString.includes('connectionerror') ||
        (errorMessage.includes('connection') && errorMessage.includes('error'))
      
      const isUnexpectedError = 
        errorMessage.includes('unexpected error') ||
        errorString.includes('unexpected error')
      
      // Suppress known harmless extension errors
      if (
        // Solana wallet extension errors (check both message and stack trace)
        hasSolanaScript ||
        errorString.includes('runtime.lasterror') ||
        errorString.includes('receiving end does not exist') ||
        errorString.includes('could not establish connection') ||
        // Chrome extension port errors (harmless)
        errorString.includes('extension context invalidated') ||
        errorString.includes('message port closed') ||
        // StandardWallet adapter connection errors (Phantom, etc.)
        // These often occur when user cancels connection or extension is temporarily unavailable
        (isConnectionError && isUnexpectedError) ||
        (isConnectionError && errorStack.includes('standardwalletadapter')) ||
        (isConnectionError && errorStack.includes('_standardwalletadapter_connect')) ||
        // Generic "Something went wrong" from Solana extensions - be very aggressive
        (hasSomethingWentWrong && (hasSolanaScript || hasExtension || errorString.includes('solana') || errorString.includes('wallet'))) ||
        // Promise rejections from extensions
        (hasPromiseCatch && hasSolanaScript) ||
        // Any error from solanaActionsContentScript.js
        errorStack.includes('solanaactionscontentscript.js')
      ) {
        // Silently ignore these errors - they're from browser extensions and don't affect functionality
        return
      }
      
      // Log all other errors normally
      originalError.apply(console, args)
    }

    // Override console.warn to filter out extension warnings
    console.warn = (...args: any[]) => {
      const warnString = args.join(' ')
      
      // Suppress known harmless extension warnings
      if (
        warnString.includes('runtime.lastError') ||
        warnString.includes('Extension context')
      ) {
        // Silently ignore these warnings
        return
      }
      
      // Log all other warnings normally
      originalWarn.apply(console, args)
    }

    // Global error handler for unhandled errors
    const handleError = (event: ErrorEvent) => {
      const errorMessage = (event.message || '').toLowerCase()
      const errorSource = (event.filename || '').toLowerCase()
      const errorStack = (event.error?.stack || '').toLowerCase()
      
      // More aggressive pattern matching
      const hasSolanaScript = errorSource.includes('solanaactionscontentscript') || 
                              errorStack.includes('solanaactionscontentscript')
      const hasSomethingWentWrong = errorMessage.includes('something went wrong')
      const hasExtension = errorSource.includes('extension://') || 
                          errorSource.includes('extension') ||
                          errorStack.includes('extension')
      
      // Check for WalletConnectionError patterns
      const isConnectionError = 
        errorMessage.includes('connection') && errorMessage.includes('error') ||
        errorStack.includes('walletconnectionerror') ||
        errorStack.includes('connectionerror')
      
      const isUnexpectedError = 
        errorMessage.includes('unexpected error') ||
        errorStack.includes('unexpected error')
      
      // Suppress extension script errors
      if (
        hasSolanaScript ||
        errorSource.includes('extension://') ||
        errorMessage.includes('runtime.lasterror') ||
        errorMessage.includes('receiving end does not exist') ||
        // StandardWallet adapter connection errors
        (isConnectionError && isUnexpectedError) ||
        (isConnectionError && errorStack.includes('standardwalletadapter')) ||
        (isConnectionError && errorStack.includes('_standardwalletadapter_connect')) ||
        // Catch "Something went wrong" from extensions - be very aggressive
        (hasSomethingWentWrong && (hasSolanaScript || hasExtension || errorStack.includes('solana'))) ||
        // Any error from solanaActionsContentScript.js
        errorStack.includes('solanaactionscontentscript.js')
      ) {
        event.preventDefault()
        return false
      }
    }

    // Global unhandled promise rejection handler
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = (event.reason?.toString() || '').toLowerCase()
      const errorStack = (event.reason?.stack || '').toLowerCase()
      const errorMessage = (event.reason?.message || '').toLowerCase()
      
      // More aggressive pattern matching
      const hasSolanaScript = reason.includes('solanaactionscontentscript') || 
                              errorStack.includes('solanaactionscontentscript')
      const hasSomethingWentWrong = reason.includes('something went wrong') || 
                                    errorMessage.includes('something went wrong')
      const hasExtension = reason.includes('extension') || 
                          errorStack.includes('extension')
      
      // Check for WalletConnectionError patterns
      const isConnectionError = 
        reason.includes('connection') && reason.includes('error') ||
        errorStack.includes('walletconnectionerror') ||
        errorStack.includes('connectionerror')
      
      const isUnexpectedError = 
        reason.includes('unexpected error') ||
        errorMessage.includes('unexpected error') ||
        errorStack.includes('unexpected error')
      
      // Suppress extension-related promise rejections
      if (
        hasSolanaScript ||
        reason.includes('runtime.lasterror') ||
        reason.includes('receiving end does not exist') ||
        reason.includes('extension context') ||
        // StandardWallet adapter connection errors
        (isConnectionError && isUnexpectedError) ||
        (isConnectionError && errorStack.includes('standardwalletadapter')) ||
        (isConnectionError && errorStack.includes('_standardwalletadapter_connect')) ||
        // Catch "Something went wrong" errors from Solana extensions - be very aggressive
        (hasSomethingWentWrong && (hasSolanaScript || hasExtension || reason.includes('solana') || reason.includes('wallet'))) ||
        // Promise.catch errors from extensions
        (reason.includes('promise') && hasSolanaScript) ||
        // Any error from solanaActionsContentScript.js
        errorStack.includes('solanaactionscontentscript.js')
      ) {
        event.preventDefault()
        return false
      }
    }

    window.addEventListener('error', handleError)
    window.addEventListener('unhandledrejection', handleUnhandledRejection)

    // Cleanup
    return () => {
      console.error = originalError
      console.warn = originalWarn
      window.removeEventListener('error', handleError)
      window.removeEventListener('unhandledrejection', handleUnhandledRejection)
    }
  }, [])

  return null
}
