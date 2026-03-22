'use client'

import { useState, useEffect, useRef, useCallback, useId } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { useWallet, useConnection } from '@solana/wallet-adapter-react'
import Link from 'next/link'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { OwlVisionBadge } from '@/components/OwlVisionBadge'
import { HootBoostMeter } from '@/components/HootBoostMeter'
import { CurrencyIcon } from '@/components/CurrencyIcon'
import type { Raffle, Entry } from '@/lib/types'
import type { RaffleProfitInfo } from '@/lib/raffle-profit'
import { calculateOwlVisionScore } from '@/lib/owl-vision'
import { isRaffleEligibleToDraw, calculateTicketsSold, getRaffleMinimum } from '@/lib/db/raffles'
import {
  getThemeAccentClasses,
  getThemeAccentColor,
  getThemeAccentSurfaceStyle,
  raffleStateSurfaceStyle,
} from '@/lib/theme-accent'
import { getCachedAdmin, setCachedAdmin } from '@/lib/admin-check-cache'
import { isOwlEnabled } from '@/lib/tokens'
import { LinkifiedText, LinkifiedTextInsideLinkProvider } from '@/components/LinkifiedText'
import { formatDistance, formatDistanceToNow } from 'date-fns'
import { formatDateTimeWithTimezone, formatDateTimeLocal } from '@/lib/utils'
import { Trophy, Share2, BadgeCheck } from 'lucide-react'
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
import { fireGreenConfetti, preloadConfetti } from '@/lib/confetti'

/** Live countdown for swipe-deck cards (ms until target). */
function formatDeckCountdown(msRemaining: number): string {
  if (!Number.isFinite(msRemaining) || msRemaining <= 0) return '0:00'
  const totalSec = Math.floor(msRemaining / 1000)
  const days = Math.floor(totalSec / 86400)
  const h = Math.floor((totalSec % 86400) / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  if (days > 0) return `${days}d ${h}h ${m}m`
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

type CardSize = 'small' | 'medium' | 'large'
type SectionType = 'active' | 'future' | 'past'

interface RaffleCardProps {
  raffle: Raffle
  entries: Entry[]
  size?: CardSize
  /** List section: used for border styling so server and client match (avoids hydration) */
  section?: SectionType
  /** When set (e.g. admin list), show profitable vs not and revenue vs threshold */
  profitInfo?: RaffleProfitInfo
  onDeleted?: (raffleId: string) => void
  priority?: boolean
  /** Server time for consistent "Starts in X" / "Starts X ago" (avoids wrong PC clock) */
  serverNow?: Date
  /**
   * When true with size="small", use a portrait split card (image half / content half) for swipe decks.
   * List view should omit this so the horizontal row layout is unchanged.
   */
  deckPresentation?: boolean
  /** When true with deckPresentation, span full grid column (multi-card carousel). */
  deckFillWidth?: boolean
  /** Swipe deck: highlight ring/shadow on the card so it hugs the rounded border (not the padded wrapper). */
  deckIsFocused?: boolean
}

export function RaffleCard({
  raffle,
  entries,
  size = 'medium',
  section,
  profitInfo,
  onDeleted,
  priority = false,
  serverNow,
  deckPresentation = false,
  deckFillWidth = false,
  deckIsFocused = false,
}: RaffleCardProps) {
  const router = useRouter()
  const pathname = usePathname()
  const deckQuantityInputId = useId()
  const listRowQuantityInputId = useId()
  const [deckLiveNowMs, setDeckLiveNowMs] = useState(() =>
    typeof window !== 'undefined' ? Date.now() : 0
  )
  /** Intrinsic size for deck hero — container matches aspect so full art shows with no letterboxing. */
  const [deckImageDims, setDeckImageDims] = useState<{ w: number; h: number } | null>(null)
  const { publicKey, sendTransaction, connected } = useWallet()
  const { connection } = useConnection()
  const wallet = publicKey?.toBase58() ?? ''
  const [mounted, setMounted] = useState(false)
  const [now, setNow] = useState<Date | null>(null)
  const [isAdmin, setIsAdmin] = useState(() =>
    typeof window !== 'undefined' && wallet ? (getCachedAdmin(wallet) ?? false) : false
  )
  const [imageModalOpen, setImageModalOpen] = useState(false)
  const [showQuickBuy, setShowQuickBuy] = useState(false)
  /** Deck card: step before checkout — pick 3 / 5 / 10 tickets */
  const [showDeckPackPicker, setShowDeckPackPicker] = useState(false)
  const [ticketQuantity, setTicketQuantity] = useState(1)
  const [ticketQuantityDisplay, setTicketQuantityDisplay] = useState('1')
  const [isProcessing, setIsProcessing] = useState(false)
  
  // Calculate purchase amount automatically based on ticket price and quantity
  const purchaseAmount = raffle.ticket_price * ticketQuantity
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [imageError, setImageError] = useState(false)
  const [winnerDisplayName, setWinnerDisplayName] = useState<string | null>(null)
  // Mobile: distinguish scroll from tap so scrolling doesn't open the raffle
  const touchStartRef = useRef({ x: 0, y: 0 })
  const scrollDetectedRef = useRef(false)
  const TOUCH_MOVE_THRESHOLD = 12

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (scrollDetectedRef.current) {
      e.preventDefault()
    }
  }

  const handleLinkClick = (e: React.MouseEvent, extraPrevent?: boolean) => {
    if (scrollDetectedRef.current) {
      e.preventDefault()
      e.stopPropagation()
      return
    }
    const target = e.target as HTMLElement
    if (target.closest('button') || target.closest('input') || target.closest('label')) {
      e.preventDefault()
    }
    if (extraPrevent) e.preventDefault()
  }
  
  useEffect(() => {
    setMounted(true)
    setNow(new Date())
  }, [])

  const owlVisionScore = calculateOwlVisionScore(raffle, entries)
  const startTime = new Date(raffle.start_time)
  const endTime = new Date(raffle.end_time)
  const refNow = serverNow ?? now
  // Use section when provided (list view) so server/client match; otherwise use server time or now after mount
  const isFuture = section !== undefined
    ? section === 'future'
    : refNow !== null && startTime > refNow
  const isActive = section !== undefined
    ? section === 'active'
    : refNow !== null && endTime > refNow && raffle.is_active && !(refNow !== null && startTime > refNow)
  const isPendingDraft = raffle.status === 'draft' && raffle.prize_type === 'nft' && !raffle.prize_deposited_at && !raffle.is_active
  const purchasesBlocked = !!(raffle as { purchases_blocked_at?: string | null }).purchases_blocked_at
  const isWinner = mounted && !isActive && !!raffle.winner_wallet && publicKey?.toBase58() === raffle.winner_wallet
  const userHasEntered = mounted && !!wallet && entries.some(e => e.wallet_address === wallet && e.status === 'confirmed')
  
  // Use red for future, blue for past, theme accent for active (section-based when available = no hydration mismatch)
  const borderStyle = isPendingDraft
    ? raffleStateSurfaceStyle('pending')
    : isFuture
      ? raffleStateSurfaceStyle('future')
      : !isActive
        ? raffleStateSurfaceStyle('past')
        : getThemeAccentSurfaceStyle(raffle.theme_accent)
  const themeColor = isPendingDraft ? '#f59e0b' : (isFuture ? '#ef4444' : (!isActive ? '#3b82f6' : getThemeAccentColor(raffle.theme_accent)))
  const statusLabel = isPendingDraft ? 'Pending' : (isFuture ? 'Future' : (isActive ? 'Active' : 'Ended'))
  const statusBadgeClass = isPendingDraft
    ? 'bg-amber-500 hover:bg-amber-600 text-white'
    : (isFuture ? 'bg-red-500 hover:bg-red-600 text-white' : (isActive ? 'bg-green-500 hover:bg-green-600 text-white' : 'bg-blue-500 hover:bg-blue-600 text-white'))
  
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

  // Owl holder verification: show on card when creator is Owltopia (Owl NFT) holder
  const showHolderBadge = isOwlEnabled() && raffle.creator_is_holder === true

  // Fetch display name for the raffle winner so we can show it instead of a bare wallet address
  useEffect(() => {
    if (!raffle.winner_wallet || isActive || isFuture) {
      setWinnerDisplayName(null)
      return
    }
    const walletAddr = raffle.winner_wallet
    fetch(`/api/profiles?wallets=${encodeURIComponent(walletAddr)}`)
      .then((res) => (res.ok ? res.json() : {}))
      .then((map: Record<string, string>) => {
        const name = map?.[walletAddr]
        setWinnerDisplayName(typeof name === 'string' && name.trim() ? name.trim() : null)
      })
      .catch(() => {
        setWinnerDisplayName(null)
      })
  }, [raffle.winner_wallet, isActive, isFuture])

  useEffect(() => {
    if (size !== 'small' || !deckPresentation) return
    if (!isActive && !isFuture) return
    const tick = () => setDeckLiveNowMs(Date.now())
    tick()
    const id = window.setInterval(tick, 1000)
    return () => window.clearInterval(id)
  }, [size, deckPresentation, isActive, isFuture])

  useEffect(() => {
    setDeckImageDims(null)
  }, [raffle.id, raffle.image_url])

  useEffect(() => {
    if (!connected || !publicKey) {
      setIsAdmin(false)
      return
    }
    const addr = publicKey.toBase58()
    const cached = getCachedAdmin(addr)
    if (cached !== null) {
      setIsAdmin(cached)
      return
    }
    let cancelled = false
    fetch(`/api/admin/check?wallet=${addr}`)
      .then((res) => (cancelled ? undefined : res.ok ? res.json() : undefined))
      .then((data) => {
        if (cancelled) return
        const admin = data?.isAdmin === true
        setCachedAdmin(addr, admin)
        setIsAdmin(admin)
      })
      .catch(() => {
        if (!cancelled) setIsAdmin(false)
      })
    return () => { cancelled = true }
  }, [connected, publicKey])

  const handlePurchase = async () => {
    if (!connected || !publicKey) {
      setError('Please connect your wallet first')
      return
    }

    // OWL: block checkout with friendly message if mint not configured
    if (raffle.currency === 'OWL' && !isOwlEnabled()) {
      setError('OWL entry is not enabled yet — mint address pending.')
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

      const { entryId, paymentDetails } = await createResponse.json()
      if (!entryId) throw new Error('Invalid create response')

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
      
      const payments: { recipient: string; amount: number }[] =
        paymentDetails.split?.length === 2
          ? paymentDetails.split
          : [{ recipient: paymentDetails.recipient, amount: paymentDetails.amount }]

      if (raffle.currency === 'SOL') {
        for (const p of payments) {
          transaction.add(
            SystemProgram.transfer({
              fromPubkey: publicKey,
              toPubkey: new PublicKey(p.recipient),
              lamports: Math.round(p.amount * LAMPORTS_PER_SOL),
            })
          )
        }
      } else if (raffle.currency === 'OWL' && !paymentDetails.owlMint) {
        throw new Error('OWL entry is not enabled yet — mint address pending.')
      } else if (raffle.currency === 'USDC') {
        const usdcMint = new PublicKey(paymentDetails.usdcMint)
        const mintInfo = await getMint(connection, usdcMint)
        const decimals = mintInfo.decimals
        const senderTokenAddress = await getAssociatedTokenAddress(usdcMint, publicKey)
        for (const p of payments) {
          const recipientPubkey = new PublicKey(p.recipient)
          const amount = BigInt(Math.round(p.amount * Math.pow(10, decimals)))
          const recipientTokenAddress = await getAssociatedTokenAddress(usdcMint, recipientPubkey)
          let accountExists = false
          try {
            await getAccount(connection, recipientTokenAddress)
            accountExists = true
          } catch (error: any) {
            if (!error?.message?.includes('TokenAccountNotFoundError') && !error?.message?.includes('could not find account')) throw error
          }
          if (!accountExists) {
            transaction.add(createAssociatedTokenAccountInstruction(publicKey, recipientTokenAddress, recipientPubkey, usdcMint))
          }
          transaction.add(createTransferInstruction(senderTokenAddress, recipientTokenAddress, publicKey, amount, []))
        }
      } else if (raffle.currency === 'OWL') {
        // OWL (SPL Token) transfer
        if (!paymentDetails.owlMint) {
          throw new Error('OWL mint address not configured in payment details')
        }
        const owlMint = new PublicKey(paymentDetails.owlMint)
        
        // Get mint info with retry logic for RPC errors
        let mintInfo
        let mintRetries = 3
        while (mintRetries > 0) {
          try {
            mintInfo = await getMint(connection, owlMint)
            break
          } catch (rpcError: any) {
            mintRetries--
            const errorMessage = rpcError?.message || ''
            const errorCode = rpcError?.code || rpcError?.error?.code
            const errorName = rpcError?.name || ''
            
            const isFetchError = 
              errorMessage.includes('failed to fetch') ||
              errorMessage.includes('Failed to fetch') ||
              errorMessage.includes('NetworkError') ||
              errorMessage.includes('Network request failed') ||
              errorName === 'TypeError' ||
              (errorName === 'TypeError' && errorMessage.includes('fetch')) ||
              errorMessage.includes('CORS') ||
              errorMessage.includes('network')
            
            if (isFetchError ||
                errorCode === 19 || 
                errorMessage.includes('Temporary internal error') ||
                errorMessage.includes('500') ||
                errorMessage.includes('Network') ||
                errorMessage.includes('timeout')) {
              if (mintRetries === 0) {
                if (isFetchError) {
                  throw new Error(
                    'Network connection failed while fetching OWL mint information. This may be a network issue or CORS restriction on mobile. ' +
                    'Please check your internet connection and try again. ' +
                    'If the issue persists, ensure you have set NEXT_PUBLIC_SOLANA_RPC_URL ' +
                    'to a private RPC endpoint (Helius, QuickNode, or Alchemy) that supports mobile access.'
                  )
                } else {
                  throw new Error(
                    'Failed to fetch OWL mint information after retries. This may be a temporary RPC issue. ' +
                    'Please try again in a moment. If the issue persists, ensure you have set NEXT_PUBLIC_SOLANA_RPC_URL ' +
                    'to a private RPC endpoint (Helius, QuickNode, or Alchemy).'
                  )
                }
              }
              const backoffDelay = isFetchError ? 2000 * (3 - mintRetries) : 1000 * (3 - mintRetries)
              await new Promise(resolve => setTimeout(resolve, backoffDelay))
            } else {
              throw rpcError
            }
          }
        }
        
        if (!mintInfo) {
          throw new Error('Failed to get OWL mint information')
        }
        
        const decimals = mintInfo.decimals
        const senderTokenAddress = await getAssociatedTokenAddress(owlMint, publicKey)
        for (const p of payments) {
          const recipientPubkey = new PublicKey(p.recipient)
          const amount = BigInt(Math.round(p.amount * Math.pow(10, decimals)))
          const recipientTokenAddress = await getAssociatedTokenAddress(owlMint, recipientPubkey)
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
              if (errorMessage.includes('TokenAccountNotFoundError') || errorMessage.includes('could not find account')) {
                accountExists = false
                break
              }
              const isFetchError = errorMessage.includes('failed to fetch') || errorMessage.includes('Failed to fetch') || errorName === 'TypeError' || errorMessage.includes('network')
              if (isFetchError || errorCode === 19 || errorMessage.includes('Temporary internal error') || errorMessage.includes('500') || errorMessage.includes('timeout')) {
                accountRetries--
                if (accountRetries === 0) { accountExists = false; break }
                await new Promise(resolve => setTimeout(resolve, isFetchError ? 2000 * (3 - accountRetries) : 1000 * (3 - accountRetries)))
              } else { accountExists = false; break }
            }
          }
          if (!accountExists) {
            transaction.add(createAssociatedTokenAccountInstruction(publicKey, recipientTokenAddress, recipientPubkey, owlMint))
          }
          transaction.add(createTransferInstruction(senderTokenAddress, recipientTokenAddress, publicKey, amount, []))
        }
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
        // Solflare-specific: give clearer guidance
        if (errorMessage.toLowerCase().includes('solflare')) {
          throw new Error('Solflare wallet error. Please try: 1) Refreshing the page and reconnecting Solflare, 2) Updating the Solflare extension to the latest version, 3) Using Solflare in a different browser if the issue persists.')
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

      // Celebrate as soon as the transaction is confirmed (before verify) so OWL and others get confetti even if server verification is delayed or fails
      setSuccess(true)
      requestAnimationFrame(() => fireGreenConfetti())

      // Step 5: Verify entry
      const verifyResponse = await fetch('/api/entries/verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          entryId,
          transactionSignature: signature,
        }),
      })

      if (!verifyResponse.ok) {
        const errorData = await verifyResponse.json()
        
        // Handle temporary verification failures (202 Accepted)
        if (verifyResponse.status === 202) {
          // Transaction signature saved, verification will retry automatically (confetti already fired on tx confirm)
          setSuccess(true)
          setError(null)
          console.log('Verification pending:', errorData.message || errorData.details)
          
          // Refresh to pick up the entry with saved signature
          router.refresh()
          
          setTimeout(() => {
            setShowQuickBuy(false)
            setSuccess(false)
            setTicketQuantity(1)
            setTicketQuantityDisplay('1')
          }, 2000)
          return // Exit early - verification will complete in background
        }
        
        // Permanent failure
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
    const closing = showQuickBuy
    if (!showQuickBuy) {
      preloadConfetti()
      setTicketQuantity(1)
      setTicketQuantityDisplay('1')
      setError(null)
      setSuccess(false)
    }
    setShowQuickBuy(!showQuickBuy)
    if (closing) setShowDeckPackPicker(false)
  }

  useEffect(() => {
    setShowDeckPackPicker(false)
  }, [raffle.id])

  const handleDeckEnterRaffleClick = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      preloadConfetti()
      setError(null)
      setSuccess(false)
      // Always show 3 / 5 / 10 first when any tickets can be bought (options disable if not enough left).
      if (maxPurchaseQuantity >= 1) {
        setShowDeckPackPicker(true)
      } else {
        setTicketQuantity(1)
        setTicketQuantityDisplay('1')
        setShowQuickBuy(true)
      }
    },
    [maxPurchaseQuantity]
  )

  const handleDeckPickPack = useCallback(
    (n: 3 | 5 | 10, e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const q = Math.max(1, Math.min(n, maxPurchaseQuantity))
      setTicketQuantity(q)
      setTicketQuantityDisplay(String(q))
      setShowDeckPackPicker(false)
      setShowQuickBuy(true)
    },
    [maxPurchaseQuantity]
  )

  const handleDeckOtherAmountClick = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setTicketQuantity(1)
    setTicketQuantityDisplay('1')
    setShowDeckPackPicker(false)
    setShowQuickBuy(true)
  }, [])

  const handleDeckCancelPackPicker = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setShowDeckPackPicker(false)
  }, [])

  const handleShareRaffle = useCallback(async () => {
    if (typeof window === 'undefined') return
    const url = `${window.location.origin}/raffles/${raffle.slug}`
    const shareData = {
      title: raffle.title,
      text: `Check out this raffle: ${raffle.title}`,
      url,
    }

    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share(shareData)
        return
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return
      }
    }

    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(url)
        return
      } catch {
        // Last resort below when clipboard permissions are denied.
      }
    }

    window.prompt('Copy raffle link:', url)
  }, [raffle.slug, raffle.title])

  // Small size — list row (horizontal) or swipe deck (portrait split)
  if (size === 'small') {
    const deck = deckPresentation === true

    const handleDeckCardClick = (e: React.MouseEvent<HTMLElement>) => {
      const el = e.target
      if (!(el instanceof HTMLElement)) return
      if (el.closest('[data-deck-stop-nav]')) return
      if (el.closest('button, a, input, textarea, select, label')) return
      if (scrollDetectedRef.current) return
      router.push(`/raffles/${raffle.slug}`)
    }

    const linkTouchHandlers = {
      onTouchStart: (e: React.TouchEvent) => {
        touchStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
        scrollDetectedRef.current = false
      },
      onTouchMove: (e: React.TouchEvent) => {
        const { x, y } = touchStartRef.current
        if (Math.hypot(e.touches[0].clientX - x, e.touches[0].clientY - y) > TOUCH_MOVE_THRESHOLD) {
          scrollDetectedRef.current = true
        }
      },
      onTouchEnd: handleTouchEnd,
      onClick: (e: React.MouseEvent) => handleLinkClick(e),
    }

    const detailsColumn = (
      <div className="flex flex-col flex-1 min-w-0 z-10 relative p-1.5 sm:p-2.5 overflow-hidden">
        <div className="flex items-start justify-between gap-2 mb-0.5 sm:mb-1 min-w-0">
          <CardTitle className="raffle-card-title !text-[0.875rem] sm:!text-sm !leading-tight line-clamp-2 flex-1 min-w-0 overflow-hidden text-foreground">
            {raffle.title}
          </CardTitle>
          <div className="flex items-center gap-1 sm:gap-1.5 group/owlvision flex-shrink-0">
            {showHolderBadge && (
              <span
                className="inline-flex items-center justify-center rounded-full bg-emerald-500/15 border border-emerald-500/50 text-emerald-400 p-0.5"
                title="Hosted by an Owltopia (Owl NFT) holder — 3% platform fee on tickets"
                role="img"
                aria-label="Owl holder"
              >
                <BadgeCheck className="h-3 w-3 flex-shrink-0" />
              </span>
            )}
            <OwlVisionBadge score={owlVisionScore} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 sm:gap-4 text-[11px] sm:text-xs mb-0.5 sm:mb-1 mt-0">
          {raffle.prize_amount != null && raffle.prize_amount > 0 && raffle.prize_currency && (
            <span>
              <span className="text-muted-foreground">Prize: </span>
              <span className="font-semibold">
                {raffle.prize_amount} {raffle.prize_currency}
              </span>
            </span>
          )}
          <span className="flex items-center gap-1.5">
            <span className="text-muted-foreground">Price: </span>
            <span className="font-semibold flex items-center gap-1.5">
              {raffle.ticket_price} {raffle.currency}
              <CurrencyIcon
                currency={raffle.currency as 'SOL' | 'USDC' | 'OWL'}
                size={14}
                className="inline-block"
              />
            </span>
          </span>
          {totalTicketsSold > 0 && (
            <span>
              <span className="text-muted-foreground">Entries: </span>
              <span className="font-semibold">{totalTicketsSold}</span>
            </span>
          )}
        </div>
        {raffle.description && (
          <p
            className="text-[11px] sm:text-xs text-muted-foreground line-clamp-2 mb-1 sm:mb-1.5 mt-0 break-words min-w-0"
            title={raffle.description}
          >
            <LinkifiedText text={raffle.description} />
          </p>
        )}
        {isActive &&
          !isFuture &&
          !purchasesBlocked &&
          (availableTickets === null || availableTickets > 0) && (
            <div
              className={`mb-1.5 min-w-0 shrink-0 space-y-1.5 ${showQuickBuy ? 'max-h-[min(55dvh,420px)] overflow-y-auto overscroll-y-contain pr-0.5' : ''}`}
              data-deck-stop-nav
              onClick={(e) => e.stopPropagation()}
            >
              {!showQuickBuy ? (
                showDeckPackPicker ? (
                  <div className="space-y-1.5">
                    <p className="text-center text-[10px] font-medium text-muted-foreground">
                      Quick buy — pick ticket pack
                    </p>
                    <div className="grid grid-cols-3 gap-1">
                      {([3, 5, 10] as const).map((n) => {
                        const disabled =
                          n > maxPurchaseQuantity ||
                          !isActive ||
                          isFuture ||
                          purchasesBlocked ||
                          (availableTickets !== null && availableTickets <= 0)
                        return (
                          <Button
                            key={n}
                            type="button"
                            className="flex h-auto min-h-[44px] touch-manipulation flex-col gap-0.5 py-1.5 text-foreground"
                            disabled={disabled}
                            onClick={(e) => handleDeckPickPack(n, e)}
                            style={
                              !disabled
                                ? {
                                    backgroundColor: themeColor,
                                    color: '#000',
                                  }
                                : undefined
                            }
                          >
                            <span className="text-xs font-bold tabular-nums">{n}</span>
                            <span className="max-w-full truncate px-0.5 text-[8px] font-normal leading-tight opacity-90">
                              {(raffle.ticket_price * n).toFixed(4)} {raffle.currency}
                            </span>
                          </Button>
                        )
                      })}
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-10 min-h-[44px] w-full touch-manipulation text-xs"
                      onClick={handleDeckCancelPackPicker}
                    >
                      Cancel
                    </Button>
                    <button
                      type="button"
                      className="w-full min-h-[40px] touch-manipulation text-center text-[10px] text-muted-foreground underline underline-offset-2"
                      onClick={(e) => handleDeckOtherAmountClick(e)}
                    >
                      Other amount
                    </button>
                  </div>
                ) : (
                  <div className="flex w-full justify-center">
                    <Button
                      type="button"
                      className={`h-10 min-h-[44px] w-full max-w-[13.5rem] touch-manipulation text-xs sm:text-sm sm:max-w-[15rem] ${purchasesBlocked ? 'bg-muted text-muted-foreground cursor-not-allowed opacity-70' : ''}`}
                      onClick={handleDeckEnterRaffleClick}
                    >
                      {purchasesBlocked
                        ? 'Purchases Blocked'
                        : availableTickets !== null && availableTickets <= 0
                          ? 'Sold Out'
                          : 'Quick buy'}
                    </Button>
                  </div>
                )
              ) : (
                <div className="space-y-2 border-t border-border/60 pt-2">
                  {raffle.max_tickets && availableTickets !== null && availableTickets > 0 && (
                    <div className="rounded-md border bg-muted/50 p-1.5">
                      <div className="flex items-center justify-between text-[10px]">
                        <span className="text-muted-foreground">Tickets available</span>
                        <span className="font-semibold">
                          {availableTickets} / {raffle.max_tickets}
                        </span>
                      </div>
                    </div>
                  )}
                  <div className="space-y-1">
                    <Label htmlFor={listRowQuantityInputId} className="text-[10px]">
                      Number of tickets
                    </Label>
                    <Input
                      id={listRowQuantityInputId}
                      type="number"
                      min={1}
                      max={maxPurchaseQuantity}
                      value={ticketQuantityDisplay}
                      onChange={(e) => handleQuantityChange(e.target.value)}
                      onBlur={handleQuantityBlur}
                      disabled={availableTickets !== null && availableTickets <= 0}
                      className="h-10 text-base"
                    />
                  </div>
                  <HootBoostMeter quantity={ticketQuantity} />
                  <div className="flex items-center justify-between border-t border-border/60 pt-1.5">
                    <span className="text-[10px] text-muted-foreground">Total</span>
                    <span className="text-sm font-bold tabular-nums flex items-center gap-1.5">
                      {purchaseAmount.toFixed(6)} {raffle.currency}
                      <CurrencyIcon
                        currency={raffle.currency as 'SOL' | 'USDC' | 'OWL'}
                        size={14}
                        className="inline-block"
                      />
                    </span>
                  </div>
                  {error && (
                    <div className="rounded-md border border-destructive bg-destructive/10 p-1.5 text-[10px] text-destructive">
                      {error}
                    </div>
                  )}
                  {success && (
                    <div className="rounded-md border border-green-500 bg-green-500/10 p-1.5 text-[10px] text-green-600 dark:text-green-400">
                      Tickets purchased successfully!
                    </div>
                  )}
                  <div className="flex flex-col gap-1.5">
                    <Button
                      variant="outline"
                      type="button"
                      className="h-10 min-h-[44px] w-full touch-manipulation text-xs"
                      onClick={(e) => handleToggleQuickBuy(e)}
                      disabled={isProcessing}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      className="h-10 min-h-[44px] w-full touch-manipulation text-xs"
                      onClick={(e) => {
                        e.stopPropagation()
                        void handlePurchase()
                      }}
                      disabled={
                        (availableTickets !== null && availableTickets <= 0) || !connected || isProcessing
                      }
                      style={{
                        backgroundColor: themeColor,
                        color: '#000',
                      }}
                    >
                      {!connected ? 'Connect wallet' : isProcessing ? 'Processing…' : 'Buy tickets'}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        <div className="flex flex-wrap items-center justify-between mt-auto gap-x-2 gap-y-1.5">
          <span className="text-[11px] sm:text-xs text-muted-foreground flex-1 min-w-0 truncate basis-0 sm:basis-auto">
            {isFuture ? (
              <span title={formatDateTimeWithTimezone(raffle.start_time)}>
                {serverNow && new Date(raffle.start_time) <= serverNow
                  ? `Started ${serverNow ? formatDistance(new Date(raffle.start_time), serverNow, { addSuffix: true }) : formatDistanceToNow(new Date(raffle.start_time), { addSuffix: true })}`
                  : `Starts ${formatDateTimeLocal(raffle.start_time)}`}
              </span>
            ) : isActive ? (
              <span title={formatDateTimeWithTimezone(raffle.end_time)}>
                {serverNow && new Date(raffle.end_time) <= serverNow
                  ? `Ended ${formatDistance(new Date(raffle.end_time), serverNow, { addSuffix: true })}`
                  : `Ends ${formatDateTimeLocal(raffle.end_time)}`}
              </span>
            ) : isPendingDraft ? (
              <span>Pending escrow deposit</span>
            ) : (
              <span title={formatDateTimeWithTimezone(raffle.end_time)}>
                Ended {formatDateTimeLocal(raffle.end_time)}
              </span>
            )}
          </span>
          {section !== 'active' && (
            <div
              className="flex flex-wrap items-center gap-1 sm:gap-1.5 transition-opacity duration-200 group-hover/owlvision:opacity-30 flex-shrink-0 min-h-[28px] sm:min-h-[22px] touch-manipulation"
              style={{ zIndex: 1 }}
            >
              <Badge
                variant={(isFuture || isActive || isPendingDraft) ? 'default' : 'secondary'}
                className={`rounded-full text-[10px] sm:text-xs min-h-[28px] sm:min-h-[22px] inline-flex items-center px-1.5 py-0.5 ${statusBadgeClass}`}
              >
                {statusLabel}
              </Badge>
            </div>
          )}
        </div>
        {!isActive && !isFuture && raffle.winner_wallet && (
          <div className="mt-1.5 pt-1.5 sm:mt-2 sm:pt-2 border-t border-border/60 flex items-center gap-1.5 min-w-0">
            <Trophy className="h-3 w-3 text-yellow-500 flex-shrink-0" />
            <span className="text-[11px] sm:text-xs text-muted-foreground truncate min-w-0">
              Winner:{' '}
              {winnerDisplayName ? (
                <span className="font-semibold text-foreground">{winnerDisplayName}</span>
              ) : (
                <span className="font-mono font-semibold text-foreground">
                  {raffle.winner_wallet.slice(0, 6)}…{raffle.winner_wallet.slice(-4)}
                </span>
              )}
            </span>
          </div>
        )}
      </div>
    )

    const ticketsProgressPct =
      raffle.max_tickets && raffle.max_tickets > 0
        ? Math.min(100, Math.round((totalTicketsSold / raffle.max_tickets) * 100))
        : null

    const deckTargetMs = isFuture
      ? new Date(raffle.start_time).getTime()
      : new Date(raffle.end_time).getTime()
    const deckRemainingMs =
      isActive || isFuture ? deckTargetMs - deckLiveNowMs : 0

    const deckDetailsColumn = (
      <div className="relative z-10 flex w-full min-h-0 flex-1 flex-col border-t border-border bg-card/95 p-2.5 sm:p-3 max-md:min-h-[min(36dvh,260px)] md:flex-none md:shrink-0">
        <div className="flex items-start justify-between gap-1.5 shrink-0 min-w-0">
          <CardTitle className="raffle-card-title !text-sm sm:!text-base !leading-snug line-clamp-2 flex-1 min-w-0 overflow-hidden text-foreground">
            {raffle.title}
          </CardTitle>
          <div
            className="flex items-center gap-1 sm:gap-1.5 group/owlvision flex-shrink-0"
            data-deck-stop-nav
          >
            {showHolderBadge && (
              <span
                className="inline-flex items-center justify-center rounded-full bg-emerald-500/15 border border-emerald-500/50 text-emerald-400 p-0.5"
                title="Hosted by an Owltopia (Owl NFT) holder — 3% platform fee on tickets"
                role="img"
                aria-label="Owl holder"
              >
                <BadgeCheck className="h-3 w-3 flex-shrink-0" />
              </span>
            )}
            <OwlVisionBadge score={owlVisionScore} />
          </div>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] sm:text-xs shrink-0">
          {raffle.prize_amount != null && raffle.prize_amount > 0 && raffle.prize_currency && (
            <span>
              <span className="text-muted-foreground">Prize: </span>
              <span className="font-semibold">
                {raffle.prize_amount} {raffle.prize_currency}
              </span>
            </span>
          )}
          <span className="flex items-center gap-1.5">
            <span className="text-muted-foreground">Price: </span>
            <span className="font-semibold inline-flex items-center gap-1.5">
              {raffle.ticket_price} {raffle.currency}
              <CurrencyIcon
                currency={raffle.currency as 'SOL' | 'USDC' | 'OWL'}
                size={14}
                className="inline-block"
              />
            </span>
          </span>
          <span>
            <span className="text-muted-foreground">Entries: </span>
            <span className="font-semibold">{totalTicketsSold}</span>
          </span>
        </div>

        {!showQuickBuy ? (
          <>
            <div className="mt-1.5 flex flex-col gap-1.5">
              {ticketsProgressPct !== null && (
                <div className="shrink-0 space-y-1">
                  <div className="flex items-center justify-between text-[10px] sm:text-[11px] text-muted-foreground">
                    <span>Tickets sold</span>
                    <span className="font-medium text-foreground">
                      {totalTicketsSold} / {raffle.max_tickets}
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full transition-all duration-300"
                      style={{
                        width: `${ticketsProgressPct}%`,
                        backgroundColor: themeColor,
                      }}
                    />
                  </div>
                </div>
              )}
              <div className="max-h-28 min-h-0 shrink-0 overflow-y-auto overscroll-y-contain pr-0.5 text-xs leading-snug text-muted-foreground sm:max-h-32">
                {raffle.description ? (
                  <LinkifiedText text={raffle.description} />
                ) : (
                  <p className="italic text-muted-foreground/90">
                    {isActive && !isFuture
                      ? 'Tap Enter raffle to buy tickets or open the full page for details.'
                      : 'Open the raffle page for full details and rules.'}
                  </p>
                )}
              </div>
              {(isActive || isFuture) && (
                <div className="flex shrink-0 flex-col items-center gap-0.5 overflow-visible rounded-md border border-border/80 bg-muted/35 px-2 py-2 sm:px-2.5 sm:py-2">
                  <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground leading-normal sm:text-[10px]">
                    {isFuture ? 'Starts in' : 'Ends in'}
                  </span>
                  {deckRemainingMs <= 0 ? (
                    <span className="text-sm font-semibold tabular-nums text-foreground leading-snug sm:text-base">
                      {isFuture ? 'Started' : 'Ended'}
                    </span>
                  ) : (
                    <span
                      className="block py-0.5 text-center text-lg font-bold tabular-nums leading-snug tracking-tight sm:text-xl"
                      style={{ color: themeColor }}
                      aria-live="polite"
                    >
                      {formatDeckCountdown(deckRemainingMs)}
                    </span>
                  )}
                </div>
              )}
            </div>
            {showDeckPackPicker ? (
              <div
                className="mt-1.5 shrink-0 space-y-2"
                data-deck-stop-nav
              >
                <p className="text-center text-[11px] font-medium text-muted-foreground">
                  Quick buy — pick ticket pack
                </p>
                <div className="grid grid-cols-3 gap-1.5 sm:gap-2">
                  {([3, 5, 10] as const).map((n) => {
                    const disabled =
                      n > maxPurchaseQuantity ||
                      !isActive ||
                      isFuture ||
                      purchasesBlocked ||
                      (availableTickets !== null && availableTickets <= 0)
                    return (
                      <Button
                        key={n}
                        type="button"
                        className="flex h-auto min-h-[44px] touch-manipulation flex-col gap-0.5 py-2 text-foreground"
                        disabled={disabled}
                        onClick={(e) => handleDeckPickPack(n, e)}
                        style={
                          !disabled
                            ? {
                                backgroundColor: themeColor,
                                color: '#000',
                              }
                            : undefined
                        }
                      >
                        <span className="text-sm font-bold tabular-nums">{n}</span>
                        <span className="max-w-full truncate px-0.5 text-[9px] font-normal leading-tight opacity-90">
                          {(raffle.ticket_price * n).toFixed(6)} {raffle.currency}
                        </span>
                      </Button>
                    )
                  })}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 min-h-[44px] w-full touch-manipulation text-sm"
                  onClick={handleDeckCancelPackPicker}
                >
                  Cancel
                </Button>
                <button
                  type="button"
                  className="w-full min-h-[40px] touch-manipulation text-center text-[11px] text-muted-foreground underline underline-offset-2"
                  onClick={(e) => handleDeckOtherAmountClick(e)}
                >
                  Other amount
                </button>
              </div>
            ) : (
              <div className="mt-1.5 shrink-0 space-y-1.5">
                <Button
                  type="button"
                  className={`h-11 min-h-[44px] w-full touch-manipulation text-sm sm:text-sm ${purchasesBlocked ? 'bg-muted text-muted-foreground cursor-not-allowed opacity-70' : ''}`}
                  onClick={(e) => {
                    if (isFuture || !isActive) {
                      e.stopPropagation()
                      if (!isActive && !isFuture) router.push(`/raffles/${raffle.slug}`)
                      return
                    }
                    if (purchasesBlocked || (availableTickets !== null && availableTickets <= 0)) {
                      e.stopPropagation()
                      return
                    }
                    handleDeckEnterRaffleClick(e)
                  }}
                  disabled={
                    !isActive ||
                    isFuture ||
                    purchasesBlocked ||
                    (availableTickets !== null && availableTickets <= 0)
                  }
                >
                  {isFuture
                    ? 'Starts Soon'
                    : isActive
                      ? purchasesBlocked
                        ? 'Purchases Blocked'
                        : availableTickets !== null && availableTickets <= 0
                          ? 'Sold Out'
                          : 'Enter raffle'
                      : 'View raffle'}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 min-h-[44px] w-full touch-manipulation text-xs sm:text-sm"
                  onClick={async (e) => {
                    e.stopPropagation()
                    await handleShareRaffle()
                  }}
                  title="Share this raffle or copy the raffle link."
                >
                  <Share2 className="mr-1.5 h-3.5 w-3.5 sm:mr-2 sm:h-4 sm:w-4" />
                  Share
                </Button>
              </div>
            )}
          </>
        ) : (
          <div
            className="mt-2 flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-y-contain"
            data-deck-stop-nav
          >
            {isActive && !isFuture && !purchasesBlocked && (
              <div className="space-y-3 pb-2">
                {raffle.max_tickets && availableTickets !== null && availableTickets > 0 && (
                  <div className="rounded-lg border bg-muted/50 p-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Tickets available</span>
                      <span className="font-semibold">
                        {availableTickets} / {raffle.max_tickets}
                      </span>
                    </div>
                  </div>
                )}
                <div className="space-y-2">
                  <Label htmlFor={deckQuantityInputId} className="text-xs">
                    Number of tickets
                  </Label>
                  <Input
                    id={deckQuantityInputId}
                    type="number"
                    min={1}
                    max={maxPurchaseQuantity}
                    value={ticketQuantityDisplay}
                    onChange={(e) => handleQuantityChange(e.target.value)}
                    onBlur={handleQuantityBlur}
                    disabled={availableTickets !== null && availableTickets <= 0}
                    className="h-11 text-base sm:text-sm"
                  />
                  {raffle.max_tickets && availableTickets !== null && availableTickets > 0 && (
                    <p className="text-xs text-muted-foreground">
                      Maximum {availableTickets} ticket{availableTickets !== 1 ? 's' : ''} available
                    </p>
                  )}
                </div>
                <HootBoostMeter quantity={ticketQuantity} />
                <div className="flex items-center justify-between border-t pt-2">
                  <span className="text-xs text-muted-foreground">Total cost</span>
                  <span className="text-lg font-bold tabular-nums flex items-center gap-2">
                    {purchaseAmount.toFixed(6)} {raffle.currency}
                    <CurrencyIcon
                      currency={raffle.currency as 'SOL' | 'USDC' | 'OWL'}
                      size={18}
                      className="inline-block"
                    />
                  </span>
                </div>
                {error && (
                  <div className="rounded-lg border border-destructive bg-destructive/10 p-2 text-xs text-destructive">
                    {error}
                  </div>
                )}
                {success && (
                  <div className="rounded-lg border border-green-500 bg-green-500/10 p-2 text-xs text-green-600 dark:text-green-400">
                    Tickets purchased successfully!
                  </div>
                )}
                <div className="flex flex-col gap-2">
                  <Button
                    variant="outline"
                    type="button"
                    className="h-11 w-full touch-manipulation"
                    onClick={(e) => {
                      e.stopPropagation()
                      handleToggleQuickBuy(e)
                    }}
                    disabled={isProcessing}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    className="h-11 min-h-[44px] w-full touch-manipulation text-sm"
                    onClick={(e) => {
                      e.stopPropagation()
                      void handlePurchase()
                    }}
                    disabled={
                      (availableTickets !== null && availableTickets <= 0) || !connected || isProcessing
                    }
                    style={{
                      backgroundColor: themeColor,
                      color: '#000',
                    }}
                  >
                    {!connected ? 'Connect wallet' : isProcessing ? 'Processing…' : 'Buy tickets'}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="mt-2 flex shrink-0 flex-wrap items-end justify-between gap-2 border-t border-border/60 pt-1.5">
          <span className="text-[11px] sm:text-xs text-muted-foreground min-w-0 leading-snug">
            {isFuture ? (
              <span title={formatDateTimeWithTimezone(raffle.start_time)}>
                {serverNow && new Date(raffle.start_time) <= serverNow
                  ? `Started ${serverNow ? formatDistance(new Date(raffle.start_time), serverNow, { addSuffix: true }) : formatDistanceToNow(new Date(raffle.start_time), { addSuffix: true })}`
                  : `Starts ${formatDateTimeLocal(raffle.start_time)}`}
              </span>
            ) : isActive ? (
              <span title={formatDateTimeWithTimezone(raffle.end_time)}>
                {serverNow && new Date(raffle.end_time) <= serverNow
                  ? `Ended ${formatDistance(new Date(raffle.end_time), serverNow, { addSuffix: true })}`
                  : `Ends ${formatDateTimeLocal(raffle.end_time)}`}
              </span>
            ) : isPendingDraft ? (
              <span>Pending escrow deposit</span>
            ) : (
              <span title={formatDateTimeWithTimezone(raffle.end_time)}>
                Ended {formatDateTimeLocal(raffle.end_time)}
              </span>
            )}
          </span>
          {section !== 'active' && (
            <Badge
              variant={(isFuture || isActive || isPendingDraft) ? 'default' : 'secondary'}
                  className={`shrink-0 rounded-full text-[9px] sm:text-[10px] min-h-[26px] inline-flex items-center px-1.5 py-0.5 sm:min-h-[28px] sm:px-2 ${statusBadgeClass}`}
            >
              {statusLabel}
            </Badge>
          )}
        </div>
        {!isActive && !isFuture && raffle.winner_wallet && (
          <div className="mt-2 flex shrink-0 items-center gap-1.5 border-t border-border/60 pt-2">
            <Trophy className="h-3.5 w-3.5 text-yellow-500 flex-shrink-0" />
            <span className="truncate text-xs text-muted-foreground min-w-0">
              Winner:{' '}
              {winnerDisplayName ? (
                <span className="font-semibold text-foreground">{winnerDisplayName}</span>
              ) : (
                <span className="font-mono font-semibold text-foreground">
                  {raffle.winner_wallet.slice(0, 6)}…{raffle.winner_wallet.slice(-4)}
                </span>
              )}
            </span>
          </div>
        )}
      </div>
    )

    const overlays = (
      <>
        {isWinner && (
          <div className="winner-golden-overlay absolute inset-0 rounded-[1.25rem] pointer-events-none z-0" />
        )}
        {userHasEntered && !isWinner && (
          <div className="raffle-entered-overlay absolute inset-0 rounded-[1.25rem] z-0" />
        )}
        <div
          className={`raffle-card-accent-blob z-0 ${deck ? '-top-16 -right-16' : '-top-8 -right-8'}`}
          style={{ background: themeColor }}
          aria-hidden
        />
      </>
    )

    const accentStrip = (
      <div
        className="raffle-card-accent-strip flex-shrink-0"
        style={{ color: themeColor }}
        aria-hidden
      />
    )

    const adminBlock =
      isAdmin && (
        <>
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
      )

    if (deck) {
      return (
        <div
          className={
            deckFillWidth
              ? 'relative z-10 w-full max-w-none pb-1 md:hover:z-50'
              : 'relative z-10 mx-auto w-full max-w-[min(100%,19rem)] sm:max-w-[20.5rem] md:max-w-[22rem] pb-1 md:hover:z-50'
          }
        >
          <LinkifiedTextInsideLinkProvider>
            <Card
              role="link"
              tabIndex={0}
              aria-label={`Open raffle: ${raffle.title}`}
              className={`raffle-card-modern relative ${getThemeAccentClasses(
                raffle.theme_accent,
                'flex flex-col p-0 overflow-hidden rounded-[1.25rem] border-2 shadow-md shadow-black/12 sm:shadow-md sm:shadow-black/15 md:hover:scale-[1.01] touch-manipulation cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                isWinner ? { withHalo: false } : undefined
              )} max-md:max-h-[min(92dvh,920px)] max-md:overflow-y-auto max-md:overscroll-y-contain md:max-h-none md:overflow-visible transition-[box-shadow,transform] duration-200 ${deckIsFocused ? 'z-10 shadow-md' : ''} ${isWinner ? 'ring-4 ring-yellow-400 ring-offset-2 winner-golden-card' : ''} ${userHasEntered && !isWinner ? 'raffle-entered-card' : ''}`}
              style={
                isWinner
                  ? { ...borderStyle, borderColor: '#facc15' }
                  : deckIsFocused && !isWinner
                    ? {
                        ...borderStyle,
                        boxShadow: '0 0 0 2px hsl(var(--primary) / 0.35)',
                      }
                    : borderStyle
              }
              {...linkTouchHandlers}
              onClick={handleDeckCardClick}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' && e.key !== ' ') return
                e.preventDefault()
                if (scrollDetectedRef.current) return
                router.push(`/raffles/${raffle.slug}`)
              }}
            >
              {overlays}
              {raffle.image_url && !imageError ? (
                <div
                  className={`relative w-full shrink-0 overflow-hidden bg-muted ${!deckImageDims ? 'min-h-[148px]' : ''}`}
                  style={{
                    aspectRatio:
                      deckImageDims && deckImageDims.h > 0
                        ? deckImageDims.w / deckImageDims.h
                        : 1,
                  }}
                >
                  <div
                    className={`absolute inset-0 ${isAdmin ? 'cursor-pointer' : ''}`}
                    title={isAdmin ? 'Open full image' : undefined}
                    {...(isAdmin
                      ? {
                          'data-deck-stop-nav': true as const,
                          onClick: (e: React.MouseEvent) => {
                            e.stopPropagation()
                            setImageModalOpen(true)
                          },
                        }
                      : {})}
                  >
                    <Image
                      src={raffle.image_url}
                      alt={raffle.title}
                      fill
                      sizes="(max-width: 768px) 85vw, 360px"
                      className="h-full w-full object-contain object-center"
                      priority={priority}
                      onLoadingComplete={(img) => {
                        if (img.naturalWidth > 0 && img.naturalHeight > 0) {
                          setDeckImageDims({
                            w: img.naturalWidth,
                            h: img.naturalHeight,
                          })
                        }
                      }}
                      onError={() => {
                        setImageError(true)
                        setDeckImageDims(null)
                      }}
                      unoptimized={raffle.image_url.startsWith('http://')}
                    />
                  </div>
                </div>
              ) : (
                <div className="relative flex min-h-[140px] w-full shrink-0 items-center justify-center overflow-hidden bg-muted">
                  <span className="px-4 text-center text-sm text-muted-foreground">
                    {imageError ? 'Image unavailable' : 'No image'}
                  </span>
                </div>
              )}
              {deckDetailsColumn}
              {accentStrip}
            </Card>
          </LinkifiedTextInsideLinkProvider>
          {adminBlock}
        </div>
      )
    }

    return (
      <div className="relative z-10 md:hover:z-50">
        <Link href={`/raffles/${raffle.slug}`} {...linkTouchHandlers}>
          <LinkifiedTextInsideLinkProvider>
            <Card
              className={`raffle-card-modern relative ${getThemeAccentClasses(raffle.theme_accent, 'hover:scale-[1.02] cursor-pointer flex flex-col p-0 overflow-hidden', isWinner ? { withHalo: false } : undefined)} ${isWinner ? 'ring-4 ring-yellow-400 ring-offset-2 winner-golden-card' : ''} ${userHasEntered && !isWinner ? 'raffle-entered-card' : ''}`}
              style={isWinner ? { ...borderStyle, borderColor: '#facc15' } : borderStyle}
            >
              <div className="flex flex-row items-stretch flex-1 min-h-0">
                {overlays}
                {raffle.image_url && !imageError && (
                  <div
                    className="!relative w-24 min-w-[96px] sm:w-40 md:w-48 aspect-square flex-shrink-0 overflow-hidden cursor-pointer z-10 m-0 p-0 rounded-l-[1rem] sm:rounded-l-[1.25rem]"
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
                      sizes="(max-width: 640px) 96px, (max-width: 768px) 160px, 192px"
                      className="object-cover !w-full !h-full"
                      priority={priority}
                      onError={() => setImageError(true)}
                      unoptimized={raffle.image_url.startsWith('http://')}
                    />
                  </div>
                )}
                {imageError && (
                  <div className="w-24 min-w-[96px] sm:w-40 md:w-48 h-full flex-shrink-0 flex items-center justify-center bg-muted border rounded-l-[1rem] sm:rounded-l-[1.25rem] z-10 relative">
                    <span className="text-[10px] sm:text-xs text-muted-foreground text-center px-1.5">
                      Image unavailable
                    </span>
                  </div>
                )}
                {detailsColumn}
              </div>
              {accentStrip}
            </Card>
          </LinkifiedTextInsideLinkProvider>
        </Link>
        {adminBlock}
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
        onTouchStart={(e) => {
          touchStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
          scrollDetectedRef.current = false
        }}
        onTouchMove={(e) => {
          const { x, y } = touchStartRef.current
          if (Math.hypot(e.touches[0].clientX - x, e.touches[0].clientY - y) > TOUCH_MOVE_THRESHOLD) {
            scrollDetectedRef.current = true
          }
        }}
        onTouchEnd={handleTouchEnd}
        onClick={(e) => handleLinkClick(e, isFuture)}
      >
        <LinkifiedTextInsideLinkProvider>
        <Card
          className={`raffle-card-modern relative ${getThemeAccentClasses(raffle.theme_accent, 'h-full flex flex-col hover:scale-[1.02] cursor-pointer p-0 overflow-hidden', isWinner ? { withHalo: false } : undefined)} ${isWinner ? 'ring-4 ring-yellow-400 ring-offset-2 winner-golden-card' : ''} ${userHasEntered && !isWinner ? 'raffle-entered-card' : ''}`}
          style={isWinner ? { ...borderStyle, borderColor: '#facc15' } : borderStyle}
        >
          {isWinner && (
            <div className="winner-golden-overlay absolute inset-0 rounded-[1.25rem] pointer-events-none z-0" />
          )}
          {userHasEntered && !isWinner && (
            <div className="raffle-entered-overlay absolute inset-0 rounded-[1.25rem] z-0" />
          )}
          {/* Theme accent blob (modern card flair) */}
          <div
            className="raffle-card-accent-blob -top-12 -right-12 z-0"
            style={{ background: themeColor }}
            aria-hidden
          />
          {raffle.image_url && !imageError && (
            <div className="!relative w-full aspect-square overflow-hidden z-10 rounded-t-[1.25rem] m-0 p-0">
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
                    <div className="flex-1 min-w-0">
                      {raffle.description && (
                        <p className={`${classes.description} text-white/90 line-clamp-3`}>
                          <LinkifiedText text={raffle.description} />
                        </p>
                      )}
                    </div>
                    <div className="group/owlvision flex items-center gap-2 flex-shrink-0">
                      {showHolderBadge && (
                        <span
                          className="inline-flex items-center justify-center rounded-full bg-emerald-500/15 border border-emerald-500/50 text-emerald-400 p-0.5"
                          title="Hosted by an Owltopia (Owl NFT) holder — 3% platform fee on tickets"
                          role="img"
                          aria-label="Owl holder"
                        >
                          <BadgeCheck className="h-3.5 w-3.5 flex-shrink-0" />
                        </span>
                      )}
                      <OwlVisionBadge score={owlVisionScore} />
                    </div>
                  </div>
                </div>
              </div>
              {/* Always visible overlay at bottom for key info */}
              <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 via-black/70 to-transparent p-2 sm:p-3 z-10 pointer-events-none">
                <div className="mb-1 sm:mb-2">
                  <CardTitle className={`raffle-card-title-soft ${classes.title} text-white line-clamp-2 mb-1 !text-sm sm:!text-base md:!text-lg !leading-tight break-words`}>
                    {raffle.title}
                  </CardTitle>
                </div>
                <div className="flex items-center justify-between mb-1">
                  <div className="flex-1 min-w-0">
                    <div className={`${classes.content} font-semibold text-white flex items-center gap-1.5 truncate`}>
                      {raffle.ticket_price} {raffle.currency}
                      <CurrencyIcon currency={raffle.currency as 'SOL' | 'USDC' | 'OWL'} size={16} className="inline-block flex-shrink-0" />
                    </div>
                    <div className={`${classes.footer} text-white/80`}>
                      {totalTicketsSold} entries
                    </div>
                  </div>
                  {section !== 'active' && (
                    <div className="flex flex-col items-end gap-1 transition-opacity duration-200 group-hover/owlvision:opacity-30" style={{ zIndex: 1 }}>
                      <Badge 
                        variant={(isFuture || isActive || isPendingDraft) ? 'default' : 'secondary'} 
                        className={`${classes.badge} ${statusBadgeClass}`}
                      >
                        {statusLabel}
                      </Badge>
                    </div>
                  )}
                </div>
                {!isActive && raffle.winner_wallet && (
                  <div className={`${classes.footer} text-white/90 flex items-center gap-1.5 mt-1 pt-1 border-t border-white/20`}>
                    <Trophy className={`${displaySize === 'large' ? 'h-3.5 w-3.5' : 'h-3 w-3'} text-yellow-400 flex-shrink-0`} />
                    <span className="truncate">
                      Winner:{' '}
                      {winnerDisplayName ? (
                        <span className="font-semibold">{winnerDisplayName}</span>
                      ) : (
                        <span className="font-mono font-semibold">
                          {raffle.winner_wallet.slice(0, 6)}...{raffle.winner_wallet.slice(-4)}
                        </span>
                      )}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}
          {/* Fallback if image error or no image */}
          {(imageError || !raffle.image_url) && (
            <>
              <CardHeader className="p-3 sm:p-4 z-10 relative">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className={`raffle-card-title-soft ${classes.title} line-clamp-2 flex-1 min-w-0 overflow-hidden !text-base sm:!text-lg md:!text-xl break-words`}>
                    {raffle.title}
                  </CardTitle>
                  <div className="group/owlvision flex items-center gap-1 sm:gap-2 flex-shrink-0">
                    {showHolderBadge && (
                      <span
                        className="inline-flex items-center justify-center rounded-full bg-emerald-500/15 border border-emerald-500/50 text-emerald-400 p-0.5"
                        title="Hosted by an Owltopia (Owl NFT) holder — 3% platform fee on tickets"
                        role="img"
                        aria-label="Owl holder"
                      >
                        <BadgeCheck className="h-3 w-3 flex-shrink-0" />
                      </span>
                    )}
                    <OwlVisionBadge score={owlVisionScore} />
                  </div>
                </div>
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
                      <CurrencyIcon currency={raffle.currency as 'SOL' | 'USDC' | 'OWL'} size={16} className="inline-block" />
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
                        {serverNow && new Date(raffle.start_time) <= serverNow
                          ? `Started ${serverNow ? formatDistance(new Date(raffle.start_time), serverNow, { addSuffix: true }) : formatDistanceToNow(new Date(raffle.start_time), { addSuffix: true })}`
                          : `Starts ${formatDateTimeLocal(raffle.start_time)}`}
                      </span>
                    ) : isActive ? (
                      <span title={formatDateTimeWithTimezone(raffle.end_time)}>
                        {serverNow && new Date(raffle.end_time) <= serverNow
                          ? `Ended ${formatDistance(new Date(raffle.end_time), serverNow, { addSuffix: true })}`
                          : `Ends ${formatDateTimeLocal(raffle.end_time)}`}
                      </span>
                    ) : isPendingDraft ? (
                      <span>Pending escrow deposit</span>
                    ) : (
                      <span title={formatDateTimeWithTimezone(raffle.end_time)}>Ended {formatDateTimeLocal(raffle.end_time)}</span>
                    )}
                  </span>
                  {section !== 'active' && (
                    <div className="flex items-center gap-2 transition-opacity duration-200 group-hover/owlvision:opacity-30" style={{ zIndex: 1 }}>
                      <Badge 
                        variant={(isFuture || isActive || isPendingDraft) ? 'default' : 'secondary'}
                        className={statusBadgeClass}
                      >
                        {statusLabel}
                      </Badge>
                    </div>
                  )}
                </div>
                {!isActive && !isFuture && raffle.winner_wallet && (
                  <div className={`w-full mt-2 pt-2 border-t flex items-center gap-2 ${displaySize === 'large' ? 'text-sm' : 'text-xs'}`}>
                    <Trophy className={`${displaySize === 'large' ? 'h-4 w-4' : 'h-3 w-3'} text-yellow-500 flex-shrink-0`} />
                    <span className="text-muted-foreground">
                      Winner:{' '}
                      {winnerDisplayName ? (
                        <span className="font-semibold text-foreground">{winnerDisplayName}</span>
                      ) : (
                        <span className="font-mono font-semibold text-foreground">
                          {raffle.winner_wallet.slice(0, 6)}...{raffle.winner_wallet.slice(-4)}
                        </span>
                      )}
                    </span>
                  </div>
                )}
                {!showQuickBuy && (
                  <>
                    {showDeckPackPicker ? (
                      <div
                        className="w-full space-y-3 pt-2"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <p
                          className={`text-center font-medium text-muted-foreground ${displaySize === 'large' ? 'text-sm' : 'text-xs'}`}
                        >
                          Quick buy — pick ticket pack
                        </p>
                        <div className="grid grid-cols-3 gap-2">
                          {([3, 5, 10] as const).map((n) => {
                            const disabled =
                              n > maxPurchaseQuantity ||
                              !isActive ||
                              isFuture ||
                              purchasesBlocked ||
                              (availableTickets !== null && availableTickets <= 0)
                            return (
                              <Button
                                key={n}
                                type="button"
                                className="flex h-auto min-h-[44px] touch-manipulation flex-col gap-0.5 py-2 text-foreground"
                                disabled={disabled}
                                onClick={(e) => handleDeckPickPack(n, e)}
                                style={
                                  !disabled
                                    ? {
                                        backgroundColor: themeColor,
                                        color: '#000',
                                      }
                                    : undefined
                                }
                              >
                                <span className="text-sm font-bold tabular-nums">{n}</span>
                                <span className="max-w-full truncate px-0.5 text-[9px] font-normal leading-tight opacity-90">
                                  {(raffle.ticket_price * n).toFixed(6)} {raffle.currency}
                                </span>
                              </Button>
                            )
                          })}
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          className="h-11 min-h-[44px] w-full touch-manipulation text-sm"
                          onClick={handleDeckCancelPackPicker}
                        >
                          Cancel
                        </Button>
                        <button
                          type="button"
                          className="w-full min-h-[40px] touch-manipulation text-center text-xs text-muted-foreground underline underline-offset-2"
                          onClick={(e) => handleDeckOtherAmountClick(e)}
                        >
                          Other amount
                        </button>
                      </div>
                    ) : (
                      <>
                        <Button
                          type="button"
                          className={`w-full touch-manipulation min-h-[44px] text-base sm:text-sm ${purchasesBlocked ? 'bg-muted text-muted-foreground cursor-not-allowed opacity-70' : ''}`}
                          size={displaySize === 'large' ? 'lg' : 'default'}
                          onClick={handleDeckEnterRaffleClick}
                          disabled={!isActive || isFuture || purchasesBlocked || (availableTickets !== null && availableTickets <= 0)}
                        >
                          {isFuture ? 'Starts Soon' : (isActive ? (purchasesBlocked ? 'Purchases Blocked' : availableTickets !== null && availableTickets <= 0 ? 'Sold Out' : 'Enter Raffle') : 'View Details')}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size={displaySize === 'large' ? 'default' : 'sm'}
                          className="w-full touch-manipulation min-h-[40px] text-sm"
                          onClick={async (e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            await handleShareRaffle()
                          }}
                          title="Share this raffle or copy the raffle link."
                        >
                          <Share2 className="mr-2 h-4 w-4" />
                          Share
                        </Button>
                      </>
                    )}
                  </>
                )}
                {showQuickBuy && isActive && !isFuture && !purchasesBlocked && (
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
                  <CurrencyIcon currency={raffle.currency as 'SOL' | 'USDC' | 'OWL'} size={displaySize === 'large' ? 20 : 16} className="inline-block" />
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
          {/* Accent strip (theme color) - full width at bottom */}
          <div
            className="raffle-card-accent-strip flex-shrink-0"
            style={{ color: themeColor }}
            aria-hidden
          />
        </Card>
        </LinkifiedTextInsideLinkProvider>
      </Link>
    {isAdmin && (
      <>
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
