'use client'

import { useState, useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { useWallet, useConnection } from '@solana/wallet-adapter-react'
import Link from 'next/link'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { OwlVisionBadge } from '@/components/OwlVisionBadge'
import { HootBoostMeter } from '@/components/HootBoostMeter'
import { CurrencyIcon } from '@/components/CurrencyIcon'
import type { Raffle, Entry } from '@/lib/types'
import { calculateOwlVisionScore } from '@/lib/owl-vision'
import { isRaffleEligibleToDraw, calculateTicketsSold, getRaffleMinimum } from '@/lib/db/raffles'
import { getThemeAccentBorderStyle, getThemeAccentClasses, getThemeAccentColor } from '@/lib/theme-accent'
import { formatDistanceToNow } from 'date-fns'
import { formatDateTimeWithTimezone } from '@/lib/utils'
import { Trash2, Edit, Trophy } from 'lucide-react'
import Image from 'next/image'
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

type CardSize = 'small' | 'medium' | 'large'

interface RaffleCardProps {
  raffle: Raffle
  entries: Entry[]
  size?: CardSize
  onDeleted?: (raffleId: string) => void
  priority?: boolean
}

export function RaffleCard({ raffle, entries, size = 'medium', onDeleted, priority = false }: RaffleCardProps) {
  const router = useRouter()
  const pathname = usePathname()
  const { publicKey, sendTransaction, connected } = useWallet()
  const { connection } = useConnection()
  const [isAdmin, setIsAdmin] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [imageModalOpen, setImageModalOpen] = useState(false)
  const [showQuickBuy, setShowQuickBuy] = useState(false)
  const [ticketQuantity, setTicketQuantity] = useState(1)
  const [ticketQuantityDisplay, setTicketQuantityDisplay] = useState('1')
  const [isProcessing, setIsProcessing] = useState(false)
  
  // Calculate purchase amount automatically based on ticket price and quantity
  const purchaseAmount = raffle.ticket_price * ticketQuantity
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [imageError, setImageError] = useState(false)
  
  const owlVisionScore = calculateOwlVisionScore(raffle, entries)
  const now = new Date()
  const startTime = new Date(raffle.start_time)
  const endTime = new Date(raffle.end_time)
  const isFuture = startTime > now
  const isActive = endTime > now && raffle.is_active && !isFuture
  const isWinner = !isActive && raffle.winner_wallet && publicKey?.toBase58() === raffle.winner_wallet
  
  // Use red color for future raffles, otherwise use theme accent
  const baseBorderStyle = getThemeAccentBorderStyle(raffle.theme_accent)
  const borderStyle = isFuture ? {
    borderColor: '#ef4444', // red-500
    boxShadow: '0 0 20px rgba(239, 68, 68, 0.5)', // red glow
  } : baseBorderStyle
  const themeColor = isFuture ? '#ef4444' : getThemeAccentColor(raffle.theme_accent)
  
  // Calculate available tickets
  const totalTicketsSold = calculateTicketsSold(entries)
  const availableTickets = raffle.max_tickets 
    ? raffle.max_tickets - totalTicketsSold 
    : null
  const maxPurchaseQuantity = availableTickets !== null 
    ? Math.max(0, availableTickets) 
    : 100
  
  // Calculate minimum eligibility
  const minTickets = getRaffleMinimum(raffle)
  const isEligibleToDraw = minTickets ? isRaffleEligibleToDraw(raffle, entries) : true

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

  const handleDelete = async (e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault()
      e.stopPropagation()
    }

    console.log('handleDelete called', { connected, publicKey: publicKey?.toBase58(), isAdmin, raffleId: raffle.id })

    if (!connected || !publicKey) {
      alert('Please connect your wallet to delete a raffle')
      setDeleteDialogOpen(false)
      return
    }

    if (!isAdmin) {
      alert('Only admins can delete raffles')
      setDeleteDialogOpen(false)
      return
    }

    setDeleting(true)

    try {
      const walletAddress = publicKey.toBase58()
      console.log('Sending delete request', { raffleId: raffle.id, walletAddress })
      
      const response = await fetch(`/api/raffles/${raffle.id}`, {
        method: 'DELETE',
        headers: { 
          'Content-Type': 'application/json',
          'x-wallet-address': walletAddress
        },
        body: JSON.stringify({ wallet_address: walletAddress }),
      })

      console.log('Delete response status:', response.status)

      if (response.ok) {
        const result = await response.json().catch(() => ({ success: true }))
        console.log('Delete successful:', result)
        // Close dialog
        setDeleteDialogOpen(false)
        // Immediately remove from UI if callback provided (client-side update)
        if (onDeleted) {
          console.log('Removing raffle from UI:', raffle.id)
          onDeleted(raffle.id)
          // Don't refresh if we're on the raffles page - client-side update is sufficient
          // The server will have the correct data on next navigation/refresh
        } else {
          console.log('No onDeleted callback provided, using router refresh only')
          // If no callback, refresh immediately (fallback)
          router.refresh()
        }
        // If on a detail page, navigate to raffles list
        if (pathname?.startsWith('/raffles/')) {
          router.push('/raffles')
        }
      } else {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }))
        console.error('Delete failed:', errorData)
        alert(errorData.error || 'Error deleting raffle')
      }
    } catch (error) {
      console.error('Error deleting raffle:', error)
      alert('Error deleting raffle. Please check the console for details.')
    } finally {
      setDeleting(false)
    }
  }

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

      // Step 2: Build transaction
      let latestBlockhash: { blockhash: string; lastValidBlockHeight: number } | null = null
      let retries = 3
      while (retries > 0) {
        try {
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
          
          if (retries === 0) {
            if (isFetchError) {
              throw new Error(
                'Network connection failed. This may be a network issue or CORS restriction on mobile. ' +
                'Please check your internet connection and try again. ' +
                'If the issue persists, ensure you have set NEXT_PUBLIC_SOLANA_RPC_URL ' +
                'to a private RPC endpoint (Helius, QuickNode, or Alchemy) that supports mobile access.'
              )
            } else {
              throw new Error('Failed to get blockhash. Please try again.')
            }
          }
          // Exponential backoff: wait longer for each retry (longer delays for fetch errors)
          const backoffDelay = isFetchError ? 2000 * (3 - retries) : 1000 * (3 - retries)
          await new Promise(resolve => setTimeout(resolve, backoffDelay))
        }
      }
      
      if (!latestBlockhash) {
        throw new Error('Failed to get recent blockhash')
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
        const lamports = Math.round(paymentDetails.amount * LAMPORTS_PER_SOL)
        transaction.add(
          SystemProgram.transfer({
            fromPubkey: publicKey,
            toPubkey: recipientPubkey,
            lamports,
          })
        )
      } else if (raffle.currency === 'USDC') {
        const usdcMint = new PublicKey(paymentDetails.usdcMint)
        const mintInfo = await getMint(connection, usdcMint)
        const decimals = mintInfo.decimals
        const amount = BigInt(Math.round(paymentDetails.amount * Math.pow(10, decimals)))

        const senderTokenAddress = await getAssociatedTokenAddress(usdcMint, publicKey)
        const recipientTokenAddress = await getAssociatedTokenAddress(usdcMint, recipientPubkey)

        let accountExists = false
        try {
          await getAccount(connection, recipientTokenAddress)
          accountExists = true
        } catch (error: any) {
          if (!error?.message?.includes('TokenAccountNotFoundError') && !error?.message?.includes('could not find account')) {
            throw error
          }
        }
        
        if (!accountExists) {
          transaction.add(
            createAssociatedTokenAccountInstruction(
              publicKey,
              recipientTokenAddress,
              recipientPubkey,
              usdcMint
            )
          )
        }

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

      // Step 4: Wait for confirmation
      const maxAttempts = 30
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
          // Ignore errors during polling
        }
        await new Promise(resolve => setTimeout(resolve, 1000))
        attempts++
      }
      
      if (!confirmed) {
        throw new Error('Transaction confirmation timeout')
      }

      // Step 5: Verify entry
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
        throw new Error(errorData.error || 'Failed to verify transaction')
      }

      setSuccess(true)
      router.refresh()
      
      setTimeout(() => {
        setShowQuickBuy(false)
        setSuccess(false)
        setTicketQuantity(1)
        setTicketQuantityDisplay('1')
      }, 2000)
    } catch (err) {
      console.error('Purchase error:', err)
      
      // Provide helpful error messages for common errors
      let errorMessage = 'Failed to purchase tickets'
      if (err instanceof Error) {
        const errMsg = err.message || ''
        const errorStr = err.toString()
        
        // Prioritize specific error messages from fetch retry logic
        if (errMsg.includes('Network connection failed') || errMsg.includes('connectivity issue')) {
          errorMessage = errMsg
        } else if (errMsg.includes('Failed to fetch') || errMsg.includes('failed to fetch')) {
          errorMessage = 'Network connection failed. Please check your internet connection and try again. If the issue persists, try switching between WiFi and mobile data.'
        } else if (errMsg.includes('403') || errMsg.includes('Access forbidden')) {
          errorMessage = errMsg
        } else if (errMsg.includes('RPC endpoint') || errMsg.includes('RPC')) {
          errorMessage = errMsg
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

  const handleToggleQuickBuy = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!showQuickBuy) {
      setTicketQuantity(1)
      setTicketQuantityDisplay('1')
      setError(null)
      setSuccess(false)
    }
    setShowQuickBuy(!showQuickBuy)
  }

  // Small size - List format (horizontal)
  if (size === 'small') {
    return (
      <div className="relative z-10 md:hover:z-50">
        <Link 
          href={`/raffles/${raffle.slug}`}
          onClick={(e) => {
            const target = e.target as HTMLElement
            // Prevent navigation if clicking on buttons or interactive form elements
            if (target.closest('button') || target.closest('input') || target.closest('label')) {
              e.preventDefault()
            }
          }}
        >
          <Card
            className={`${getThemeAccentClasses(raffle.theme_accent, 'hover:scale-[1.02] cursor-pointer flex flex-row items-stretch p-0 overflow-hidden')} ${isWinner ? 'ring-4 ring-yellow-400 ring-offset-2 relative winner-golden-card' : ''}`}
            style={isWinner ? { ...borderStyle, borderColor: '#facc15' } : borderStyle}
          >
            {isWinner && (
              <div className="winner-golden-overlay absolute inset-0 rounded-lg pointer-events-none z-0" />
            )}
            {raffle.image_url && !imageError && (
              <div 
                className="!relative w-40 md:w-48 aspect-square flex-shrink-0 overflow-hidden cursor-pointer z-10 m-0 p-0 rounded-l-lg"
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  setImageModalOpen(true)
                }}
              >
                <Image
                  src={raffle.image_url}
                  alt={raffle.title}
                  fill
                  sizes="(max-width: 768px) 160px, 192px"
                  className="object-cover !w-full !h-full"
                  priority={priority}
                  onError={() => setImageError(true)}
                  unoptimized={raffle.image_url.startsWith('http://')}
                />
              </div>
            )}
            {imageError && (
              <div className="w-40 md:w-48 h-full flex-shrink-0 flex items-center justify-center bg-muted border rounded z-10 relative">
                <span className="text-xs text-muted-foreground text-center px-2">Image unavailable</span>
              </div>
            )}
            <div className="flex-1 flex flex-col p-2.5 min-w-0 z-10 relative">
              <div className="flex items-start justify-between gap-2 mb-1">
                <CardTitle className="text-sm font-semibold line-clamp-1 flex-1">{raffle.title}</CardTitle>
                <div className="flex items-center gap-2 group/owlvision">
                  {minTickets && (
                    <Badge 
                      variant="outline" 
                      className="bg-orange-500/20 border-orange-500 text-orange-400 hover:bg-orange-500/30 text-xs"
                    >
                      Min Draw: {minTickets}
                    </Badge>
                  )}
                  <OwlVisionBadge score={owlVisionScore} />
                </div>
              </div>
            <CardDescription className="text-xs text-muted-foreground line-clamp-1 mb-2">
              {raffle.description}
            </CardDescription>
            <div className="flex items-center gap-4 text-xs mb-2">
              {raffle.prize_amount != null && raffle.prize_amount > 0 && raffle.prize_currency && (
                <span>
                  <span className="text-muted-foreground">Prize: </span>
                  <span className="font-semibold">{raffle.prize_amount} {raffle.prize_currency}</span>
                </span>
              )}
              <span className="flex items-center gap-1.5">
                <span className="text-muted-foreground">Price: </span>
                <span className="font-semibold flex items-center gap-1.5">
                  {raffle.ticket_price} {raffle.currency}
                  <CurrencyIcon currency={raffle.currency as 'SOL' | 'USDC'} size={14} className="inline-block" />
                </span>
              </span>
              {totalTicketsSold > 0 && (
                <span>
                  <span className="text-muted-foreground">Entries: </span>
                  <span className="font-semibold">{totalTicketsSold}</span>
                </span>
              )}
            </div>
            <div className="flex items-center justify-between mt-auto">
              <span className="text-xs text-muted-foreground">
                {isFuture ? (
                  <span title={formatDateTimeWithTimezone(raffle.start_time)}>
                    Starts {formatDistanceToNow(new Date(raffle.start_time), { addSuffix: true })}
                  </span>
                ) : isActive ? (
                  <span title={formatDateTimeWithTimezone(raffle.end_time)}>
                    Ends {formatDistanceToNow(new Date(raffle.end_time), { addSuffix: true })}
                  </span>
                ) : (
                  <span title={formatDateTimeWithTimezone(raffle.end_time)}>Ended</span>
                )}
              </span>
              <div className="flex items-center gap-2 transition-opacity duration-200 group-hover/owlvision:opacity-30" style={{ zIndex: 1 }}>
                <Badge 
                  variant={isFuture ? 'default' : (isActive ? 'default' : 'secondary')} 
                  className={`text-xs ${isFuture ? 'bg-red-500 hover:bg-red-600 text-white' : ''}`}
                >
                  {isFuture ? 'Future' : (isActive ? 'Active' : 'Ended')}
                </Badge>
                {isActive && (
                  <Button 
                    type="button"
                    size="sm" 
                    className="h-8 sm:h-7 text-xs sm:text-xs touch-manipulation min-h-[32px] sm:min-h-[28px] px-3 sm:px-2"
                    onClick={handleToggleQuickBuy}
                  >
                    {showQuickBuy ? 'Cancel' : 'Buy'}
                  </Button>
                )}
              </div>
            </div>
            {!isActive && !isFuture && raffle.winner_wallet && (
              <div className="mt-2 pt-2 border-t flex items-center gap-2">
                <Trophy className="h-3 w-3 text-yellow-500 flex-shrink-0" />
                <span className="text-xs text-muted-foreground">
                  Winner: <span className="font-mono font-semibold text-foreground">
                    {raffle.winner_wallet.slice(0, 6)}...{raffle.winner_wallet.slice(-4)}
                  </span>
                </span>
              </div>
            )}
            {showQuickBuy && isActive && !isFuture && (
              <div className="mt-3 pt-3 border-t space-y-3">
                {raffle.max_tickets && availableTickets !== null && availableTickets > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {availableTickets} ticket{availableTickets !== 1 ? 's' : ''} available
                  </p>
                )}
                <div className="space-y-2">
                  <Label htmlFor="small-quantity" className="text-xs">Quantity</Label>
                  <Input
                    id="small-quantity"
                    type="number"
                    min="1"
                    max={maxPurchaseQuantity}
                    value={ticketQuantityDisplay}
                    onChange={(e) => handleQuantityChange(e.target.value)}
                    onBlur={handleQuantityBlur}
                    disabled={availableTickets !== null && availableTickets <= 0}
                    className="h-10 sm:h-7 text-base sm:text-xs"
                  />
                </div>
                <div className="flex items-center justify-between pt-1 border-t">
                  <span className="text-xs text-muted-foreground">Total</span>
                  <div className="text-sm font-bold flex items-center gap-1">
                    {purchaseAmount.toFixed(6)} {raffle.currency}
                    <CurrencyIcon currency={raffle.currency as 'SOL' | 'USDC'} size={12} className="inline-block" />
                  </div>
                </div>
                {error && (
                  <div className="p-2 rounded bg-destructive/10 border border-destructive text-destructive text-xs">
                    {error}
                  </div>
                )}
                {success && (
                  <div className="p-2 rounded bg-green-500/10 border border-green-500 text-green-500 text-xs">
                    Tickets purchased successfully!
                  </div>
                )}
                <Button
                  onClick={handlePurchase}
                  disabled={availableTickets !== null && availableTickets <= 0 || !connected || isProcessing}
                  size="sm"
                  className="w-full h-11 sm:h-7 text-base sm:text-xs touch-manipulation min-h-[44px] sm:min-h-[28px]"
                  style={{
                    backgroundColor: themeColor,
                    color: '#000',
                  }}
                >
                  {!connected ? 'Connect Wallet' : isProcessing ? 'Processing...' : 'Buy Tickets'}
                </Button>
              </div>
            )}
          </div>
        </Card>
      </Link>
      {isAdmin && (
        <>
          <div className="absolute top-2 right-2 z-10 flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9 w-9 sm:h-7 sm:w-7 p-0 bg-background touch-manipulation min-h-[36px] min-w-[36px] sm:min-h-[28px] sm:min-w-[28px]"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                router.push(`/admin/raffles/${raffle.id}`)
              }}
            >
              <Edit className="h-4 w-4" />
            </Button>
            {isActive && (
              <Button
                type="button"
                variant="destructive"
                size="sm"
                className="h-9 w-9 sm:h-7 sm:w-7 p-0 touch-manipulation min-h-[36px] min-w-[36px] sm:min-h-[28px] sm:min-w-[28px]"
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  setDeleteDialogOpen(true)
                }}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
          <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Delete Raffle</DialogTitle>
                <DialogDescription>
                  Are you sure you want to delete "{raffle.title}"? This action cannot be undone and will also delete all associated entries.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter className="flex-col sm:flex-row gap-3 sm:gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setDeleteDialogOpen(false)}
                  disabled={deleting}
                  className="w-full sm:w-auto touch-manipulation min-h-[44px] text-base sm:text-sm"
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    handleDelete(e)
                  }}
                  disabled={deleting}
                  className="w-full sm:w-auto touch-manipulation min-h-[44px] text-base sm:text-sm"
                >
                  {deleting ? 'Deleting...' : 'Delete Raffle'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Dialog open={imageModalOpen} onOpenChange={setImageModalOpen}>
            <DialogContent className="max-w-5xl w-full p-0">
              {raffle.image_url && !imageError && (
                <div className="!relative w-full h-[80vh] min-h-[500px]">
                  <Image
                    src={raffle.image_url}
                    alt={raffle.title}
                    fill
                    sizes="100vw"
                    className="object-contain"
                    priority={priority}
                    onError={() => setImageError(true)}
                    unoptimized={raffle.image_url.startsWith('http://')}
                  />
                </div>
              )}
              {imageError && (
                <div className="w-full h-[80vh] min-h-[500px] flex items-center justify-center bg-muted border rounded">
                  <span className="text-muted-foreground">Image unavailable</span>
                </div>
              )}
            </DialogContent>
          </Dialog>
        </>
      )}
    </div>
    )
  }

  // Medium and Large sizes - Card format (vertical)
  const sizeClasses = {
    medium: {
      title: 'text-lg',
      description: 'text-sm line-clamp-2',
      content: 'text-sm',
      footer: 'text-xs',
      badge: 'text-xs',
    },
    large: {
      title: 'text-xl',
      description: 'text-base line-clamp-2',
      content: 'text-base',
      footer: 'text-sm',
      badge: 'text-sm',
    },
  }

  const displaySize = size === 'medium' ? 'medium' : 'large'
  const classes = sizeClasses[displaySize]

  return (
    <div className="relative z-10 md:hover:z-50">
      <Link 
        href={`/raffles/${raffle.slug}`} 
        onClick={(e) => {
          const target = e.target as HTMLElement
          // Prevent navigation if clicking on buttons or interactive form elements
          if (target.closest('button') || target.closest('input') || target.closest('label')) {
            e.preventDefault()
          }
          // Prevent navigation for future raffles
          if (isFuture) {
            e.preventDefault()
          }
        }}
      >
        <Card
          className={`${getThemeAccentClasses(raffle.theme_accent)} h-full flex flex-col hover:scale-105 cursor-pointer p-0 overflow-hidden rounded-xl ${isWinner ? 'ring-4 ring-yellow-400 ring-offset-2 relative winner-golden-card' : ''}`}
          style={isWinner ? { ...borderStyle, borderColor: '#facc15' } : borderStyle}
        >
          {isWinner && (
            <div className="winner-golden-overlay absolute inset-0 rounded-xl pointer-events-none z-0" />
          )}
          {raffle.image_url && !imageError && (
            <div className="!relative w-full aspect-square overflow-hidden z-10 rounded-t-xl m-0 p-0">
              <Image
                src={raffle.image_url}
                alt={raffle.title}
                fill
                sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 400px"
                className="object-cover !w-full !h-full"
                priority={priority}
                onError={() => setImageError(true)}
                unoptimized={raffle.image_url.startsWith('http://')}
              />
              {/* Metadata overlay on image */}
              <div 
                className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent opacity-0 hover:opacity-100 transition-opacity z-10 cursor-pointer"
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  setImageModalOpen(true)
                }}
              >
                <div className="absolute bottom-0 left-0 right-0 p-4">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <CardTitle className={`${classes.title} text-white line-clamp-2`}>{raffle.title}</CardTitle>
                    <div className="group/owlvision flex items-center gap-2">
                      {minTickets && (
                        <Badge 
                          variant="outline" 
                          className="bg-orange-500/20 border-orange-500 text-orange-400 hover:bg-orange-500/30 text-xs"
                        >
                          Min Draw: {minTickets}
                        </Badge>
                      )}
                      <OwlVisionBadge score={owlVisionScore} />
                    </div>
                  </div>
                  <CardDescription className={`${classes.description} text-white/90`}>
                    {raffle.description}
                  </CardDescription>
                </div>
              </div>
              {/* Always visible overlay at bottom for key info */}
              <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 via-black/70 to-transparent p-3 z-10 pointer-events-none">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex-1 min-w-0">
                    <div className={`${classes.content} font-semibold text-white flex items-center gap-1.5 truncate`}>
                      {raffle.ticket_price} {raffle.currency}
                      <CurrencyIcon currency={raffle.currency as 'SOL' | 'USDC'} size={16} className="inline-block flex-shrink-0" />
                    </div>
                    <div className={`${classes.footer} text-white/80`}>
                      {totalTicketsSold} entries
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1 transition-opacity duration-200 group-hover/owlvision:opacity-30" style={{ zIndex: 1 }}>
                    <Badge 
                      variant={isFuture ? 'default' : (isActive ? 'default' : 'secondary')} 
                      className={`${classes.badge} ${isFuture ? 'bg-red-500 hover:bg-red-600 text-white' : ''}`}
                    >
                      {isFuture ? 'Future' : (isActive ? 'Active' : 'Ended')}
                    </Badge>
                  </div>
                </div>
                {!isActive && raffle.winner_wallet && (
                  <div className={`${classes.footer} text-white/90 flex items-center gap-1.5 mt-1 pt-1 border-t border-white/20`}>
                    <Trophy className={`${displaySize === 'large' ? 'h-3.5 w-3.5' : 'h-3 w-3'} text-yellow-400 flex-shrink-0`} />
                    <span className="truncate">
                      Winner: <span className="font-mono font-semibold">
                        {raffle.winner_wallet.slice(0, 6)}...{raffle.winner_wallet.slice(-4)}
                      </span>
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}
          {/* Fallback if image error or no image */}
          {(imageError || !raffle.image_url) && (
            <>
              <CardHeader className="p-4 z-10 relative">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className={`${classes.title} line-clamp-2`}>{raffle.title}</CardTitle>
                  <div className="group/owlvision flex items-center gap-2">
                    {minTickets && (
                      <Badge 
                        variant="outline" 
                        className="bg-orange-500/20 border-orange-500 text-orange-400 hover:bg-orange-500/30 text-xs"
                      >
                        Min Draw: {minTickets}
                      </Badge>
                    )}
                    <OwlVisionBadge score={owlVisionScore} />
                  </div>
                </div>
                <CardDescription className={classes.description}>
                  {raffle.description}
                </CardDescription>
              </CardHeader>
              <CardContent className="p-4 pt-0">
                <div className={classes.content}>
                  {raffle.prize_amount != null && raffle.prize_amount > 0 && raffle.prize_currency && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Prize</span>
                      <span className="font-semibold">
                        {raffle.prize_amount} {raffle.prize_currency}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Ticket Price</span>
                    <span className="font-semibold flex items-center gap-1.5">
                      {raffle.ticket_price} {raffle.currency}
                      <CurrencyIcon currency={raffle.currency as 'SOL' | 'USDC'} size={16} className="inline-block" />
                    </span>
                  </div>
                  {totalTicketsSold > 0 && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Entries</span>
                      <span className="font-semibold">
                        {totalTicketsSold} confirmed
                      </span>
                    </div>
                  )}
                </div>
              </CardContent>
              <CardFooter className={`flex flex-col ${classes.footer} p-4`}>
                <div className={`w-full flex items-center justify-between ${displaySize === 'large' ? 'text-sm' : 'text-xs'} text-muted-foreground`}>
                  <span>
                    {isFuture ? (
                      <span title={formatDateTimeWithTimezone(raffle.start_time)}>
                        Starts {formatDistanceToNow(new Date(raffle.start_time), { addSuffix: true })}
                      </span>
                    ) : isActive ? (
                      <span title={formatDateTimeWithTimezone(raffle.end_time)}>
                        Ends {formatDistanceToNow(new Date(raffle.end_time), { addSuffix: true })}
                      </span>
                    ) : (
                      <span title={formatDateTimeWithTimezone(raffle.end_time)}>Ended</span>
                    )}
                  </span>
                  <div className="flex items-center gap-2 transition-opacity duration-200 group-hover/owlvision:opacity-30" style={{ zIndex: 1 }}>
                    <Badge 
                      variant={isFuture ? 'default' : (isActive ? 'default' : 'secondary')}
                      className={isFuture ? 'bg-red-500 hover:bg-red-600 text-white' : ''}
                    >
                      {isFuture ? 'Future' : (isActive ? 'Active' : 'Ended')}
                    </Badge>
                  </div>
                </div>
                {!isActive && !isFuture && raffle.winner_wallet && (
                  <div className={`w-full mt-2 pt-2 border-t flex items-center gap-2 ${displaySize === 'large' ? 'text-sm' : 'text-xs'}`}>
                    <Trophy className={`${displaySize === 'large' ? 'h-4 w-4' : 'h-3 w-3'} text-yellow-500 flex-shrink-0`} />
                    <span className="text-muted-foreground">
                      Winner: <span className="font-mono font-semibold text-foreground">
                        {raffle.winner_wallet.slice(0, 6)}...{raffle.winner_wallet.slice(-4)}
                      </span>
                    </span>
                  </div>
                )}
                {!showQuickBuy && (
                  <Button 
                    type="button"
                    className="w-full touch-manipulation min-h-[44px] text-base sm:text-sm" 
                    size={displaySize === 'large' ? 'lg' : 'default'}
                    onClick={handleToggleQuickBuy}
                    disabled={!isActive || isFuture || (availableTickets !== null && availableTickets <= 0)}
                  >
                    {isFuture ? 'Starts Soon' : (isActive ? (availableTickets !== null && availableTickets <= 0 ? 'Sold Out' : 'Enter Raffle') : 'View Details')}
                  </Button>
                )}
                {showQuickBuy && isActive && !isFuture && (
            <div className="w-full space-y-3 pt-2">
              {raffle.max_tickets && availableTickets !== null && availableTickets > 0 && (
                <div className="p-2 rounded-lg bg-muted border">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Tickets Available</span>
                    <span className="font-semibold">
                      {availableTickets} / {raffle.max_tickets}
                    </span>
                  </div>
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="card-quantity" className={displaySize === 'large' ? 'text-sm' : 'text-xs'}>Number of Tickets</Label>
                <Input
                  id="card-quantity"
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
              {displaySize === 'large' && (
                <HootBoostMeter quantity={ticketQuantity} />
              )}
              <div className="flex items-center justify-between pt-2 border-t">
                <span className={`${displaySize === 'large' ? 'text-sm' : 'text-xs'} text-muted-foreground`}>Total Cost</span>
                <div className={`${displaySize === 'large' ? 'text-xl' : 'text-lg'} font-bold flex items-center gap-2`}>
                  {purchaseAmount.toFixed(6)} {raffle.currency}
                  <CurrencyIcon currency={raffle.currency as 'SOL' | 'USDC'} size={displaySize === 'large' ? 20 : 16} className="inline-block" />
                </div>
              </div>
              {error && (
                <div className="p-2 rounded-lg bg-destructive/10 border border-destructive text-destructive text-xs">
                  {error}
                </div>
              )}
              {success && (
                <div className="p-2 rounded-lg bg-green-500/10 border border-green-500 text-green-500 text-xs">
                  Tickets purchased successfully!
                </div>
              )}
              <div className="flex flex-col sm:flex-row gap-3 sm:gap-2">
                <Button
                  variant="outline"
                  onClick={handleToggleQuickBuy}
                  disabled={isProcessing}
                  className="flex-1 touch-manipulation min-h-[44px] text-base sm:text-sm"
                >
                  Cancel
                </Button>
                <Button
                  onClick={handlePurchase}
                  disabled={availableTickets !== null && availableTickets <= 0 || !connected || isProcessing}
                  className="flex-1 touch-manipulation min-h-[44px] text-base sm:text-sm"
                  style={{
                    backgroundColor: themeColor,
                    color: '#000',
                  }}
                >
                  {!connected ? 'Connect Wallet' : isProcessing ? 'Processing...' : 'Buy Tickets'}
                </Button>
              </div>
            </div>
          )}
              </CardFooter>
            </>
          )}
        </Card>
      </Link>
    {isAdmin && (
      <>
        <div className="absolute top-2 right-2 z-10 flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9 w-9 sm:h-8 sm:w-8 p-0 bg-background touch-manipulation min-h-[36px] min-w-[36px] sm:min-h-[32px] sm:min-w-[32px]"
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              router.push(`/admin/raffles/${raffle.id}`)
            }}
          >
            <Edit className="h-4 w-4" />
          </Button>
          {isActive && (
            <Button
              type="button"
              variant="destructive"
              size="sm"
              className="h-9 w-9 sm:h-8 sm:w-8 p-0 touch-manipulation min-h-[36px] min-w-[36px] sm:min-h-[32px] sm:min-w-[32px]"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                setDeleteDialogOpen(true)
              }}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
        <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete Raffle</DialogTitle>
              <DialogDescription>
                Are you sure you want to delete "{raffle.title}"? This action cannot be undone and will also delete all associated entries.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="flex-col sm:flex-row gap-3 sm:gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setDeleteDialogOpen(false)}
                disabled={deleting}
                className="w-full sm:w-auto touch-manipulation min-h-[44px] text-base sm:text-sm"
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  handleDelete(e)
                }}
                disabled={deleting}
                className="w-full sm:w-auto touch-manipulation min-h-[44px] text-base sm:text-sm"
              >
                {deleting ? 'Deleting...' : 'Delete Raffle'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <Dialog open={imageModalOpen} onOpenChange={setImageModalOpen}>
          <DialogContent className="max-w-5xl w-full p-0">
            {raffle.image_url && !imageError && (
              <div className="relative w-full h-[80vh] min-h-[500px]">
                <Image
                  src={raffle.image_url}
                  alt={raffle.title}
                  fill
                  sizes="100vw"
                  className="object-contain"
                  priority={priority}
                  onError={() => setImageError(true)}
                  unoptimized={raffle.image_url.startsWith('http://')}
                />
              </div>
            )}
            {imageError && (
              <div className="w-full h-[80vh] min-h-[500px] flex items-center justify-center bg-muted border rounded">
                <span className="text-muted-foreground">Image unavailable</span>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </>
    )}
    </div>
  )
}
