'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useWallet, useConnection } from '@solana/wallet-adapter-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { OwlVisionBadge } from '@/components/OwlVisionBadge'
import { HootBoostMeter } from '@/components/HootBoostMeter'
import { ParticipantsModal } from '@/components/ParticipantsModal'
import { WinnerModal } from '@/components/WinnerModal'
import { CurrencyIcon } from '@/components/CurrencyIcon'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { Raffle, Entry, OwlVisionScore } from '@/lib/types'
import { calculateOwlVisionScore } from '@/lib/owl-vision'
import { isRaffleEligibleToDraw, calculateTicketsSold, getRaffleMinimum } from '@/lib/db/raffles'
import { getThemeAccentBorderStyle, getThemeAccentClasses, getThemeAccentColor } from '@/lib/theme-accent'
import { formatDistanceToNow } from 'date-fns'
import { formatDateTimeWithTimezone, formatDateTimeLocal } from '@/lib/utils'
import Image from 'next/image'
import { Users, Trophy, ArrowLeft, Edit, Grid3x3, LayoutGrid, Square, Send } from 'lucide-react'
import {
  Transaction,
  SystemProgram,
  PublicKey,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js'
import {
  getAssociatedTokenAddress,
  createTransferInstruction,
  getMint,
  getAccount,
  createAssociatedTokenAccountInstruction,
} from '@solana/spl-token'
import { useRealtimeEntries } from '@/lib/hooks/useRealtimeEntries'

interface RaffleDetailClientProps {
  raffle: Raffle
  entries: Entry[]
  owlVisionScore: OwlVisionScore
}

export function RaffleDetailClient({
  raffle,
  entries: initialEntries,
  owlVisionScore,
}: RaffleDetailClientProps) {
  const router = useRouter()
  const { publicKey, sendTransaction, connected } = useWallet()
  const { connection } = useConnection()
  const [ticketQuantity, setTicketQuantity] = useState(1)
  const [ticketQuantityDisplay, setTicketQuantityDisplay] = useState('1')
  const [showParticipants, setShowParticipants] = useState(false)
  
  // Calculate purchase amount automatically based on ticket price and quantity
  const purchaseAmount = raffle.ticket_price * ticketQuantity
  const [showWinner, setShowWinner] = useState(false)
  const [showEnterRaffleDialog, setShowEnterRaffleDialog] = useState(false)
  const [showNftTransferDialog, setShowNftTransferDialog] = useState(false)
  const [nftTransferSignature, setNftTransferSignature] = useState('')
  const [isSubmittingTransfer, setIsSubmittingTransfer] = useState(false)
  const [transferError, setTransferError] = useState<string | null>(null)
  const [transferSuccess, setTransferSuccess] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null)
  const [imageSize, setImageSize] = useState<'small' | 'medium' | 'large'>('medium')
  const [imageError, setImageError] = useState(false)
  // Make isActive reactive to time passing - critical for mobile connections
  // Also check if raffle has started (not future)
  const [isActive, setIsActive] = useState(() => {
    const startTime = new Date(raffle.start_time)
    const endTime = new Date(raffle.end_time)
    const now = new Date()
    return startTime <= now && endTime > now && raffle.is_active
  })
  const [isFuture, setIsFuture] = useState(() => {
    const startTime = new Date(raffle.start_time)
    const now = new Date()
    return startTime > now
  })

  // Update isActive and isFuture when time passes (e.g., raffle ends or starts while page is open)
  useEffect(() => {
    const startTime = new Date(raffle.start_time).getTime()
    const endTime = new Date(raffle.end_time).getTime()
    const now = Date.now()
    const isFutureRaffle = startTime > now
    const shouldBeActive = startTime <= now && endTime > now && raffle.is_active
    
    setIsFuture(isFutureRaffle)
    setIsActive(shouldBeActive)

    // If raffle is still active, set up interval to check when it ends
    if (shouldBeActive) {
      const timeUntilEnd = endTime - now
      // Check every second if raffle will end soon (< 5 minutes), otherwise check every 30 seconds
      const checkInterval = timeUntilEnd < 5 * 60 * 1000 ? 1000 : 30000
      
      const intervalId = setInterval(() => {
        const now = Date.now()
        const shouldBeActive = endTime > now && raffle.is_active
        setIsActive(prev => {
          return shouldBeActive
        })
        
        // Clear interval if raffle has ended
        if (!shouldBeActive) {
          clearInterval(intervalId)
        }
      }, checkInterval)
      
      return () => clearInterval(intervalId)
    }
  }, [raffle.start_time, raffle.end_time, raffle.is_active])
  const borderStyle = getThemeAccentBorderStyle(raffle.theme_accent)
  const themeColor = getThemeAccentColor(raffle.theme_accent)

  // Use real-time entries hook (with polling fallback)
  const { entries, refetch: fetchEntries, isUsingRealtime } = useRealtimeEntries({
    raffleId: raffle.id,
    enabled: isActive, // Only enable real-time updates for active raffles
    pollingInterval: 3000, // 3 second polling fallback
    initialEntries, // Initialize with server-side entries
  })

  // Refresh entries when wallet connection status changes
  // This ensures user tickets are recalculated when user connects/disconnects
  useEffect(() => {
    fetchEntries()
  }, [connected, publicKey, fetchEntries])

  // Calculate owlVisionScore based on current entries
  // Fallback to initial score if entries are not yet loaded
  const currentOwlVisionScore = entries.length > 0 
    ? calculateOwlVisionScore(raffle, entries)
    : owlVisionScore

  // Check admin status
  useEffect(() => {
    const checkAdminStatus = async () => {
      if (!connected || !publicKey) {
        setIsAdmin(false)
        return
      }

      try {
        const response = await fetch(`/api/admin/check?wallet=${publicKey.toBase58()}`)
        if (response.ok) {
          const data = await response.json()
          setIsAdmin(data.isAdmin === true)
        } else {
          setIsAdmin(false)
        }
      } catch (error) {
        console.error('Error checking admin status:', error)
        setIsAdmin(false)
      }
    }

    checkAdminStatus()
  }, [connected, publicKey])

  // Refresh entries when wallet connection status changes
  // This ensures user tickets are recalculated when user connects/disconnects
  useEffect(() => {
    fetchEntries()
  }, [connected, publicKey, fetchEntries])

  // Real-time updates are now handled by useRealtimeEntries hook
  // No need for separate polling logic - it's built into the hook

  // Calculate total tickets sold (from confirmed entries only)
  const totalTicketsSold = calculateTicketsSold(entries)
  
  // Calculate minimum eligibility
  const minTickets = getRaffleMinimum(raffle)
  const isEligibleToDraw = minTickets ? isRaffleEligibleToDraw(raffle, entries) : true

  // Calculate available tickets
  const availableTickets = raffle.max_tickets 
    ? raffle.max_tickets - totalTicketsSold 
    : null

  // Calculate user's tickets (from confirmed entries only)
  const userTickets = connected && publicKey
    ? entries
        .filter(e => e.status === 'confirmed' && e.wallet_address === publicKey.toBase58())
        .reduce((sum, entry) => sum + entry.ticket_quantity, 0)
    : 0

  // Determine max tickets user can purchase in one transaction
  const maxPurchaseQuantity = availableTickets !== null 
    ? Math.max(0, availableTickets) 
    : 100 // Default max if no limit set

  const handlePurchase = async () => {
    if (!connected || !publicKey) {
      setError('Please connect your wallet first')
      return
    }

    setIsProcessing(true)
    setError(null)
    setSuccess(false)

    try {
      // Step 1: Create entry and get payment details
      // Add retry logic and timeout for mobile connections
      let createResponse: Response | null = null
      let fetchRetries = 3
      let fetchError: Error | null = null
      
      while (fetchRetries > 0) {
        try {
          // Create AbortController for timeout (30 seconds for mobile)
          const controller = new AbortController()
          const timeoutId = setTimeout(() => controller.abort(), 30000)
          
          createResponse = await fetch('/api/entries/create', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              raffleId: raffle.id,
              walletAddress: publicKey.toBase58(),
              ticketQuantity,
              amountPaid: purchaseAmount,
            }),
            signal: controller.signal,
          })
          
          clearTimeout(timeoutId)
          
          // If we get a response (even if not ok), break retry loop
          break
        } catch (fetchErr: any) {
          fetchRetries--
          fetchError = fetchErr
          
          // Check if it's a network/fetch error
          const errorMessage = fetchErr?.message || ''
          const errorName = fetchErr?.name || ''
          const isFetchError = 
            errorMessage.includes('failed to fetch') ||
            errorMessage.includes('Failed to fetch') ||
            errorMessage.includes('NetworkError') ||
            errorMessage.includes('Network request failed') ||
            errorName === 'TypeError' ||
            errorName === 'AbortError' ||
            errorMessage.includes('timeout') ||
            errorMessage.includes('CORS') ||
            errorMessage.includes('network')
          
          if (fetchRetries === 0) {
            if (isFetchError || errorName === 'AbortError') {
              throw new Error(
                'Network connection failed. This may be a connectivity issue on mobile. ' +
                'Please check your internet connection and try again. ' +
                'If the issue persists, try switching between WiFi and mobile data.'
              )
            }
            throw fetchErr
          }
          
          // Wait before retry (exponential backoff)
          await new Promise(resolve => setTimeout(resolve, 2000 * (3 - fetchRetries)))
        }
      }

      if (!createResponse) {
        throw fetchError || new Error('Failed to create entry: Network error')
      }

      if (!createResponse.ok) {
        const errorData = await createResponse.json()
        throw new Error(errorData.error || 'Failed to create entry')
      }

      const { entry, paymentDetails } = await createResponse.json()
      
      // Log payment details for debugging
      console.log(`Payment details: amount=${paymentDetails.amount}, currency=${paymentDetails.currency}, ticketQuantity=${ticketQuantity}`)

      // Step 2: Build transaction
      // Get recent blockhash first (needed for transaction)
      let latestBlockhash: { blockhash: string; lastValidBlockHeight: number } | null = null
      let retries = 3
      while (retries > 0) {
        try {
          // Try getLatestBlockhash first (newer API)
          try {
            const result = await connection.getLatestBlockhash('confirmed')
            latestBlockhash = result
            break
          } catch (latestError: any) {
            // If getLatestBlockhash doesn't exist or isn't supported, try getRecentBlockhash (older API)
            const errorMsg = latestError?.message || ''
            if (errorMsg.includes('does not exist') || errorMsg.includes('not available') || latestError?.code === -32601) {
              // Fallback to getRecentBlockhash for older RPC endpoints
              // Try to get lastValidBlockHeight separately using getSlot for mobile wallet compatibility
              try {
                const recentResult = await connection.getRecentBlockhash('confirmed')
                const slot = await connection.getSlot('confirmed')
                latestBlockhash = {
                  blockhash: recentResult.blockhash,
                  lastValidBlockHeight: slot, // Use current slot as approximate lastValidBlockHeight
                }
              } catch (fallbackError) {
                // If we can't get slot, still try with 0 (wallet will handle it)
                const recentResult = await connection.getRecentBlockhash('confirmed')
                latestBlockhash = {
                  blockhash: recentResult.blockhash,
                  lastValidBlockHeight: 0,
                }
              }
              break
            } else {
              // Re-throw if it's a different error
              throw latestError
            }
          }
        } catch (rpcError: any) {
          retries--
          const errorMessage = rpcError?.message || ''
          const errorCode = rpcError?.code || rpcError?.error?.code
          const errorStr = JSON.stringify(rpcError)
          const errorName = rpcError?.name || ''
          
          // Check for network/fetch errors (common on mobile)
          const isFetchError = 
            errorMessage.includes('failed to fetch') ||
            errorMessage.includes('Failed to fetch') ||
            errorMessage.includes('NetworkError') ||
            errorMessage.includes('Network request failed') ||
            errorName === 'TypeError' ||
            (errorName === 'TypeError' && errorMessage.includes('fetch')) ||
            errorMessage.includes('CORS') ||
            errorMessage.includes('network')
          
          // Check for retryable errors: 403 (rate limit), 19 (temporary internal error), 500, network issues
          if (isFetchError ||
              errorMessage.includes('403') || 
              errorMessage.includes('Access forbidden') ||
              errorCode === 19 ||
              errorMessage.includes('Temporary internal error') ||
              errorMessage.includes('500') ||
              errorStr.includes('"code":19') ||
              errorMessage.includes('Network') ||
              errorMessage.includes('timeout')) {
            if (retries === 0) {
              if (isFetchError) {
                throw new Error(
                  'Network connection failed. This may be a network issue or CORS restriction on mobile. ' +
                  'Please check your internet connection and try again. ' +
                  'If the issue persists, ensure you have set NEXT_PUBLIC_SOLANA_RPC_URL ' +
                  'to a private RPC endpoint (Helius, QuickNode, or Alchemy) that supports mobile access.'
                )
              } else if (errorMessage.includes('403') || errorMessage.includes('Access forbidden')) {
                throw new Error(
                  'RPC endpoint is rate-limited or requires authentication. ' +
                  'Please set NEXT_PUBLIC_SOLANA_RPC_URL in your .env.local file to a private RPC endpoint ' +
                  '(e.g., Helius, QuickNode, or Alchemy). Public RPC endpoints are rate-limited.'
                )
              } else {
                throw new Error(
                  'Failed to get blockhash after retries. This may be a temporary RPC issue. ' +
                  'Please try again in a moment. If the issue persists, ensure you have set NEXT_PUBLIC_SOLANA_RPC_URL ' +
                  'to a private RPC endpoint (Helius, QuickNode, or Alchemy).'
                )
              }
            }
            // Exponential backoff: wait longer for each retry (longer delays for fetch errors)
            const backoffDelay = isFetchError ? 2000 * (3 - retries) : 1000 * (3 - retries)
            await new Promise(resolve => setTimeout(resolve, backoffDelay))
          } else {
            // Non-retryable error, throw immediately
            throw rpcError
          }
        }
      }
      
      if (!latestBlockhash) {
        throw new Error('Failed to get recent blockhash after retries')
      }

      // Construct transaction with proper blockhash and lastValidBlockHeight for mobile wallet compatibility
      // Setting lastValidBlockHeight is critical for Android mobile wallets (MWA)
      const transaction = new Transaction()
      transaction.recentBlockhash = latestBlockhash.blockhash
      if (latestBlockhash.lastValidBlockHeight) {
        transaction.lastValidBlockHeight = latestBlockhash.lastValidBlockHeight
      }
      transaction.feePayer = publicKey
      
      const recipientPubkey = new PublicKey(paymentDetails.recipient)

      if (raffle.currency === 'SOL') {
        // SOL transfer
        const lamports = Math.round(paymentDetails.amount * LAMPORTS_PER_SOL)
        transaction.add(
          SystemProgram.transfer({
            fromPubkey: publicKey,
            toPubkey: recipientPubkey,
            lamports,
          })
        )
      } else if (raffle.currency === 'USDC') {
        // USDC (SPL Token) transfer
        const usdcMint = new PublicKey(paymentDetails.usdcMint)
        
        // Get mint info with retry logic for RPC errors
        let mintInfo
        let mintRetries = 3
        while (mintRetries > 0) {
          try {
            mintInfo = await getMint(connection, usdcMint)
            break
          } catch (rpcError: any) {
            mintRetries--
            const errorMessage = rpcError?.message || ''
            const errorCode = rpcError?.code || rpcError?.error?.code
            const errorName = rpcError?.name || ''
            
            // Check for network/fetch errors (common on mobile)
            const isFetchError = 
              errorMessage.includes('failed to fetch') ||
              errorMessage.includes('Failed to fetch') ||
              errorMessage.includes('NetworkError') ||
              errorMessage.includes('Network request failed') ||
              errorName === 'TypeError' ||
              (errorName === 'TypeError' && errorMessage.includes('fetch')) ||
              errorMessage.includes('CORS') ||
              errorMessage.includes('network')
            
            // Check if it's a retryable error (code 19 = temporary internal error, or network issues)
            if (isFetchError ||
                errorCode === 19 || 
                errorMessage.includes('Temporary internal error') ||
                errorMessage.includes('500') ||
                errorMessage.includes('Network') ||
                errorMessage.includes('timeout')) {
              if (mintRetries === 0) {
                if (isFetchError) {
                  throw new Error(
                    'Network connection failed while fetching USDC mint information. This may be a network issue or CORS restriction on mobile. ' +
                    'Please check your internet connection and try again. ' +
                    'If the issue persists, ensure you have set NEXT_PUBLIC_SOLANA_RPC_URL ' +
                    'to a private RPC endpoint (Helius, QuickNode, or Alchemy) that supports mobile access.'
                  )
                } else {
                  throw new Error(
                    'Failed to fetch USDC mint information after retries. This may be a temporary RPC issue. ' +
                    'Please try again in a moment. If the issue persists, ensure you have set NEXT_PUBLIC_SOLANA_RPC_URL ' +
                    'to a private RPC endpoint (Helius, QuickNode, or Alchemy).'
                  )
                }
              }
              // Exponential backoff: wait longer for each retry (longer delays for fetch errors)
              const backoffDelay = isFetchError ? 2000 * (3 - mintRetries) : 1000 * (3 - mintRetries)
              await new Promise(resolve => setTimeout(resolve, backoffDelay))
            } else {
              // Non-retryable error, throw immediately
              throw rpcError
            }
          }
        }
        
        if (!mintInfo) {
          throw new Error('Failed to get USDC mint information')
        }
        
        const decimals = mintInfo.decimals
        const amount = BigInt(Math.round(paymentDetails.amount * Math.pow(10, decimals)))

        // Get associated token addresses
        const senderTokenAddress = await getAssociatedTokenAddress(
          usdcMint,
          publicKey
        )
        const recipientTokenAddress = await getAssociatedTokenAddress(
          usdcMint,
          recipientPubkey
        )

        // Check if recipient token account exists, create if it doesn't
        // Add retry logic for getAccount as well
        let accountExists = false
        let accountRetries = 3
        while (accountRetries > 0 && !accountExists) {
          try {
            await getAccount(connection, recipientTokenAddress)
            accountExists = true
          } catch (error: any) {
            const errorMessage = error?.message || ''
            const errorCode = error?.code || error?.error?.code
            const errorName = error?.name || ''
            
            // Token account doesn't exist (expected case)
            if (errorMessage.includes('TokenAccountNotFoundError') || 
                errorMessage.includes('could not find account')) {
              accountExists = false
              break
            }
            
            // Check for network/fetch errors (common on mobile)
            const isFetchError = 
              errorMessage.includes('failed to fetch') ||
              errorMessage.includes('Failed to fetch') ||
              errorMessage.includes('NetworkError') ||
              errorMessage.includes('Network request failed') ||
              errorName === 'TypeError' ||
              (errorName === 'TypeError' && errorMessage.includes('fetch')) ||
              errorMessage.includes('CORS') ||
              errorMessage.includes('network')
            
            // Retryable RPC error
            if (isFetchError ||
                errorCode === 19 || 
                errorMessage.includes('Temporary internal error') ||
                errorMessage.includes('500') ||
                errorMessage.includes('Network') ||
                errorMessage.includes('timeout')) {
              accountRetries--
              if (accountRetries === 0) {
                // If we can't check, assume account doesn't exist and create it
                accountExists = false
                break
              }
              // Exponential backoff: wait longer for each retry (longer delays for fetch errors)
              const backoffDelay = isFetchError ? 2000 * (3 - accountRetries) : 1000 * (3 - accountRetries)
              await new Promise(resolve => setTimeout(resolve, backoffDelay))
            } else {
              // Other errors - assume account doesn't exist
              accountExists = false
              break
            }
          }
        }
        
        if (!accountExists) {
          // Account doesn't exist, add instruction to create it
          transaction.add(
            createAssociatedTokenAccountInstruction(
              publicKey, // payer (sender pays for account creation)
              recipientTokenAddress, // ATA address
              recipientPubkey, // owner
              usdcMint // mint
            )
          )
        }

        // Create transfer instruction
        transaction.add(
          createTransferInstruction(
            senderTokenAddress,
            recipientTokenAddress,
            publicKey,
            amount,
            []
          )
        )
      } else {
        throw new Error(`Unsupported currency: ${raffle.currency}`)
      }


      // Step 3: Send transaction for signing
      // Use sendOptions to ensure proper transaction handling
      // For Android mobile wallets, ensure transaction is properly constructed
      let signature: string
      try {
        // Validate transaction before sending (especially important for mobile wallets)
        if (transaction.instructions.length === 0) {
          throw new Error('Transaction has no instructions. Please try again.')
        }
        
        // Ensure blockhash is still valid (especially important for slower mobile connections)
        if (!transaction.recentBlockhash) {
          throw new Error('Transaction blockhash is missing. Please try again.')
        }
        
        signature = await sendTransaction(transaction, connection, {
          skipPreflight: false,
          preflightCommitment: 'confirmed',
          maxRetries: 3,
        })
      } catch (walletError: any) {
        console.error('Wallet error details:', walletError)
        
        // Provide more helpful error messages for wallet errors
        const errorMessage = walletError?.message || walletError?.toString() || 'Unknown error'
        const errorCode = walletError?.code
        const errorName = walletError?.name || ''
        
        // Check if this is an Android/mobile device
        const isMobile = typeof window !== 'undefined' && /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(
          navigator.userAgent || navigator.vendor || (window as any).opera || ''
        )
        const isAndroid = typeof window !== 'undefined' && /android/i.test(
          navigator.userAgent || navigator.vendor || (window as any).opera || ''
        )
        
        if (errorCode === 4001 || errorMessage.includes('User rejected') || errorMessage.includes('rejected')) {
          throw new Error('Transaction was cancelled. Please try again if you want to continue.')
        }
        if (errorMessage.includes('insufficient funds') || errorMessage.includes('Insufficient')) {
          throw new Error('Insufficient funds in your wallet. Please ensure you have enough SOL/USDC to cover the transaction and fees.')
        }
        // Android/Mobile-specific errors
        if (isAndroid && (errorMessage.includes('blockhash') || errorMessage.includes('Blockhash') || errorMessage.includes('expired'))) {
          throw new Error('Transaction blockhash expired. This can happen on slower connections. Please try again - the transaction will use a fresh blockhash.')
        }
        if (isMobile && (errorMessage.includes('invalid') || errorMessage.includes('Invalid') || errorMessage.includes('serialize'))) {
          throw new Error('Transaction validation failed. Please try: 1) Refreshing the page, 2) Reconnecting your wallet, 3) Ensuring your wallet app is up to date.')
        }
        if (errorMessage.includes('Something went wrong') || errorMessage.includes('wallet')) {
          throw new Error('Wallet extension error. Please try: 1) Refreshing the page, 2) Reconnecting your wallet, 3) Ensuring your wallet extension is up to date.')
        }
        if (errorMessage.includes('Network') || errorMessage.includes('connection')) {
          throw new Error('Network error. Please check your internet connection and try again.')
        }
        if (isMobile && errorMessage.includes('timeout')) {
          throw new Error('Transaction timeout. This can happen on slower mobile connections. Please try again.')
        }
        // Re-throw with original message for other errors
        throw new Error(`Transaction failed: ${errorMessage}. Please try again.`)
      }

      // Step 4: Wait for confirmation using polling (avoids WebSocket subscription issues)
      // Poll for transaction confirmation instead of using confirmTransaction which uses subscriptions
      const maxAttempts = 30 // 30 seconds max wait time
      let attempts = 0
      let confirmed = false
      
      while (attempts < maxAttempts && !confirmed) {
        try {
          const status = await connection.getSignatureStatus(signature)
          if (status?.value?.confirmationStatus === 'confirmed' || status?.value?.confirmationStatus === 'finalized') {
            confirmed = true
            break
          }
          if (status?.value?.err) {
            throw new Error(`Transaction failed: ${JSON.stringify(status.value.err)}`)
          }
        } catch (error) {
          // Ignore errors during polling, just retry
        }
        await new Promise(resolve => setTimeout(resolve, 1000)) // Wait 1 second between attempts
        attempts++
      }
      
      if (!confirmed) {
        throw new Error('Transaction confirmation timeout. Please check your wallet or transaction explorer.')
      }

      // Step 5: Verify entry with transaction signature
      const verifyResponse = await fetch('/api/entries/verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          entryId: entry.id,
          transactionSignature: signature,
        }),
      })

      if (!verifyResponse.ok) {
        const errorData = await verifyResponse.json()
        const errorMessage = errorData.details 
          ? `${errorData.error}: ${errorData.details}` 
          : errorData.error || 'Failed to verify transaction'
        console.error('Verification error details:', errorData)
        throw new Error(errorMessage)
      }

      setSuccess(true)
      
      // Immediately refresh server-side data to ensure consistency
      router.refresh()
      
      // If using realtime, it will automatically update. Otherwise, trigger a fetch.
      // Wait a moment for the database commit, then fetch once
      await new Promise(resolve => setTimeout(resolve, 1000))
      fetchEntries()
      
      // If not using realtime, do one more fetch after a short delay to catch the update
      if (!isUsingRealtime) {
        await new Promise(resolve => setTimeout(resolve, 1500))
        fetchEntries()
      }
      
      // Close the dialog after successful purchase
      setTimeout(() => {
        setShowEnterRaffleDialog(false)
      }, 1500)
    } catch (err) {
      console.error('Purchase error:', err)
      
      // Provide helpful error messages for common RPC errors
      let errorMessage = 'Failed to purchase tickets'
      if (err instanceof Error) {
        const errMsg = err.message || ''
        const errorStr = err.toString()
        
        if (errMsg.includes('403') || errMsg.includes('Access forbidden')) {
          errorMessage = errMsg
        } else if (errMsg.includes('RPC endpoint') || errMsg.includes('RPC')) {
          errorMessage = errMsg
        } else if (errMsg.includes('Temporary internal error') || errorStr.includes('code":19') || errorStr.includes('"code":19')) {
          errorMessage = 'Temporary RPC error. Please try again in a moment. If this persists, the RPC endpoint may be experiencing issues. Consider setting NEXT_PUBLIC_SOLANA_RPC_URL to a private endpoint.'
        } else if (errMsg.includes('500') || errorStr.includes('"code":19')) {
          errorMessage = 'RPC server error. Please try again in a few moments.'
        } else if (errMsg.includes('Network') || errMsg.includes('timeout')) {
          errorMessage = 'Network error. Please check your connection and try again.'
        } else {
          errorMessage = errMsg
        }
      }
      
      setError(errorMessage)
    } finally {
      setIsProcessing(false)
    }
  }

  const handleQuantityChange = (value: string) => {
    // Allow empty string for erasing
    setTicketQuantityDisplay(value)
    if (value === '') {
      return // Allow empty display temporarily
    }
    const numValue = parseInt(value)
    if (isNaN(numValue)) {
      return // Don't update if not a valid number
    }
    const clampedValue = Math.max(1, Math.min(numValue, maxPurchaseQuantity))
    setTicketQuantity(clampedValue)
    // Sync display value with clamped value if it was changed
    if (clampedValue !== numValue) {
      setTicketQuantityDisplay(clampedValue.toString())
    }
  }

  const handleQuantityBlur = () => {
    // When input loses focus, ensure it has a valid value
    if (ticketQuantityDisplay === '' || isNaN(parseInt(ticketQuantityDisplay))) {
      setTicketQuantityDisplay('1')
      setTicketQuantity(1)
    } else {
      const numValue = parseInt(ticketQuantityDisplay)
      const clampedValue = Math.max(1, Math.min(numValue, maxPurchaseQuantity))
      setTicketQuantity(clampedValue)
      setTicketQuantityDisplay(clampedValue.toString())
    }
  }

  const handleOpenEnterRaffleDialog = () => {
    // Reset state when opening dialog
    setTicketQuantity(1)
    setTicketQuantityDisplay('1')
    setError(null)
    setSuccess(false)
    setShowEnterRaffleDialog(true)
  }

  const handleOpenNftTransferDialog = () => {
    setNftTransferSignature('')
    setTransferError(null)
    setTransferSuccess(false)
    setShowNftTransferDialog(true)
  }

  const handleSubmitNftTransfer = async () => {
    if (!connected || !publicKey) {
      setTransferError('Please connect your wallet first')
      return
    }

    if (!nftTransferSignature.trim()) {
      setTransferError('Please enter a transaction signature')
      return
    }

    setIsSubmittingTransfer(true)
    setTransferError(null)
    setTransferSuccess(false)

    try {
      const response = await fetch(`/api/raffles/${raffle.id}/nft-transfer`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          transaction_signature: nftTransferSignature.trim(),
          wallet_address: publicKey.toBase58(),
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to record NFT transfer transaction')
      }

      setTransferSuccess(true)
      
      // Refresh the page to show the updated transaction signature
      setTimeout(() => {
        router.refresh()
        setShowNftTransferDialog(false)
      }, 1500)
    } catch (err) {
      console.error('Error submitting NFT transfer:', err)
      setTransferError(err instanceof Error ? err.message : 'Failed to record NFT transfer transaction')
    } finally {
      setIsSubmittingTransfer(false)
    }
  }

  // Check if raffle has ended
  const hasEnded = !isActive && !isFuture
  // Check if we should show the NFT transfer button (ended, has winner, NFT prize, admin, no transaction recorded yet)
  const showNftTransferButton = 
    hasEnded && 
    raffle.winner_wallet && 
    raffle.prize_type === 'nft' && 
    isAdmin && 
    !raffle.nft_transfer_transaction

  // Size-based styling classes
  const sizeClasses = {
    small: {
      containerPadding: 'py-2 px-2',
      title: 'text-lg mb-0.5',
      description: 'text-xs',
      headerPadding: 'p-2',
      imageSpace: 'space-y-1',
      contentPadding: 'pt-2 space-y-2',
      contentText: 'text-sm',
      labelText: 'text-xs',
      buttonSize: 'sm',
      statsGrid: 'gap-1.5',
      badgeSize: 'sm',
    },
    medium: {
      containerPadding: 'py-4 px-3',
      title: 'text-xl mb-1',
      description: 'text-sm',
      headerPadding: 'p-3',
      imageSpace: 'space-y-2',
      contentPadding: 'pt-3 space-y-3',
      contentText: 'text-base',
      labelText: 'text-xs',
      buttonSize: 'default',
      statsGrid: 'gap-2',
      badgeSize: 'sm',
    },
    large: {
      containerPadding: 'py-6 px-4',
      title: 'text-2xl mb-2',
      description: 'text-base',
      headerPadding: 'p-4',
      imageSpace: 'space-y-3',
      contentPadding: 'pt-4 space-y-4',
      contentText: 'text-lg',
      labelText: 'text-sm',
      buttonSize: 'lg',
      statsGrid: 'gap-3',
      badgeSize: 'default',
    },
  }

  const classes = sizeClasses[imageSize]

  return (
    <div className={`container mx-auto ${imageSize === 'small' ? 'py-4 px-3' : imageSize === 'medium' ? 'py-6 px-3 sm:px-4' : 'py-8 px-3 sm:px-4'}`}>
      <div className={`mx-auto ${imageSize === 'small' ? 'space-y-3 max-w-xl' : imageSize === 'medium' ? 'space-y-4 max-w-3xl' : 'space-y-6 max-w-5xl'}`}>
        <Button
          variant="outline"
          onClick={() => router.push('/raffles')}
          className="mb-4 touch-manipulation min-h-[44px] text-sm sm:text-base"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Listings
        </Button>
        <Card className={getThemeAccentClasses(raffle.theme_accent)} style={borderStyle}>
          <CardHeader className={classes.headerPadding}>
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <CardTitle className={classes.title}>{raffle.title}</CardTitle>
                <CardDescription className={classes.description}>
                  {raffle.description}
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <OwlVisionBadge score={currentOwlVisionScore} />
              </div>
            </div>
          </CardHeader>

          {raffle.image_url && (
            <>
              {!imageError && (
                <div className={`flex items-center justify-end gap-2 ${classes.headerPadding} pt-0 pb-2`}>
                  <span className="text-sm text-muted-foreground mr-2">Image size:</span>
                  <div className="flex gap-1 border rounded-md p-1">
                    <Button
                      variant={imageSize === 'small' ? 'default' : 'ghost'}
                      size="sm"
                      onClick={() => setImageSize('small')}
                      className="h-8 px-3"
                      title="Small"
                    >
                      <Grid3x3 className="h-4 w-4" />
                    </Button>
                    <Button
                      variant={imageSize === 'medium' ? 'default' : 'ghost'}
                      size="sm"
                      onClick={() => setImageSize('medium')}
                      className="h-8 px-3"
                      title="Medium"
                    >
                      <LayoutGrid className="h-4 w-4" />
                    </Button>
                    <Button
                      variant={imageSize === 'large' ? 'default' : 'ghost'}
                      size="sm"
                      onClick={() => setImageSize('large')}
                      className="h-8 px-3"
                      title="Large"
                    >
                      <Square className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
              {!imageError ? (
                <div className={`!relative w-full ${imageSize === 'small' ? 'aspect-[4/3]' : imageSize === 'medium' ? 'aspect-[4/3]' : 'aspect-[4/3]'} overflow-hidden`}>
                  <Image
                    src={raffle.image_url}
                    alt={raffle.title}
                    fill
                    sizes="(max-width: 768px) 100vw, (max-width: 1200px) 80vw, 1200px"
                    priority
                    className="object-contain"
                    onError={() => setImageError(true)}
                    unoptimized={raffle.image_url.startsWith('http://')}
                  />
                </div>
              ) : (
                <div className={`w-full ${imageSize === 'small' ? 'aspect-[4/3]' : imageSize === 'medium' ? 'aspect-[4/3]' : 'aspect-[4/3]'} flex items-center justify-center bg-muted border rounded`}>
                  <span className="text-muted-foreground">Image unavailable</span>
                </div>
              )}
            </>
          )}

          <CardContent className={classes.contentPadding}>
            <div className={`grid grid-cols-2 sm:grid-cols-2 md:grid-cols-4 ${classes.statsGrid}`}>
              {raffle.prize_amount != null && raffle.prize_amount > 0 && raffle.prize_currency && (
                <div>
                  <p className={classes.labelText + ' text-muted-foreground'}>Prize</p>
                  <p className={classes.contentText + ' font-bold'}>
                    {raffle.prize_amount} {raffle.prize_currency}
                  </p>
                </div>
              )}
              {raffle.ticket_price > 0 && (
                <div>
                  <p className={classes.labelText + ' text-muted-foreground'}>Ticket Price</p>
                  <div className={classes.contentText + ' font-bold flex items-center gap-2'}>
                    {raffle.ticket_price.toFixed(6).replace(/\.?0+$/, '')} {raffle.currency}
                    <CurrencyIcon currency={raffle.currency as 'SOL' | 'USDC'} size={imageSize === 'small' ? 16 : 20} className="inline-block" />
                  </div>
                </div>
              )}
              {minTickets ? (
                <div className="col-span-2 sm:col-span-2 md:col-span-2">
                  <p className={classes.labelText + ' text-muted-foreground'}>Tickets Sold</p>
                  <p className={classes.contentText + ' font-bold'}>
                    {totalTicketsSold}
                  </p>
                </div>
              ) : (
                <div>
                  <p className={classes.labelText + ' text-muted-foreground'}>Confirmed Entries</p>
                  <p className={classes.contentText + ' font-bold'}>{totalTicketsSold}</p>
                </div>
              )}
              {raffle.max_tickets !== null && (
                <div>
                  <p className={classes.labelText + ' text-muted-foreground'}>Available Tickets</p>
                  <p className={classes.contentText + ' font-bold'}>
                    {availableTickets !== null ? availableTickets : raffle.max_tickets}
                  </p>
                </div>
              )}
              <div>
                <p className={classes.labelText + ' text-muted-foreground'}>Status</p>
                <div className="mt-3 sm:mt-2 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={isFuture ? 'default' : (isActive ? 'default' : 'secondary')} className={`${imageSize === 'small' ? 'text-xs' : ''} ${isFuture ? 'bg-red-500 hover:bg-red-600 text-white' : (isActive ? 'bg-green-500 hover:bg-green-600 text-white' : '')}`}>
                      {isFuture
                        ? `Starts ${formatDistanceToNow(new Date(raffle.start_time), { addSuffix: true })}`
                        : isActive
                        ? `Ends ${formatDistanceToNow(new Date(raffle.end_time), { addSuffix: true })}`
                        : 'Ended'}
                    </Badge>
                    {minTickets && (
                      <Badge 
                        variant="outline" 
                        className="bg-orange-500/20 border-orange-500 text-orange-400 hover:bg-orange-500/30"
                        title={`Minimum ${minTickets} tickets required to draw winner`}
                      >
                        Draw Threshold: {minTickets}
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {isFuture ? (
                      <>Starts: {formatDateTimeWithTimezone(raffle.start_time)}</>
                    ) : isActive ? (
                      <>Ends: {formatDateTimeWithTimezone(raffle.end_time)}</>
                    ) : (
                      <>Ended: {formatDateTimeWithTimezone(raffle.end_time)}</>
                    )}
                  </p>
                </div>
              </div>
            </div>

            {connected && (
              <div className={`${imageSize === 'small' ? 'p-2' : imageSize === 'medium' ? 'p-3' : 'p-4'} rounded-lg bg-muted/50 border border-primary/20`}>
                <div className="flex items-center justify-between">
                  <div>
                    <p className={classes.labelText + ' text-muted-foreground'}>Your Tickets</p>
                    <p className={`${imageSize === 'small' ? 'text-lg' : imageSize === 'medium' ? 'text-xl' : 'text-2xl'} font-bold`} style={{ color: themeColor }}>
                      {userTickets} {userTickets === 1 ? 'ticket' : 'tickets'}
                    </p>
                  </div>
                  {userTickets > 0 && (
                    <Badge variant="default" className={`${imageSize === 'small' ? 'text-xs px-2 py-1' : imageSize === 'medium' ? 'text-sm px-3 py-1.5' : 'text-lg px-4 py-2'}`}>
                      {userTickets}
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  💡 Don't see your entry? Try refreshing the page.
                </p>
              </div>
            )}

            {isActive && !isFuture && (
              <div className="flex flex-col gap-3 items-center">
                <Button
                  onClick={handleOpenEnterRaffleDialog}
                  disabled={availableTickets !== null && availableTickets <= 0}
                  size={classes.buttonSize as any}
                  style={{
                    backgroundColor: themeColor,
                    color: '#000',
                  }}
                  className={`w-full md:w-auto touch-manipulation min-h-[44px] text-base sm:text-sm ${imageSize === 'small' ? 'px-4' : 'px-6 sm:px-8'}`}
                >
                  {availableTickets !== null && availableTickets <= 0
                    ? 'Sold Out'
                    : 'Enter Raffle'}
                </Button>
              </div>
            )}
            {isFuture && (
              <div className="flex justify-center">
                <Badge variant="default" className="bg-red-500 hover:bg-red-600 text-white px-4 py-2">
                  Starts {formatDistanceToNow(new Date(raffle.start_time), { addSuffix: true })}
                </Badge>
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
              {connected && (
                <Button
                  variant="outline"
                  onClick={() => setShowParticipants(true)}
                  className="flex-1 touch-manipulation min-h-[44px] text-sm sm:text-base"
                >
                  <Users className="mr-2 h-4 w-4" />
                  <span className="hidden sm:inline">View Participants ({currentOwlVisionScore.uniqueWallets})</span>
                  <span className="sm:hidden">Participants ({currentOwlVisionScore.uniqueWallets})</span>
                </Button>
              )}
              {raffle.winner_wallet && (
                <Button 
                  variant="outline" 
                  className="flex-1 touch-manipulation min-h-[44px] text-sm sm:text-base"
                  onClick={() => setShowWinner(true)}
                >
                  <Trophy className="mr-2 h-4 w-4" />
                  View Winner
                </Button>
              )}
              {showNftTransferButton && (
                <Button
                  variant="outline"
                  onClick={handleOpenNftTransferDialog}
                  className="flex-1 touch-manipulation min-h-[44px] text-sm sm:text-base"
                >
                  <Send className="mr-2 h-4 w-4" />
                  <span className="hidden sm:inline">Record NFT Transfer</span>
                  <span className="sm:hidden">Record Transfer</span>
                </Button>
              )}
              {isAdmin && (
                <Button
                  variant="outline"
                  onClick={() => router.push(`/admin/raffles/${raffle.id}`)}
                  className="flex-1 touch-manipulation min-h-[44px] text-sm sm:text-base"
                >
                  <Edit className="mr-2 h-4 w-4" />
                  <span className="hidden sm:inline">Edit Raffle</span>
                  <span className="sm:hidden">Edit</span>
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <ParticipantsModal
        open={showParticipants}
        onOpenChange={setShowParticipants}
        entries={entries}
        themeAccent={raffle.theme_accent}
      />

      {raffle.winner_wallet && (
        <WinnerModal
          open={showWinner}
          onOpenChange={setShowWinner}
          winnerWallet={raffle.winner_wallet}
          prizeAmount={raffle.prize_amount}
          prizeCurrency={raffle.prize_currency}
          themeAccent={raffle.theme_accent}
          nftTransferTransaction={raffle.nft_transfer_transaction}
          prizeType={raffle.prize_type}
          nftMintAddress={raffle.nft_mint_address}
          nftCollectionName={raffle.nft_collection_name}
        />
      )}

      <Dialog open={showNftTransferDialog} onOpenChange={setShowNftTransferDialog}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Record NFT Transfer Transaction</DialogTitle>
            <DialogDescription>
              Enter the transaction signature for the NFT transfer to the winner. This will be visible to all participants for transparency.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="nft-transfer-signature">Transaction Signature</Label>
              <Input
                id="nft-transfer-signature"
                type="text"
                placeholder="Enter transaction signature..."
                value={nftTransferSignature}
                onChange={(e) => setNftTransferSignature(e.target.value)}
                disabled={isSubmittingTransfer}
                className="text-base sm:text-sm h-11 sm:h-10 font-mono"
              />
              <p className="text-xs text-muted-foreground">
                The Solana transaction signature that transferred the NFT to the winner's wallet.
              </p>
            </div>
            
            {transferError && (
              <div className="p-3 rounded-lg bg-destructive/10 border border-destructive text-destructive text-sm">
                {transferError}
              </div>
            )}
            
            {transferSuccess && (
              <div className="p-3 rounded-lg bg-green-500/10 border border-green-500 text-green-500 text-sm">
                NFT transfer transaction recorded successfully!
              </div>
            )}
          </div>

          <DialogFooter className="flex-col sm:flex-row gap-3 sm:gap-2">
            <Button
              variant="outline"
              onClick={() => setShowNftTransferDialog(false)}
              disabled={isSubmittingTransfer}
              className="w-full sm:w-auto touch-manipulation min-h-[44px] text-base sm:text-sm"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSubmitNftTransfer}
              disabled={!connected || isSubmittingTransfer || !nftTransferSignature.trim()}
              style={{
                backgroundColor: themeColor,
                color: '#000',
              }}
              className="w-full sm:w-auto touch-manipulation min-h-[44px] text-base sm:text-sm"
            >
              {!connected
                ? 'Connect Wallet'
                : isSubmittingTransfer
                ? 'Recording...'
                : 'Record Transaction'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showEnterRaffleDialog} onOpenChange={setShowEnterRaffleDialog}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Enter Raffle</DialogTitle>
            <DialogDescription>
              Select the number of tickets you want to purchase
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            {raffle.max_tickets && (
              <div className="p-3 rounded-lg bg-muted border">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Tickets Available</span>
                  <span className="font-semibold">
                    {availableTickets !== null && availableTickets >= 0 
                      ? `${availableTickets} / ${raffle.max_tickets}`
                      : `${raffle.max_tickets} / ${raffle.max_tickets}`}
                  </span>
                </div>
                {availableTickets !== null && availableTickets <= 0 && (
                  <p className="text-xs text-destructive mt-1">
                    All tickets have been sold
                  </p>
                )}
              </div>
            )}
            
              <div className="space-y-2">
                <Label htmlFor="dialog-quantity">Number of Tickets</Label>
                <Input
                  id="dialog-quantity"
                  type="number"
                  min="1"
                  max={maxPurchaseQuantity}
                  value={ticketQuantityDisplay}
                  onChange={(e) => handleQuantityChange(e.target.value)}
                  onBlur={handleQuantityBlur}
                  disabled={availableTickets !== null && availableTickets <= 0}
                  className="text-base sm:text-sm h-11 sm:h-10"
                />
              {raffle.max_tickets && availableTickets !== null && availableTickets > 0 && (
                <p className="text-xs text-muted-foreground">
                  Maximum {availableTickets} ticket{availableTickets !== 1 ? 's' : ''} available
                </p>
              )}
            </div>
            
            <HootBoostMeter quantity={ticketQuantity} />
            
            <div className="flex items-center justify-between pt-2 border-t">
              <span className="text-sm text-muted-foreground">Total Cost</span>
              <div className="text-xl font-bold flex items-center gap-2">
                {purchaseAmount.toFixed(6)} {raffle.currency}
                <CurrencyIcon currency={raffle.currency as 'SOL' | 'USDC'} size={20} className="inline-block" />
              </div>
            </div>
            
            {error && (
              <div className="p-3 rounded-lg bg-destructive/10 border border-destructive text-destructive text-sm">
                {error}
              </div>
            )}
            
            {success && (
              <div className="p-3 rounded-lg bg-green-500/10 border border-green-500 text-green-500 text-sm space-y-2">
                <p>Tickets purchased successfully! Transaction confirmed.</p>
                <p className="text-xs opacity-90">
                  Your entry should appear shortly. If you don't see it, please refresh the page.
                </p>
              </div>
            )}
          </div>

          <DialogFooter className="flex-col sm:flex-row gap-3 sm:gap-2">
            <Button
              variant="outline"
              onClick={() => setShowEnterRaffleDialog(false)}
              disabled={isProcessing}
              className="w-full sm:w-auto touch-manipulation min-h-[44px] text-base sm:text-sm"
            >
              Cancel
            </Button>
            <Button
              onClick={handlePurchase}
              disabled={
                availableTickets !== null && availableTickets <= 0 ||
                !connected ||
                isProcessing
              }
              style={{
                backgroundColor: themeColor,
                color: '#000',
              }}
              className="w-full sm:w-auto touch-manipulation min-h-[44px] text-base sm:text-sm"
            >
              {!connected
                ? 'Connect Wallet'
                : isProcessing
                ? 'Processing...'
                : availableTickets !== null && availableTickets <= 0
                ? 'Sold Out'
                : 'Buy Tickets'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
