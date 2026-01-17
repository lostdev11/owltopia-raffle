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
import { getThemeAccentBorderStyle, getThemeAccentClasses, getThemeAccentColor } from '@/lib/theme-accent'
import { formatDistanceToNow } from 'date-fns'
import { formatDateTimeWithTimezone, formatDateTimeLocal } from '@/lib/utils'
import Image from 'next/image'
import { Users, Trophy, ArrowLeft, Edit } from 'lucide-react'
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
  const [showParticipants, setShowParticipants] = useState(false)
  const [showWinner, setShowWinner] = useState(false)
  const [showEnterRaffleDialog, setShowEnterRaffleDialog] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null)
  // Make isActive reactive to time passing - critical for mobile connections
  const [isActive, setIsActive] = useState(() => {
    const endTime = new Date(raffle.end_time)
    const now = new Date()
    return endTime > now && raffle.is_active
  })

  // Update isActive when time passes (e.g., raffle ends while page is open)
  useEffect(() => {
    const endTime = new Date(raffle.end_time).getTime()
    const now = Date.now()
    const shouldBeActive = endTime > now && raffle.is_active
    
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
  }, [raffle.end_time, raffle.is_active])
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
  const currentOwlVisionScore = calculateOwlVisionScore(raffle, entries)

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
  const totalTicketsSold = entries
    .filter(e => e.status === 'confirmed')
    .reduce((sum, entry) => sum + entry.ticket_quantity, 0)

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
      const createResponse = await fetch('/api/entries/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          raffleId: raffle.id,
          walletAddress: publicKey.toBase58(),
          ticketQuantity,
        }),
      })

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
              const recentResult = await connection.getRecentBlockhash('confirmed')
              latestBlockhash = {
                blockhash: recentResult.blockhash,
                lastValidBlockHeight: 0, // getRecentBlockhash doesn't provide lastValidBlockHeight
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
          
          // Check for retryable errors: 403 (rate limit), 19 (temporary internal error), 500, network issues
          if (errorMessage.includes('403') || 
              errorMessage.includes('Access forbidden') ||
              errorCode === 19 ||
              errorMessage.includes('Temporary internal error') ||
              errorMessage.includes('500') ||
              errorStr.includes('"code":19') ||
              errorMessage.includes('Network') ||
              errorMessage.includes('timeout')) {
            if (retries === 0) {
              if (errorMessage.includes('403') || errorMessage.includes('Access forbidden')) {
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
            // Exponential backoff: wait longer for each retry
            await new Promise(resolve => setTimeout(resolve, 1000 * (3 - retries)))
          } else {
            // Non-retryable error, throw immediately
            throw rpcError
          }
        }
      }
      
      if (!latestBlockhash) {
        throw new Error('Failed to get recent blockhash after retries')
      }

      // Construct transaction with proper blockhash for Phantom compatibility
      const transaction = new Transaction()
      transaction.recentBlockhash = latestBlockhash.blockhash
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
            
            // Check if it's a retryable error (code 19 = temporary internal error, or network issues)
            if (errorCode === 19 || 
                errorMessage.includes('Temporary internal error') ||
                errorMessage.includes('500') ||
                errorMessage.includes('Network') ||
                errorMessage.includes('timeout')) {
              if (mintRetries === 0) {
                throw new Error(
                  'Failed to fetch USDC mint information after retries. This may be a temporary RPC issue. ' +
                  'Please try again in a moment. If the issue persists, ensure you have set NEXT_PUBLIC_SOLANA_RPC_URL ' +
                  'to a private RPC endpoint (Helius, QuickNode, or Alchemy).'
                )
              }
              // Exponential backoff: wait longer for each retry
              await new Promise(resolve => setTimeout(resolve, 1000 * (3 - mintRetries)))
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
            
            // Token account doesn't exist (expected case)
            if (errorMessage.includes('TokenAccountNotFoundError') || 
                errorMessage.includes('could not find account')) {
              accountExists = false
              break
            }
            
            // Retryable RPC error
            if (errorCode === 19 || 
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
              await new Promise(resolve => setTimeout(resolve, 1000 * (3 - accountRetries)))
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

      // Validate transaction before sending
      if (transaction.instructions.length === 0) {
        throw new Error('Transaction has no instructions. Please try again.')
      }

      // Step 3: Send transaction for signing
      // Use sendOptions to ensure proper transaction handling
      let signature: string
      try {
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
        
        if (errorCode === 4001 || errorMessage.includes('User rejected') || errorMessage.includes('rejected')) {
          throw new Error('Transaction was cancelled. Please try again if you want to continue.')
        }
        if (errorMessage.includes('insufficient funds') || errorMessage.includes('Insufficient')) {
          throw new Error('Insufficient funds in your wallet. Please ensure you have enough SOL/USDC to cover the transaction and fees.')
        }
        if (errorMessage.includes('Something went wrong') || errorMessage.includes('wallet')) {
          throw new Error('Wallet extension error. Please try: 1) Refreshing the page, 2) Reconnecting your wallet, 3) Ensuring your wallet extension is up to date.')
        }
        if (errorMessage.includes('Network') || errorMessage.includes('connection')) {
          throw new Error('Network error. Please check your internet connection and try again.')
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
    const numValue = parseInt(value) || 1
    const clampedValue = Math.max(1, Math.min(numValue, maxPurchaseQuantity))
    setTicketQuantity(clampedValue)
  }

  const handleOpenEnterRaffleDialog = () => {
    // Reset state when opening dialog
    setTicketQuantity(1)
    setError(null)
    setSuccess(false)
    setShowEnterRaffleDialog(true)
  }

  return (
    <div className="container mx-auto py-8 px-4">
      <div className="max-w-4xl mx-auto space-y-6">
        <Button
          variant="outline"
          onClick={() => router.push('/raffles')}
          className="mb-4"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Listings
        </Button>
        <Card className={getThemeAccentClasses(raffle.theme_accent)} style={borderStyle}>
          <CardHeader>
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <CardTitle className="text-3xl mb-2">{raffle.title}</CardTitle>
                <CardDescription className="text-base">
                  {raffle.description}
                </CardDescription>
              </div>
              <OwlVisionBadge score={currentOwlVisionScore} />
            </div>
          </CardHeader>

          {raffle.image_url && (
            <div className="!relative w-full h-96 overflow-hidden">
              <Image
                src={raffle.image_url}
                alt={raffle.title}
                fill
                sizes="(max-width: 768px) 100vw, (max-width: 1200px) 80vw, 1200px"
                priority
                className="object-cover"
              />
            </div>
          )}

          <CardContent className="pt-6 space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {raffle.prize_amount && raffle.prize_currency && (
                <div>
                  <p className="text-sm text-muted-foreground">Prize</p>
                  <p className="text-xl font-bold">
                    {raffle.prize_amount} {raffle.prize_currency}
                  </p>
                </div>
              )}
              {raffle.ticket_price > 0 && (
                <div>
                  <p className="text-sm text-muted-foreground">Ticket Price</p>
                  <div className="text-xl font-bold flex items-center gap-2">
                    {raffle.ticket_price.toFixed(6).replace(/\.?0+$/, '') || '0'} {raffle.currency}
                    <CurrencyIcon currency={raffle.currency as 'SOL' | 'USDC'} size={20} className="inline-block" />
                  </div>
                </div>
              )}
              <div>
                <p className="text-sm text-muted-foreground">Confirmed Entries</p>
                <p className="text-xl font-bold">{currentOwlVisionScore.confirmedEntries}</p>
              </div>
              {raffle.max_tickets !== null && (
                <div>
                  <p className="text-sm text-muted-foreground">Available Tickets</p>
                  <p className="text-xl font-bold">
                    {availableTickets !== null ? availableTickets : raffle.max_tickets}
                  </p>
                </div>
              )}
              <div>
                <p className="text-sm text-muted-foreground">Status</p>
                <div className="space-y-1">
                  <Badge variant={isActive ? 'default' : 'secondary'}>
                    {isActive
                      ? `Ends ${formatDistanceToNow(new Date(raffle.end_time), { addSuffix: true })}`
                      : 'Ended'}
                  </Badge>
                  <p className="text-xs text-muted-foreground">
                    {isActive ? (
                      <>Ends: {formatDateTimeWithTimezone(raffle.end_time)}</>
                    ) : (
                      <>Ended: {formatDateTimeWithTimezone(raffle.end_time)}</>
                    )}
                  </p>
                </div>
              </div>
            </div>

            {connected && (
              <div className="p-4 rounded-lg bg-muted/50 border border-primary/20">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">Your Tickets</p>
                    <p className="text-2xl font-bold" style={{ color: themeColor }}>
                      {userTickets} {userTickets === 1 ? 'ticket' : 'tickets'}
                    </p>
                  </div>
                  {userTickets > 0 && (
                    <Badge variant="default" className="text-lg px-4 py-2">
                      {userTickets}
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  💡 Don't see your entry? Try refreshing the page.
                </p>
              </div>
            )}

            {isActive && (
              <div className="flex justify-center">
                <Button
                  onClick={handleOpenEnterRaffleDialog}
                  disabled={availableTickets !== null && availableTickets <= 0}
                  size="lg"
                  style={{
                    backgroundColor: themeColor,
                    color: '#000',
                  }}
                  className="w-full md:w-auto px-8"
                >
                  {availableTickets !== null && availableTickets <= 0
                    ? 'Sold Out'
                    : 'Enter Raffle'}
                </Button>
              </div>
            )}

            <div className="flex gap-4">
              <Button
                variant="outline"
                onClick={() => setShowParticipants(true)}
                className="flex-1"
              >
                <Users className="mr-2 h-4 w-4" />
                View Participants ({currentOwlVisionScore.uniqueWallets})
              </Button>
              {raffle.winner_wallet && (
                <Button 
                  variant="outline" 
                  className="flex-1"
                  onClick={() => setShowWinner(true)}
                >
                  <Trophy className="mr-2 h-4 w-4" />
                  View Winner
                </Button>
              )}
              {isAdmin && (
                <Button
                  variant="outline"
                  onClick={() => router.push(`/admin/raffles/${raffle.id}`)}
                  className="flex-1"
                >
                  <Edit className="mr-2 h-4 w-4" />
                  Edit Raffle
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
        />
      )}

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
                value={ticketQuantity}
                onChange={(e) => handleQuantityChange(e.target.value)}
                disabled={availableTickets !== null && availableTickets <= 0}
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
                {(raffle.ticket_price * ticketQuantity).toFixed(6)} {raffle.currency}
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

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowEnterRaffleDialog(false)}
              disabled={isProcessing}
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
