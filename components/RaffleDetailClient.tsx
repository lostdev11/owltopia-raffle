'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
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
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import type { Raffle, Entry, OwlVisionScore, PrizeStandard } from '@/lib/types'
import { calculateOwlVisionScore } from '@/lib/owl-vision'
import { isRaffleEligibleToDraw, calculateTicketsSold, getRaffleMinimum } from '@/lib/db/raffles'
import { getRaffleProfitInfo } from '@/lib/raffle-profit'
import { getThemeAccentBorderStyle, getThemeAccentClasses, getThemeAccentColor } from '@/lib/theme-accent'
import { getCachedAdmin, setCachedAdmin } from '@/lib/admin-check-cache'
import { isOwlEnabled } from '@/lib/tokens'
import { formatDistance } from 'date-fns'
import { formatDateTimeWithTimezone, formatDateTimeLocal } from '@/lib/utils'
import { getRaffleDisplayImageUrl } from '@/lib/raffle-display-image-url'
import Image from 'next/image'
import { Users, Trophy, ArrowLeft, Edit, Grid3x3, LayoutGrid, Square, Send, Eye, Share2, BadgeCheck, ExternalLink, XCircle, Loader2 } from 'lucide-react'
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
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from '@solana/spl-token'
import { getNftHolderInWallet } from '@/lib/solana/wallet-tokens'
import { transferMplCoreToEscrow } from '@/lib/solana/mpl-core-transfer'
import { transferCompressedNftToEscrow } from '@/lib/solana/cnft-transfer'
import { transferTokenMetadataNftToEscrow } from '@/lib/solana/token-metadata-transfer'
import { useRealtimeEntries } from '@/lib/hooks/useRealtimeEntries'
import { useServerTime } from '@/lib/hooks/useServerTime'
import { LinkifiedText } from '@/components/LinkifiedText'
import { fireGreenConfetti, preloadConfetti } from '@/lib/confetti'

function solscanTransactionUrl(signature: string): string {
  const cluster = /devnet/i.test(process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? '')
    ? '?cluster=devnet'
    : ''
  return `https://solscan.io/tx/${signature}${cluster}`
}

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
  const walletCtx = useWallet()
  const { publicKey, sendTransaction, connected, wallet, signMessage } = walletCtx
  // Umi walletAdapterIdentity expects the actual WalletAdapter (with publicKey), not the Wallet metadata wrapper
  const walletAdapter = wallet?.adapter ?? null
  const { connection } = useConnection()
  const [ticketQuantity, setTicketQuantity] = useState(1)
  const [depositEscrowLoading, setDepositEscrowLoading] = useState(false)
  const [depositEscrowError, setDepositEscrowError] = useState<string | null>(null)
  const [depositEscrowSuccess, setDepositEscrowSuccess] = useState(false)
  const [showManualEscrowFallback, setShowManualEscrowFallback] = useState(false)
  const [manualDepositTx, setManualDepositTx] = useState('')
  const [depositVerifyLoading, setDepositVerifyLoading] = useState(false)
  const [escrowAddress, setEscrowAddress] = useState<string | null>(null)
  /** Explorer links: prize mint (identity) vs escrow token account (SPL custody), or single URL for Core. */
  const [escrowExplorer, setEscrowExplorer] = useState<{
    prizeMintUrl: string
    custodyUrl: string
  } | null>(null)
  const [showEscrowConfirmDialog, setShowEscrowConfirmDialog] = useState(false)
  const [ticketQuantityDisplay, setTicketQuantityDisplay] = useState('1')
  const [showParticipants, setShowParticipants] = useState(false)
  const [activeTab, setActiveTab] = useState<'overview' | 'owl-vision'>('overview')
  
  // Calculate purchase amount automatically based on ticket price and quantity
  const purchaseAmount = raffle.ticket_price * ticketQuantity
  const [showWinner, setShowWinner] = useState(false)
  const [showEnterRaffleDialog, setShowEnterRaffleDialog] = useState(false)
  const [showNftTransferDialog, setShowNftTransferDialog] = useState(false)
  const [nftTransferSignature, setNftTransferSignature] = useState('')
  const [isSubmittingTransfer, setIsSubmittingTransfer] = useState(false)
  const [transferError, setTransferError] = useState<string | null>(null)
  const [transferSuccess, setTransferSuccess] = useState(false)
  const [showReturnPrizeDialog, setShowReturnPrizeDialog] = useState(false)
  const [returnPrizeReason, setReturnPrizeReason] = useState<string>('cancelled')
  const [returnPrizeLoading, setReturnPrizeLoading] = useState(false)
  const [returnPrizeError, setReturnPrizeError] = useState<string | null>(null)
  const [returnPrizeSuccess, setReturnPrizeSuccess] = useState(false)
  const [claimPrizeLoading, setClaimPrizeLoading] = useState(false)
  const [claimPrizeError, setClaimPrizeError] = useState<string | null>(null)
  /** Full-screen claim flow: loading spinner then success + Solscan link */
  const [claimPrizePhase, setClaimPrizePhase] = useState<'idle' | 'loading' | 'success'>('idle')
  const [claimPrizeTxSignature, setClaimPrizeTxSignature] = useState<string | null>(null)
  const [claimPrizeAlreadyClaimed, setClaimPrizeAlreadyClaimed] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [requestCancelLoading, setRequestCancelLoading] = useState(false)
  const walletAddress = publicKey?.toBase58() ?? ''
  const creatorWallet = (raffle.creator_wallet || raffle.created_by || '').trim()
  const isCreator = connected && walletAddress && creatorWallet === walletAddress
  const [isAdmin, setIsAdmin] = useState<boolean | null>(() =>
    typeof window !== 'undefined' && walletAddress ? getCachedAdmin(walletAddress) : null
  )
  const [creatorDisplayName, setCreatorDisplayName] = useState<string | null>(null)
  const [imageSize, setImageSize] = useState<'small' | 'medium' | 'large'>('medium')
  const [imageError, setImageError] = useState(false)
  const [fallbackImageError, setFallbackImageError] = useState(false)
  const mobileLinkTouchRef = useRef<{ x: number; y: number; moved: boolean } | null>(null)
  const displayImageUrl = getRaffleDisplayImageUrl(raffle.image_url)
  // When proxy fails, try raw URL (decoded from proxy param) as fallback
  const fallbackRawUrl = (() => {
    const url = displayImageUrl ?? raffle.image_url
    if (!url || !url.startsWith('/api/proxy-image')) return null
    try {
      const parsed = new URL(url, typeof window !== 'undefined' ? window.location.origin : 'https://www.owltopia.xyz')
      const raw = parsed.searchParams.get('url')
      if (!raw) return null
      const decoded = decodeURIComponent(raw)
      const u = new URL(decoded)
      if (u.protocol === 'http:' || u.protocol === 'https:') return decoded
    } catch {
      // ignore
    }
    return null
  })()
  const { serverNow: serverTime } = useServerTime()
  const startTimeMs = new Date(raffle.start_time).getTime()
  const endTimeMs = new Date(raffle.end_time).getTime()
  const nowMs = serverTime.getTime()
  const isFuture = startTimeMs > nowMs
  const isActive = startTimeMs <= nowMs && endTimeMs > nowMs && raffle.is_active
  const purchasesBlocked = !!(raffle as { purchases_blocked_at?: string | null }).purchases_blocked_at
  // Pending escrow deposit should be based on escrow verification state, not solely on `raffle.status`,
  // since status can drift (e.g. restore/maintenance) while `is_active` remains false.
  const isPendingDraft =
    raffle.prize_type === 'nft' && !raffle.prize_deposited_at && !raffle.is_active
  // Delay "entered" card styling to avoid flash when wallet/entries resolve on open (mobile)
  const [showEnteredStyle, setShowEnteredStyle] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setShowEnteredStyle(true), 200)
    return () => clearTimeout(t)
  }, [])
  const baseBorderStyle = getThemeAccentBorderStyle(raffle.theme_accent)
  const borderStyle = isPendingDraft
    ? { borderColor: '#f59e0b', boxShadow: '0 0 20px rgba(245, 158, 11, 0.45)' }
    : isFuture
    ? { borderColor: '#ef4444', boxShadow: '0 0 20px rgba(239, 68, 68, 0.5)' }
    : !isActive
      ? { borderColor: '#3b82f6', boxShadow: '0 0 20px rgba(59, 130, 246, 0.5)' }
      : baseBorderStyle
  const themeColor = isPendingDraft ? '#f59e0b' : (isFuture ? '#ef4444' : (!isActive ? '#3b82f6' : getThemeAccentColor(raffle.theme_accent)))
  const isEndingSoon =
    isActive && endTimeMs - nowMs <= 60 * 60 * 1000 && new Date(raffle.end_time) > serverTime
  const statusPillLabel = isPendingDraft ? 'Pending' : (isFuture ? 'Upcoming' : isActive ? (isEndingSoon ? 'Ending soon' : 'Live now') : 'Ended')
  const statusBadgeClass = isPendingDraft
    ? 'bg-amber-500 hover:bg-amber-600 text-white'
    : (isFuture ? 'bg-red-500 hover:bg-red-600 text-white' : (isActive ? 'bg-green-500 hover:bg-green-600 text-white' : 'bg-blue-500 hover:bg-blue-600 text-white'))
  const timeToEndLabel = isFuture
    ? `Starts ${formatDateTimeLocal(raffle.start_time)}`
    : isActive
      ? (new Date(raffle.end_time) <= serverTime
          ? `Ended ${formatDistance(new Date(raffle.end_time), serverTime, { addSuffix: true })}`
          : `Ends in ${formatDistance(new Date(raffle.end_time), serverTime)}`)
      : isPendingDraft
        ? 'Pending escrow deposit'
      : `Ended ${formatDateTimeLocal(raffle.end_time)}`

  const handleMobileLinkTouchStart = (e: React.TouchEvent<HTMLAnchorElement>) => {
    const touch = e.touches[0]
    if (!touch) return
    mobileLinkTouchRef.current = { x: touch.clientX, y: touch.clientY, moved: false }
  }

  const handleMobileLinkTouchMove = (e: React.TouchEvent<HTMLAnchorElement>) => {
    const touch = e.touches[0]
    const start = mobileLinkTouchRef.current
    if (!touch || !start) return
    const movedX = Math.abs(touch.clientX - start.x)
    const movedY = Math.abs(touch.clientY - start.y)
    if (movedX > 8 || movedY > 8) {
      mobileLinkTouchRef.current = { ...start, moved: true }
    }
  }

  const handleMobileLinkTouchEnd = (e: React.TouchEvent<HTMLAnchorElement>) => {
    if (mobileLinkTouchRef.current?.moved) {
      // Prevent accidental open when user stops scrolling on a link.
      e.preventDefault()
      e.stopPropagation()
    }
    mobileLinkTouchRef.current = null
  }

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

  useEffect(() => {
    if (!creatorWallet) {
      setCreatorDisplayName(null)
      return
    }
    fetch(`/api/profiles?wallets=${encodeURIComponent(creatorWallet)}`)
      .then((res) => (res.ok ? res.json() : {}))
      .then((map: Record<string, string>) => {
        const name = map?.[creatorWallet]
        setCreatorDisplayName(typeof name === 'string' && name.trim() ? name.trim() : null)
      })
      .catch(() => {
        setCreatorDisplayName(null)
      })
  }, [creatorWallet])

  // Fetch prize escrow address when NFT raffle needs deposit
  useEffect(() => {
    if (raffle.prize_type !== 'nft' || raffle.prize_deposited_at) return
    let cancelled = false
    fetch('/api/config/prize-escrow')
      .then((r) => (cancelled ? undefined : r.ok ? r.json() : undefined))
      .then((data: { address?: string } | undefined) => {
        if (!cancelled && data?.address) setEscrowAddress(data.address)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [raffle.prize_type, raffle.prize_deposited_at])

  // Fetch block explorer URL to check NFT in escrow (only once prize is deposited)
  useEffect(() => {
    if (
      raffle.prize_type !== 'nft' ||
      !raffle.nft_mint_address ||
      !raffle.prize_deposited_at
    )
      return
    let cancelled = false
    fetch(`/api/raffles/${raffle.id}/escrow-check-url`)
      .then((r) => (cancelled ? undefined : r.ok ? r.json() : undefined))
      .then((data: { url?: string; prizeMintUrl?: string; custodyUrl?: string } | undefined) => {
        if (cancelled || !data?.url || !raffle.nft_mint_address) return
        const mint = raffle.nft_mint_address.trim()
        const cluster = /devnet/i.test(process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? '') ? '?cluster=devnet' : ''
        const fallbackUrl =
          raffle.prize_standard === 'mpl_core' || raffle.prize_standard === 'compressed'
            ? `https://solscan.io/account/${mint}${cluster}`
            : `https://solscan.io/token/${mint}${cluster}`
        const prizeMintUrl = data.prizeMintUrl ?? fallbackUrl
        const custodyUrl = data.custodyUrl ?? data.url
        setEscrowExplorer({ prizeMintUrl, custodyUrl })
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [raffle.id, raffle.prize_type, raffle.nft_mint_address, raffle.prize_deposited_at])

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

  // Pending entries for this wallet that have a tx signature (confirming on-chain)
  const userPendingTickets = connected && publicKey
    ? entries
        .filter(
          e =>
            e.status === 'pending' &&
            e.wallet_address === publicKey.toBase58() &&
            e.transaction_signature
        )
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
                'Network connection failed. Please check your internet connection and try again. ' +
                'On mobile, try switching between WiFi and mobile data.'
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
        // Safe parse for desktop and mobile: proxy/502 often return HTML; avoid JSON parse errors
        let errorMessage = 'Failed to create entry. Please try again.'
        try {
          const contentType = createResponse.headers.get('content-type') || ''
          if (contentType.includes('application/json')) {
            const errorData = await createResponse.json()
            if (typeof errorData?.error === 'string') errorMessage = errorData.error
          }
        } catch {
          // Non-JSON or empty body (common on 502/timeout on any device)
        }
        throw new Error(errorMessage)
      }

      let entryId: string
      let paymentDetails: {
        recipient: string
        amount: number
        currency: string
        usdcMint: string
        owlMint: string | null
        tokenDecimals: number
        split?: { recipient: string; amount: number }[]
      }
      try {
        const data = await createResponse.json()
        entryId = data?.entryId
        paymentDetails = data?.paymentDetails
      } catch {
        throw new Error('Invalid response from server. Please try again.')
      }
      if (!entryId || !paymentDetails) {
        throw new Error('Invalid create response')
      }
      
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
      
      // Split at purchase: two recipients (creator + treasury) or single recipient
      const payments: { recipient: string; amount: number }[] =
        paymentDetails.split?.length === 2
          ? paymentDetails.split
          : [{ recipient: paymentDetails.recipient, amount: paymentDetails.amount }]

      if (raffle.currency === 'SOL') {
        for (const p of payments) {
          const lamports = Math.round(p.amount * LAMPORTS_PER_SOL)
          transaction.add(
            SystemProgram.transfer({
              fromPubkey: publicKey,
              toPubkey: new PublicKey(p.recipient),
              lamports,
            })
          )
        }
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
        const senderTokenAddress = await getAssociatedTokenAddress(usdcMint, publicKey)

        for (const p of payments) {
          const recipientPubkey = new PublicKey(p.recipient)
          const amount = BigInt(Math.round(p.amount * Math.pow(10, decimals)))
          const recipientTokenAddress = await getAssociatedTokenAddress(usdcMint, recipientPubkey)

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
            transaction.add(
              createAssociatedTokenAccountInstruction(publicKey, recipientTokenAddress, recipientPubkey, usdcMint)
            )
          }
          transaction.add(
            createTransferInstruction(senderTokenAddress, recipientTokenAddress, publicKey, amount, [])
          )
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
            transaction.add(
              createAssociatedTokenAccountInstruction(publicKey, recipientTokenAddress, recipientPubkey, owlMint)
            )
          }
          transaction.add(
            createTransferInstruction(senderTokenAddress, recipientTokenAddress, publicKey, amount, [])
          )
        }
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
        // Provide more helpful error messages for wallet errors
        const errorMessage = walletError?.message || walletError?.toString() || 'Unknown error'
        const errorCode = walletError?.code
        const errorName = walletError?.name || ''
        
        // User cancelled in wallet — don't log as error, show friendly message only
        const isUserRejection =
          errorCode === 4001 ||
          errorMessage.includes('User rejected') ||
          errorMessage.includes('rejected the request') ||
          errorMessage.includes('rejected')
        if (isUserRejection) {
          throw new Error('Transaction was cancelled. Please try again if you want to continue.')
        }
        
        console.error('Wallet error details:', walletError)
        
        // Check if this is an Android/mobile device
        const isMobile = typeof window !== 'undefined' && /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(
          navigator.userAgent || navigator.vendor || (window as any).opera || ''
        )
        const isAndroid = typeof window !== 'undefined' && /android/i.test(
          navigator.userAgent || navigator.vendor || (window as any).opera || ''
        )
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
        // Solflare-specific: give clearer guidance (connection/signing issues common with extension)
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

      // At this point the on-chain transaction is confirmed. Hide the entry form
      // and keep only the processing dialog visible while we verify and sync tickets.
      setShowEnterRaffleDialog(false)

      // Celebrate as soon as the transaction is confirmed (before verify) so OWL and others get confetti even if server verification is delayed or fails
      setSuccess(true)
      requestAnimationFrame(() => fireGreenConfetti())

      // Step 5: Verify entry with transaction signature
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

      // Handle "verification pending" responses explicitly (202 Accepted).
      // Note: fetch treats 202 as ok, so we must branch on status before checking response.ok.
      if (verifyResponse.status === 202) {
        let errorData: { error?: string; details?: string; message?: string } = {}
        try {
          const contentType = verifyResponse.headers.get('content-type') || ''
          if (contentType.includes('application/json')) {
            errorData = await verifyResponse.json()
          }
        } catch {
          // Non-JSON or empty body
        }

        // Transaction signature saved; verification will retry automatically (confetti already fired on tx confirm)
        setSuccess(true)
        setError(null)
        console.log('Verification pending:', errorData.message || errorData.details)

        router.refresh()
        await new Promise(resolve => setTimeout(resolve, 1000))
        fetchEntries()

        // Schedule refetches so when backend confirms (RPC delay), "Your Tickets" updates without manual refresh
        const refetchDelays = [2000, 5000, 10000, 20000]
        refetchDelays.forEach((ms) => {
          setTimeout(() => fetchEntries(), ms)
        })

        // Retry verify a few times so server can confirm once RPC has the tx (common on mobile)
        const verifyRetryDelays = [5000, 15000]
        verifyRetryDelays.forEach((ms) => {
          setTimeout(async () => {
            try {
              const retryRes = await fetch('/api/entries/verify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ entryId, transactionSignature: signature }),
              })
              if (retryRes.ok) {
                router.refresh()
                fetchEntries()
              }
            } catch {
              // ignore
            }
          }, ms)
        })

        return
      }

      if (!verifyResponse.ok) {
        // Safe parse for desktop and mobile: avoid JSON errors on 502/non-JSON bodies
        let errorData: { error?: string; details?: string; message?: string } = {}
        try {
          const contentType = verifyResponse.headers.get('content-type') || ''
          if (contentType.includes('application/json')) {
            errorData = await verifyResponse.json()
          }
        } catch {
          // Non-JSON or empty body
        }

        // Permanent failure
        const errorMessage = errorData.details && errorData.error
          ? `${errorData.error}: ${errorData.details}`
          : (errorData.error || 'Failed to verify transaction. Please try again.')
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
      
      // Dialog has already been closed once the transaction confirmed.
    } catch (err) {
      console.error('Purchase error:', err)
      setSuccess(false)

      // Provide helpful error messages for common RPC errors
      let errorMessage = 'Failed to purchase tickets'
      let isUnconfirmedPayment = false
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
        } else if (errMsg === 'server error' || errMsg.includes('Failed to verify')) {
          errorMessage = 'Your payment was sent, but we couldn\'t confirm it right away. Refresh the page in a moment — your ticket should appear. If it doesn\'t, try again or contact support with your transaction signature.'
          isUnconfirmedPayment = true
        } else {
          errorMessage = errMsg
        }
      }

      setError(errorMessage)

      // Payment was sent but verification failed (e.g. mobile/RPC delay): refresh and poll so ticket can appear without manual refresh
      if (isUnconfirmedPayment) {
        router.refresh()
        const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
        delay(1500).then(() => fetchEntries())
        delay(4000).then(() => fetchEntries())
        delay(8000).then(() => fetchEntries())
      }
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
    preloadConfetti()
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
        let msg = 'Failed to record NFT transfer transaction.'
        try {
          const contentType = response.headers.get('content-type') || ''
          if (contentType.includes('application/json')) {
            const errorData = await response.json()
            if (typeof errorData?.error === 'string') msg = errorData.error
          }
        } catch {
          // keep default msg
        }
        throw new Error(msg)
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

  const handleClaimPrize = async () => {
    if (!connected || !publicKey) {
      setClaimPrizeError('Please connect your wallet first.')
      return
    }
    setClaimPrizeLoading(true)
    setClaimPrizeError(null)
    setClaimPrizePhase('loading')
    setClaimPrizeTxSignature(null)
    setClaimPrizeAlreadyClaimed(false)

    const signInForClaim = async (): Promise<boolean> => {
      if (!publicKey || !signMessage) {
        setClaimPrizeError('Sign in required. Connect your wallet and sign the message.')
        return false
      }
      try {
        const walletAddr = publicKey.toBase58()
        const nonceRes = await fetch(`/api/auth/nonce?wallet=${encodeURIComponent(walletAddr)}`, {
          credentials: 'include',
        })
        if (!nonceRes.ok) {
          const data = await nonceRes.json().catch(() => ({}))
          const msg = typeof data?.error === 'string' ? data.error : 'Failed to get sign-in nonce'
          setClaimPrizeError(msg)
          return false
        }
        const { message } = (await nonceRes.json()) as { message: string }
        const messageBytes = new TextEncoder().encode(message)
        const signature = await signMessage(messageBytes)
        const signatureBase64 =
          typeof signature === 'string'
            ? btoa(signature)
            : btoa(String.fromCharCode(...new Uint8Array(signature)))
        const verifyRes = await fetch('/api/auth/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            wallet: walletAddr,
            message,
            signature: signatureBase64,
          }),
        })
        if (!verifyRes.ok) {
          const data = await verifyRes.json().catch(() => ({}))
          const msg =
            typeof data?.error === 'string' ? data.error : 'Sign-in verification failed'
          setClaimPrizeError(msg)
          return false
        }
        return true
      } catch (e) {
        setClaimPrizeError(e instanceof Error ? e.message : 'Sign-in failed')
        return false
      }
    }

    try {
      let response = await fetch(`/api/raffles/${raffle.id}/claim-prize`, {
        method: 'POST',
        credentials: 'include',
      })
      if (response.status === 401) {
        const signedIn = await signInForClaim()
        if (!signedIn) {
          setClaimPrizePhase('idle')
          setClaimPrizeLoading(false)
          return
        }
        response = await fetch(`/api/raffles/${raffle.id}/claim-prize`, {
          method: 'POST',
          credentials: 'include',
        })
      }
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        const msg = typeof data?.error === 'string' ? data.error : 'Failed to claim prize'
        throw new Error(msg)
      }
      const signature =
        typeof data?.transactionSignature === 'string' ? data.transactionSignature : null
      if (!signature) {
        throw new Error('Missing transaction signature from server')
      }
      setClaimPrizeTxSignature(signature)
      setClaimPrizeAlreadyClaimed(data?.alreadyClaimed === true)
      setClaimPrizePhase('success')
    } catch (err) {
      setClaimPrizePhase('idle')
      setClaimPrizeTxSignature(null)
      setClaimPrizeError(err instanceof Error ? err.message : 'Failed to claim prize')
    } finally {
      setClaimPrizeLoading(false)
    }
  }

  const closeClaimPrizeSuccess = () => {
    setClaimPrizePhase('idle')
    setClaimPrizeTxSignature(null)
    setClaimPrizeAlreadyClaimed(false)
    router.refresh()
  }

  const showDepositEscrow =
    raffle.prize_type === 'nft' &&
    !raffle.prize_deposited_at &&
    !!raffle.nft_mint_address &&
    (isCreator || isAdmin)

  const handleTransferNftToEscrow = useCallback(async () => {
    if (!publicKey || !escrowAddress || !raffle.nft_mint_address) return
    setShowEscrowConfirmDialog(false)
    setDepositEscrowError(null)
    setShowManualEscrowFallback(false)
    setDepositEscrowLoading(true)

    // Confirm signature robustly and ensure it actually landed successfully.
    // Wallet adapters can return a signature even if the tx is dropped/failed; this makes the UI truthful.
    const confirmAndAssertSuccess = async (signature: string) => {
      const started = Date.now()
      const timeoutMs = 45_000
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

      while (Date.now() - started < timeoutMs) {
        // Prefer getTransaction so we can read meta.err (authoritative for success/failure)
        try {
          const tx = await connection.getTransaction(signature, {
            commitment: 'confirmed',
            maxSupportedTransactionVersion: 0,
          })
          if (tx?.meta) {
            if (tx.meta.err) {
              throw new Error(`Transaction failed: ${JSON.stringify(tx.meta.err)}`)
            }
            return
          }
        } catch (e) {
          // If RPC errors here, still fall back to signature status below.
          const msg = e instanceof Error ? e.message : String(e)
          // If we already know it failed, don't keep retrying.
          if (msg.toLowerCase().includes('transaction failed')) throw e
        }

        try {
          const st = await connection.getSignatureStatuses([signature], {
            searchTransactionHistory: true,
          })
          const s = st?.value?.[0]
          if (s?.err) {
            throw new Error(`Transaction failed: ${JSON.stringify(s.err)}`)
          }
          if (s?.confirmationStatus === 'confirmed' || s?.confirmationStatus === 'finalized') {
            return
          }
        } catch (e) {
          // ignore and retry; RPC can be flaky on mobile networks
        }

        await sleep(900)
      }

      throw new Error(
        'Transaction signature was returned, but it was not confirmed on-chain in time. Please check your wallet activity and retry.'
      )
    }

    const signInForSession = async (): Promise<boolean> => {
      if (!publicKey || !signMessage) {
        setDepositEscrowError('Sign in required. Connect your wallet and sign in.')
        return false
      }
      try {
        const walletAddr = publicKey.toBase58()
        const nonceRes = await fetch(`/api/auth/nonce?wallet=${encodeURIComponent(walletAddr)}`, {
          credentials: 'include',
        })
        if (!nonceRes.ok) {
          const data = await nonceRes.json().catch(() => ({}))
          const msg = typeof data?.error === 'string' ? data.error : 'Failed to get sign-in nonce'
          setDepositEscrowError(msg)
          return false
        }
        const { message } = (await nonceRes.json()) as { message: string }
        const messageBytes = new TextEncoder().encode(message)
        const signature = await signMessage(messageBytes)
        const signatureBase64 =
          typeof signature === 'string'
            ? btoa(signature)
            : btoa(String.fromCharCode(...new Uint8Array(signature)))

        const verifyRes = await fetch('/api/auth/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            wallet: walletAddr,
            message,
            signature: signatureBase64,
          }),
        })
        if (!verifyRes.ok) {
          const data = await verifyRes.json().catch(() => ({}))
          const msg =
            typeof data?.error === 'string' ? data.error : 'Sign-in verification failed'
          setDepositEscrowError(msg)
          return false
        }
        return true
      } catch (e) {
        setDepositEscrowError(e instanceof Error ? e.message : 'Sign-in failed')
        return false
      }
    }

    const verifyDepositAfterTransfer = async (depositTx?: string) => {
      try {
        const body = depositTx ? JSON.stringify({ deposit_tx: depositTx }) : undefined
        let res = await fetch(`/api/raffles/${raffle.id}/verify-prize-deposit`, {
          method: 'POST',
          headers: body ? { 'Content-Type': 'application/json' } : undefined,
          body,
          credentials: 'include',
        })
        if (res.status === 401) {
          const signedIn = await signInForSession()
          if (!signedIn) return false
          res = await fetch(`/api/raffles/${raffle.id}/verify-prize-deposit`, {
            method: 'POST',
            headers: body ? { 'Content-Type': 'application/json' } : undefined,
            body,
            credentials: 'include',
          })
        }
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          const msg = typeof data?.error === 'string' ? data.error : 'Verification failed'
          setDepositEscrowError(msg)
          return false
        }
        return true
      } catch (e) {
        setDepositEscrowError(e instanceof Error ? e.message : 'Verification failed')
        return false
      }
    }
    const finalizeAfterTransfer = async (depositTx?: string) => {
      const verified = await verifyDepositAfterTransfer(depositTx)
      // Keep a clear user signal that the NFT left the wallet.
      setDepositEscrowSuccess(true)
      if (verified) {
        setDepositEscrowError(null)
        router.refresh()
      }
    }

    try {
      const mint = new PublicKey(raffle.nft_mint_address)
      const escrowPubkey = new PublicKey(escrowAddress)
      // Prefer DB value; otherwise default to SPL/Token-2022 path first and fall back to Mpl Core.
      const standard: PrizeStandard = raffle.prize_standard ?? 'spl'
      // Compressed/Core transfers generally need the asset id (often stored as nft_token_id),
      // while SPL/Token-2022 transfers use mint address.
      const transferAssetId =
        typeof raffle.nft_token_id === 'string' && raffle.nft_token_id.trim()
          ? raffle.nft_token_id.trim()
          : raffle.nft_mint_address

      const mintShort =
        transferAssetId.length > 16
          ? `${transferAssetId.slice(0, 4)}…${transferAssetId.slice(-4)}`
          : transferAssetId
      if (standard === 'mpl_core') {
        if (!walletAdapter) {
          setDepositEscrowError('Wallet adapter not ready for Core transfer. Refresh and try again.')
          return
        }
        const sig = await transferMplCoreToEscrow({
          connection,
          wallet: walletAdapter,
          assetId: transferAssetId,
          escrowAddress,
        })
        await confirmAndAssertSuccess(sig)
        await finalizeAfterTransfer(sig)
        return
      }

      if (standard === 'compressed') {
        if (!walletAdapter) {
          setDepositEscrowError(
            'Wallet adapter not ready for compressed NFT transfer. Refresh and try again.'
          )
          return
        }
        const sig = await transferCompressedNftToEscrow({
          connection,
          wallet: walletAdapter,
          assetId: transferAssetId,
          escrowAddress,
        })
        await confirmAndAssertSuccess(sig)
        await finalizeAfterTransfer(sig)
        return
      }

      // SPL / Token‑2022 path (existing behavior)
      let holder = await getNftHolderInWallet(connection, mint, publicKey)
      for (let attempt = 0; attempt < 4 && !holder; attempt++) {
        await new Promise((r) => setTimeout(r, 800))
        holder = await getNftHolderInWallet(connection, mint, publicKey)
      }
      if (!holder) {
        let transferFallbackDetails: string | null = null
        // Auto-fallbacks: try compressed NFT transfer first, then Mpl Core transfer.
        // This keeps "transfer to escrow" wallet-sign flow working across common NFT standards.
        if (raffle.prize_standard !== 'mpl_core' && walletAdapter) {
          try {
            const sig = await transferCompressedNftToEscrow({
              connection,
              wallet: walletAdapter,
              assetId: transferAssetId,
              escrowAddress,
            })
            await confirmAndAssertSuccess(sig)
            await finalizeAfterTransfer(sig)
            return
          } catch (e) {
            // Not a compressed NFT (or proof/build failed); continue to Core fallback.
            transferFallbackDetails = e instanceof Error ? e.message : String(e)
          }
          try {
            const sig = await transferMplCoreToEscrow({
              connection,
              wallet: walletAdapter,
              assetId: transferAssetId,
              escrowAddress,
            })
            await confirmAndAssertSuccess(sig)
            await finalizeAfterTransfer(sig)
            return
          } catch (e) {
            // Fall through to the detailed not-found guidance below.
            transferFallbackDetails = e instanceof Error ? e.message : String(e)
          }
        }
        const detailsSuffix = transferFallbackDetails
          ? ` Details: ${transferFallbackDetails}`
          : ''
        setDepositEscrowError(
          `We could not build an automatic transfer transaction for this NFT in-app (mint: ${mintShort}). You can still deposit it now: send the NFT directly to the escrow wallet in your wallet app, then tap Verify deposit below. Supported in-app auto transfer standards: SPL Token, Token-2022, Mpl Core, and compressed NFTs.${detailsSuffix}`
        )
        setShowManualEscrowFallback(true)
        return
      }
      if ('delegated' in holder && holder.delegated) {
        setDepositEscrowError(
          'This NFT is currently staked or delegated. You can unstake and retry in-app, or send it manually to escrow from your wallet app, then tap Verify deposit.'
        )
        setShowManualEscrowFallback(true)
        return
      }
      if (!('tokenProgram' in holder) || !('tokenAccount' in holder)) {
        setDepositEscrowError('NFT holder data incomplete. Try again.')
        return
      }
      const { tokenProgram, tokenAccount: sourceTokenAccount } = holder

      // Try Token Metadata transfer first for Tokenkeg NFTs. This handles many pNFT/token-metadata
      // assets that can fail plain SPL transfer simulation in some wallets.
      if (walletAdapter && tokenProgram.equals(TOKEN_PROGRAM_ID)) {
        try {
          const sig = await transferTokenMetadataNftToEscrow({
            connection,
            wallet: walletAdapter,
            mintAddress: raffle.nft_mint_address,
            escrowAddress,
          })
          await confirmAndAssertSuccess(sig)
          await finalizeAfterTransfer(sig)
          return
        } catch {}
      }

      const escrowAta = await getAssociatedTokenAddress(
        mint,
        escrowPubkey,
        false,
        tokenProgram,
        ASSOCIATED_TOKEN_PROGRAM_ID
      )
      const tx = new Transaction()
      try {
        await getAccount(connection, escrowAta, 'confirmed', tokenProgram)
      } catch {
        tx.add(
          createAssociatedTokenAccountInstruction(
            publicKey,
            escrowAta,
            escrowPubkey,
            mint,
            tokenProgram,
            ASSOCIATED_TOKEN_PROGRAM_ID
          )
        )
      }
      tx.add(
        createTransferInstruction(
          sourceTokenAccount,
          escrowAta,
          publicKey,
          1n,
          [],
          tokenProgram
        )
      )
      const sig = await sendTransaction(tx, connection)
      await confirmAndAssertSuccess(sig)
      await finalizeAfterTransfer(sig)
    } catch (e) {
      const baseMessage = e instanceof Error ? e.message : 'Transfer failed'
      setDepositEscrowError(baseMessage)
      setShowManualEscrowFallback(true)
    } finally {
      setDepositEscrowLoading(false)
    }
  }, [publicKey, signMessage, escrowAddress, raffle.nft_mint_address, raffle.nft_token_id, raffle.prize_standard, connection, sendTransaction, router, walletAdapter])

  const handleVerifyPrizeDeposit = useCallback(async () => {
    setDepositEscrowError(null)
    setDepositVerifyLoading(true)
    const manualTx = manualDepositTx.trim()
    try {
      const signInForSession = async (): Promise<boolean> => {
        if (!publicKey || !signMessage) {
          setDepositEscrowError('Sign in required. Connect your wallet and sign in.')
          return false
        }
        try {
          const walletAddr = publicKey.toBase58()
          const nonceRes = await fetch(`/api/auth/nonce?wallet=${encodeURIComponent(walletAddr)}`, {
            credentials: 'include',
          })
          if (!nonceRes.ok) {
            const data = await nonceRes.json().catch(() => ({}))
            const msg = typeof data?.error === 'string' ? data.error : 'Failed to get sign-in nonce'
            setDepositEscrowError(msg)
            return false
          }
          const { message } = (await nonceRes.json()) as { message: string }
          const messageBytes = new TextEncoder().encode(message)
          const signature = await signMessage(messageBytes)
          const signatureBase64 =
            typeof signature === 'string'
              ? btoa(signature)
              : btoa(String.fromCharCode(...new Uint8Array(signature)))
          const verifyRes = await fetch('/api/auth/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
              wallet: walletAddr,
              message,
              signature: signatureBase64,
            }),
          })
          if (!verifyRes.ok) {
            const data = await verifyRes.json().catch(() => ({}))
            const msg =
              typeof data?.error === 'string' ? data.error : 'Sign-in verification failed'
            setDepositEscrowError(msg)
            return false
          }
          return true
        } catch (e) {
          setDepositEscrowError(e instanceof Error ? e.message : 'Sign-in failed')
          return false
        }
      }

      const verifyBody = manualTx ? JSON.stringify({ deposit_tx: manualTx }) : undefined
      let res = await fetch(`/api/raffles/${raffle.id}/verify-prize-deposit`, {
        method: 'POST',
        headers: verifyBody ? { 'Content-Type': 'application/json' } : undefined,
        body: verifyBody,
        credentials: 'include',
      })
      if (res.status === 401) {
        const signedIn = await signInForSession()
        if (!signedIn) return
        res = await fetch(`/api/raffles/${raffle.id}/verify-prize-deposit`, {
          method: 'POST',
          headers: verifyBody ? { 'Content-Type': 'application/json' } : undefined,
          body: verifyBody,
          credentials: 'include',
        })
      }
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setDepositEscrowError(data?.error ?? 'Verification failed')
        setShowManualEscrowFallback(true)
        return
      }
      setManualDepositTx('')
      router.refresh()
    } catch (e) {
      setDepositEscrowError(e instanceof Error ? e.message : 'Verification failed')
      setShowManualEscrowFallback(true)
    } finally {
      setDepositVerifyLoading(false)
    }
  }, [raffle.id, router, publicKey, signMessage, manualDepositTx])

  const handleReturnPrizeToCreator = useCallback(async () => {
    const reason = returnPrizeReason as 'cancelled' | 'wrong_nft' | 'dispute' | 'platform_error' | 'testing'
    if (!['cancelled', 'wrong_nft', 'dispute', 'platform_error', 'testing'].includes(reason)) {
      setReturnPrizeError('Please select a reason')
      return
    }
    setReturnPrizeError(null)
    setReturnPrizeSuccess(false)
    setReturnPrizeLoading(true)
    try {
      const res = await fetch(`/api/raffles/${raffle.id}/return-prize-to-creator`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
        credentials: 'include',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        const msg = typeof data?.error === 'string' ? data.error : 'Failed to return prize to creator'
        setReturnPrizeError(msg)
        return
      }
      setReturnPrizeSuccess(true)
      setTimeout(() => {
        router.refresh()
        setShowReturnPrizeDialog(false)
      }, 1500)
    } catch (e) {
      setReturnPrizeError(e instanceof Error ? e.message : 'Request failed')
    } finally {
      setReturnPrizeLoading(false)
    }
  }, [raffle.id, returnPrizeReason, router])

  const handleRequestCancellation = useCallback(async () => {
    setRequestCancelLoading(true)
    try {
      const res = await fetch(`/api/raffles/${raffle.id}/request-cancellation`, {
        method: 'POST',
        credentials: 'include',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError((data as { error?: string }).error ?? 'Failed to request cancellation')
        return
      }
      router.refresh()
    } finally {
      setRequestCancelLoading(false)
    }
  }, [raffle.id, router])

  // Check if raffle has ended
  const hasEnded = !isActive && !isFuture
  const winnerWalletNorm = (raffle.winner_wallet ?? '').trim()
  const walletNorm = walletAddress.trim()
  const isWinnerDetail = hasEnded && !!winnerWalletNorm && walletNorm === winnerWalletNorm
  const userHasEnteredDetail = userTickets > 0 && !isWinnerDetail

  // Confetti: show once when opening the winner modal on a past raffle you won
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!isWinnerDetail || !showWinner) return

    // Respect OS-level reduced motion
    const prefersReducedMotion =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (prefersReducedMotion) return

    const key = `confetti:raffle-win:${raffle.id}:${raffle.winner_wallet}`
    try {
      if (window.sessionStorage.getItem(key) === '1') return
      window.sessionStorage.setItem(key, '1')
    } catch {
      // sessionStorage can be blocked; still allow confetti once per mount
    }

    // Ensure module is warm for instant fire
    preloadConfetti()
    fireGreenConfetti()
  }, [isWinnerDetail, showWinner, raffle.id, raffle.winner_wallet])
  // Check if we should show the NFT transfer button (ended, has winner, NFT prize, admin, no transaction recorded yet)
  const showNftTransferButton = 
    hasEnded && 
    raffle.winner_wallet && 
    raffle.prize_type === 'nft' && 
    isAdmin && 
    !raffle.nft_transfer_transaction

  const showClaimPrizeButton =
    hasEnded &&
    raffle.prize_type === 'nft' &&
    !!winnerWalletNorm &&
    walletNorm === winnerWalletNorm &&
    !!raffle.prize_deposited_at &&
    !raffle.nft_transfer_transaction &&
    !raffle.prize_returned_at

  // Show "Return prize to creator" when: admin, NFT raffle, prize in escrow, not yet sent to winner, not already returned
  const showReturnPrizeButton =
    isAdmin &&
    raffle.prize_type === 'nft' &&
    !!raffle.prize_deposited_at &&
    !raffle.nft_transfer_transaction &&
    !raffle.prize_returned_at

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
        // If clipboard fails (permissions/unsupported), use prompt fallback.
      }
    }

    window.prompt('Copy raffle link:', url)
  }, [raffle.slug, raffle.title])

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
    <>
      <div className={`container mx-auto ${imageSize === 'small' ? 'py-4 px-3' : imageSize === 'medium' ? 'py-6 px-3 sm:px-4' : 'py-8 px-3 sm:px-4'}`}>
      <div className={`mx-auto ${imageSize === 'small' ? 'space-y-3 max-w-xl' : imageSize === 'medium' ? 'space-y-4 max-w-3xl' : 'space-y-6 max-w-5xl'}`}>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="default"
            onClick={() => router.push('/raffles')}
            className="touch-manipulation min-h-[44px] text-sm sm:text-base"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Listings
          </Button>
          <Button
            variant="outline"
            size="default"
            onClick={handleShareRaffle}
            className="touch-manipulation min-h-[44px] text-sm sm:text-base"
            title="Share this raffle or copy the raffle link."
          >
            <Share2 className="mr-2 h-4 w-4" />
            Share
          </Button>
          {isCreator && (raffle.status === 'live' || raffle.status === 'ready_to_draw') && !raffle.cancellation_requested_at && (
            <Button
              variant="outline"
              size="default"
              onClick={handleRequestCancellation}
              disabled={requestCancelLoading}
              className="touch-manipulation min-h-[44px] text-sm sm:text-base border-amber-500/50 text-amber-600 hover:bg-amber-500/10"
              title="Request cancellation. Ticket buyers get refunds in all cases. Within 24h: no fee to host. After 24h: host is charged cancellation fee."
            >
              {requestCancelLoading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <XCircle className="mr-2 h-4 w-4" />
              )}
              Request cancellation
            </Button>
          )}
          {isCreator && raffle.cancellation_requested_at && (raffle.status !== 'cancelled') && (
            <span className="text-sm text-amber-600 dark:text-amber-400 self-center">
              Cancellation requested — waiting for admin
            </span>
          )}
        </div>
        {/* Mobile: raffle name in the empty space below nav buttons */}
        <div className="md:hidden mb-3">
          <h1 className="text-lg font-semibold truncate text-foreground" title={raffle.title}>
            {raffle.title}
          </h1>
        </div>
        {showDepositEscrow && (
          <>
            <Card className="border-amber-500/50 bg-amber-500/5">
              <CardHeader>
                <CardTitle className="text-lg">Prize in escrow required</CardTitle>
                <CardDescription>
                  <strong>Flow:</strong> You created this raffle → next, transfer the NFT to escrow (it stays locked for the duration of the raffle) → when the raffle ends and a winner is selected, the winner can claim the prize from escrow. Transfer your NFT below; your wallet will ask you to sign. <strong>No listing fee</strong> — only network (gas) fees. Then click Verify deposit.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {!connected && (
                  <p className="text-sm text-amber-600 dark:text-amber-400">Connect your wallet to transfer the NFT to escrow.</p>
                )}
                {!escrowAddress && connected && (
                  <p className="text-sm text-muted-foreground">Preparing…</p>
                )}
                {escrowAddress && (
                  <>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        onClick={() => setShowEscrowConfirmDialog(true)}
                        disabled={!connected || depositEscrowLoading}
                      >
                        {depositEscrowLoading ? 'Sending…' : 'Transfer NFT to escrow'}
                      </Button>
                      <Button
                        variant="outline"
                        onClick={handleVerifyPrizeDeposit}
                        disabled={depositVerifyLoading}
                        title="Checks on-chain that the NFT is in platform escrow, then activates the raffle"
                      >
                        {depositVerifyLoading ? 'Verifying…' : 'Verify deposit'}
                      </Button>
                    </div>
                    <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 space-y-2">
                      <p className="text-xs text-muted-foreground">
                        If your wallet does not open a signature prompt here (common for some compressed NFTs), send the NFT manually to escrow in your wallet app, then tap Verify deposit.
                      </p>
                      <div className="flex flex-wrap items-center gap-2">
                        <code className="text-xs break-all rounded bg-background/80 px-2 py-1">{escrowAddress}</code>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-8 px-2 text-xs"
                          onClick={async () => {
                            try {
                              await navigator.clipboard.writeText(escrowAddress)
                              setDepositEscrowError(null)
                            } catch {
                              setDepositEscrowError('Could not copy escrow address. Please copy it manually.')
                            }
                          }}
                        >
                          Copy escrow address
                        </Button>
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="manual-deposit-tx" className="text-xs">
                          Deposit transaction signature (optional fallback)
                        </Label>
                        <Input
                          id="manual-deposit-tx"
                          value={manualDepositTx}
                          onChange={(e) => setManualDepositTx(e.target.value)}
                          placeholder="Paste Solana tx signature if auto-verify fails"
                          className="text-xs sm:text-sm"
                        />
                        <p className="text-xs text-muted-foreground">
                          If auto-verify fails after manual transfer, paste the transfer signature and tap Verify deposit again.
                        </p>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Verify deposit checks on-chain that the NFT is in escrow, then opens the raffle for entries.
                    </p>
                    {escrowExplorer && (
                      <div className="flex flex-col gap-2">
                        <a
                          href={escrowExplorer.prizeMintUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm text-primary hover:underline inline-flex items-center gap-1 touch-manipulation min-h-[44px] sm:min-h-0"
                          onTouchStart={handleMobileLinkTouchStart}
                          onTouchMove={handleMobileLinkTouchMove}
                          onTouchEnd={handleMobileLinkTouchEnd}
                        >
                          View prize mint on explorer
                          <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden />
                        </a>
                        {escrowExplorer.custodyUrl !== escrowExplorer.prizeMintUrl && (
                          <a
                            href={escrowExplorer.custodyUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm text-primary hover:underline inline-flex items-center gap-1 touch-manipulation min-h-[44px] sm:min-h-0"
                            onTouchStart={handleMobileLinkTouchStart}
                            onTouchMove={handleMobileLinkTouchMove}
                            onTouchEnd={handleMobileLinkTouchEnd}
                          >
                            Escrow token account (custody proof)
                            <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden />
                          </a>
                        )}
                        {escrowExplorer.custodyUrl === escrowExplorer.prizeMintUrl && (
                          <p className="text-xs text-muted-foreground">
                            On Solscan, confirm the owner is the platform escrow wallet.
                          </p>
                        )}
                      </div>
                    )}
                  </>
                )}
                {depositEscrowSuccess && (
                  <p className="text-sm text-green-600 dark:text-green-400">
                    NFT sent to escrow. Click &quot;Verify deposit&quot; below. The NFT has left your wallet on-chain; if it still appears in Phantom or in &quot;Load NFTs&quot; elsewhere, refresh or wait a moment—indexers can lag.
                  </p>
                )}
                {depositEscrowError && (
                  <p className="text-sm text-destructive">{depositEscrowError}</p>
                )}
                {showManualEscrowFallback && (
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    Manual fallback is enabled: transfer NFT to escrow from wallet, then click Verify deposit.
                  </p>
                )}
              </CardContent>
            </Card>

            <Dialog open={showEscrowConfirmDialog} onOpenChange={setShowEscrowConfirmDialog}>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>Transfer NFT to escrow?</DialogTitle>
                  <DialogDescription asChild>
                    <div className="space-y-2 text-left">
                      <p>
                        You are about to send this NFT to the platform escrow wallet. Your wallet will prompt you to sign the transaction.
                      </p>
                      <p>
                        <strong>The NFT will be locked in escrow</strong> until the raffle ends and a winner is chosen. At that point, <strong>the winner can claim the prize</strong> from escrow.
                      </p>
                      <p>
                        Are you sure you want to transfer this NFT to escrow?
                      </p>
                    </div>
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter className="gap-2 sm:gap-0">
                  <Button
                    variant="outline"
                    onClick={() => setShowEscrowConfirmDialog(false)}
                    disabled={depositEscrowLoading}
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={() => handleTransferNftToEscrow()}
                    disabled={depositEscrowLoading}
                  >
                    {depositEscrowLoading ? 'Sending…' : 'Yes, transfer to escrow'}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </>
        )}

        <Card className={`${getThemeAccentClasses(raffle.theme_accent)} ${showEnteredStyle && userHasEnteredDetail ? 'relative raffle-entered-card' : ''}`} style={borderStyle}>
          {showEnteredStyle && userHasEnteredDetail && (
            <div className="raffle-entered-overlay absolute inset-0 rounded-lg z-0" />
          )}
          <CardHeader className={classes.headerPadding}>
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 sm:gap-4">
              <div className="flex-1 min-w-0">
                <CardTitle className={classes.title}>{raffle.title}</CardTitle>
                <CardDescription className={`${classes.description} break-words`}>
                  <LinkifiedText text={raffle.description} />
                </CardDescription>
              </div>
              <div
                className={`relative w-full sm:w-auto shrink-0 rounded-2xl bg-gradient-to-r from-emerald-400/70 via-emerald-500/80 to-emerald-300/70 p-[1px] shadow-[0_0_30px_rgba(16,185,129,0.85)] ${
                  isEndingSoon ? 'animate-pulse' : ''
                }`}
              >
                <div className="flex items-center justify-between gap-3 rounded-[1rem] bg-background/90 px-3 py-2 sm:px-4 sm:py-2.5 touch-manipulation"
                  style={{ touchAction: 'manipulation' }}
                >
                  <div className="flex flex-col gap-1">
                    {raffle.ticket_price > 0 && (
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] text-emerald-100/80">Price</span>
                        <span className={`${classes.description} font-semibold flex items-center gap-1 text-emerald-50`}>
                          {raffle.ticket_price.toFixed(4).replace(/\.?0+$/, '')} {raffle.currency}
                          <CurrencyIcon
                            currency={raffle.currency as 'SOL' | 'USDC' | 'OWL'}
                            size={14}
                            className="inline-block"
                          />
                        </span>
                      </div>
                    )}
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] text-emerald-100/80">Tickets</span>
                      <span className={`${classes.description} font-semibold text-emerald-50`}>{totalTicketsSold}</span>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span
                      className={`inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-wide ${
                        isFuture
                          ? 'border-amber-300/80 bg-amber-500/20 text-amber-100'
                          : isActive
                            ? 'border-emerald-300/80 bg-emerald-500/25 text-emerald-50'
                            : 'border-sky-300/80 bg-sky-500/20 text-sky-50'
                      }`}
                    >
                      {statusPillLabel}
                    </span>
                    <span className="text-[11px] text-emerald-50/80">
                      {timeToEndLabel}
                    </span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 sm:flex-shrink-0">
                {isOwlEnabled() && raffle.creator_is_holder === true && (
                  <span
                    className="inline-flex items-center justify-center rounded-full bg-emerald-500/15 border border-emerald-500/50 text-emerald-400 p-1"
                    title="Hosted by an Owltopia (Owl NFT) holder — 3% platform fee on tickets"
                    role="img"
                    aria-label="Owl holder"
                  >
                    <BadgeCheck className="h-4 w-4 flex-shrink-0" />
                  </span>
                )}
                <OwlVisionBadge score={currentOwlVisionScore} onOpenInTab={() => setActiveTab('owl-vision')} />
              </div>
            </div>
          </CardHeader>

          {(displayImageUrl ?? raffle.image_url) && (
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
                    src={displayImageUrl ?? raffle.image_url ?? ''}
                    alt={raffle.title}
                    fill
                    sizes="(max-width: 768px) 100vw, (max-width: 1200px) 80vw, 1200px"
                    priority
                    loading="eager"
                    className="object-contain"
                    onError={() => setImageError(true)}
                    unoptimized={
                      (displayImageUrl ?? raffle.image_url)?.startsWith('http://') === true ||
                      (displayImageUrl ?? raffle.image_url)?.startsWith('/api/proxy-image') === true
                    }
                  />
                </div>
              ) : fallbackRawUrl && !fallbackImageError ? (
                <div className={`!relative w-full ${imageSize === 'small' ? 'aspect-[4/3]' : imageSize === 'medium' ? 'aspect-[4/3]' : 'aspect-[4/3]'} overflow-hidden`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={fallbackRawUrl}
                    alt={raffle.title}
                    className="w-full h-full object-contain"
                    onError={() => setFallbackImageError(true)}
                  />
                </div>
              ) : (
                <div className={`w-full ${imageSize === 'small' ? 'aspect-[4/3]' : imageSize === 'medium' ? 'aspect-[4/3]' : 'aspect-[4/3]'} flex flex-col items-center justify-center gap-3 bg-muted border rounded p-4`}>
                  <span className="text-muted-foreground">Image unavailable</span>
                </div>
              )}
            </>
          )}

          {!(displayImageUrl ?? raffle.image_url) && (
            <div className={`w-full aspect-[4/3] flex flex-col items-center justify-center gap-3 bg-muted border rounded p-4 ${classes.headerPadding}`}>
              <span className="text-muted-foreground">Image unavailable</span>
            </div>
          )}

          {raffle.prize_type === 'nft' && raffle.prize_deposited_at && escrowExplorer && (
            <div className={`${classes.headerPadding} pt-0 flex flex-col gap-2`}>
              <a
                href={escrowExplorer.prizeMintUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-primary hover:underline inline-flex items-center gap-1 touch-manipulation min-h-[44px] sm:min-h-0"
                onTouchStart={handleMobileLinkTouchStart}
                onTouchMove={handleMobileLinkTouchMove}
                onTouchEnd={handleMobileLinkTouchEnd}
              >
                View prize mint on explorer
                <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden />
              </a>
              {escrowExplorer.custodyUrl !== escrowExplorer.prizeMintUrl && (
                <a
                  href={escrowExplorer.custodyUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-primary hover:underline inline-flex items-center gap-1 touch-manipulation min-h-[44px] sm:min-h-0"
                  onTouchStart={handleMobileLinkTouchStart}
                  onTouchMove={handleMobileLinkTouchMove}
                  onTouchEnd={handleMobileLinkTouchEnd}
                >
                  Escrow token account (custody proof)
                  <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden />
                </a>
              )}
              {escrowExplorer.custodyUrl === escrowExplorer.prizeMintUrl && (
                <p className="text-xs text-muted-foreground">
                  On Solscan, confirm the owner is the platform escrow wallet.
                </p>
              )}
            </div>
          )}

          <CardContent className={classes.contentPadding}>
            <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'overview' | 'owl-vision')}>
              <TabsList className="mb-4 w-full sm:w-auto">
                <TabsTrigger value="overview">Overview</TabsTrigger>
                <TabsTrigger value="owl-vision" className="gap-1.5">
                  <Eye className="h-3.5 w-3.5" />
                  Owl Vision
                </TabsTrigger>
              </TabsList>
              <TabsContent value="overview" className="mt-0">
            {showClaimPrizeButton && (
              <div className="mb-4 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-4 space-y-3">
                <div className="flex items-start gap-3">
                  <Trophy className="h-6 w-6 text-emerald-500 shrink-0 mt-0.5" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-foreground">You won this raffle</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      The prize NFT is in platform escrow (verified). Tap Claim prize and we&apos;ll send it to your connected wallet on Solana. If something fails, contact support — an admin can retry the escrow transfer.
                    </p>
                  </div>
                </div>
                <Button
                  variant="default"
                  size="default"
                  onClick={handleClaimPrize}
                  disabled={claimPrizeLoading || claimPrizePhase === 'loading'}
                  style={{ backgroundColor: themeColor, color: '#000' }}
                  className="w-full touch-manipulation min-h-[44px] text-sm sm:text-base"
                >
                  <Send className="mr-2 h-4 w-4 shrink-0" />
                  {!connected ? 'Connect wallet' : claimPrizePhase === 'loading' ? 'Claiming…' : 'Claim prize'}
                </Button>
                {claimPrizeError && (
                  <p className="text-sm text-destructive">{claimPrizeError}</p>
                )}
              </div>
            )}
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
                    <CurrencyIcon currency={raffle.currency as 'SOL' | 'USDC' | 'OWL'} size={imageSize === 'small' ? 16 : 20} className="inline-block" />
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
                    <Badge variant={(isFuture || isActive || isPendingDraft) ? 'default' : 'secondary'} className={`${imageSize === 'small' ? 'text-xs' : ''} ${statusBadgeClass}`} title={isFuture ? formatDateTimeWithTimezone(raffle.start_time) : formatDateTimeWithTimezone(raffle.end_time)}>
                      {isPendingDraft
                        ? 'Pending escrow deposit'
                        : isFuture
                        ? (new Date(raffle.start_time) <= serverTime
                            ? `Started ${formatDistance(new Date(raffle.start_time), serverTime, { addSuffix: true })}`
                            : `Starts ${formatDateTimeLocal(raffle.start_time)}`)
                        : isActive
                        ? (new Date(raffle.end_time) <= serverTime
                            ? `Ended ${formatDistance(serverTime, new Date(raffle.end_time), { addSuffix: true })}`
                            : `Ends ${formatDateTimeLocal(raffle.end_time)}`)
                        : `Ended ${formatDateTimeLocal(raffle.end_time)}`}
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
                    {raffle.prize_type === 'nft' && (
                      <Badge
                        variant="outline"
                        className={
                          raffle.prize_deposited_at
                            ? 'bg-emerald-500/20 border-emerald-500 text-emerald-400 hover:bg-emerald-500/30'
                            : 'bg-amber-500/20 border-amber-500 text-amber-400 hover:bg-amber-500/30'
                        }
                        title={
                          raffle.prize_deposited_at
                            ? 'Prize escrow deposit verified'
                            : 'Prize escrow deposit not verified'
                        }
                      >
                        Escrow: {raffle.prize_deposited_at ? 'Deposited' : 'Not Deposited'}
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {isFuture ? (
                      <>Starts: {formatDateTimeWithTimezone(raffle.start_time)}</>
                    ) : isPendingDraft ? (
                      <>Pending: waiting for NFT escrow deposit verification</>
                    ) : isActive ? (
                      <>Ends: {formatDateTimeWithTimezone(raffle.end_time)}</>
                    ) : (
                      <>Ended: {formatDateTimeWithTimezone(raffle.end_time)}</>
                    )}
                  </p>
                </div>
              </div>
              <div>
                <p className={classes.labelText + ' text-muted-foreground'}>Created By</p>
                <p className={classes.contentText + ' font-semibold break-all'}>
                  {creatorDisplayName || creatorWallet || 'Unknown'}
                </p>
              </div>
            </div>

            {(raffle.rank || raffle.floor_price) && (
              <div className={`${imageSize === 'small' ? 'p-3' : imageSize === 'medium' ? 'p-4' : 'p-5'} rounded-lg bg-muted/30 border`}>
                <h3 className={`${imageSize === 'small' ? 'text-sm' : imageSize === 'medium' ? 'text-base' : 'text-lg'} font-semibold mb-3`}>Details</h3>
                <div className={`grid grid-cols-1 ${raffle.rank && raffle.floor_price ? 'sm:grid-cols-2' : ''} gap-4`}>
                  {raffle.rank && (
                    <div>
                      <p className={classes.labelText + ' text-muted-foreground'}>Rank</p>
                      <p className={classes.contentText + ' font-semibold'}>{raffle.rank}</p>
                    </div>
                  )}
                  {raffle.floor_price && (
                    <div>
                      <p className={classes.labelText + ' text-muted-foreground'}>Floor Price</p>
                      <p className={classes.contentText + ' font-semibold'}>{raffle.floor_price}</p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {(() => {
              const profitInfo = getRaffleProfitInfo(raffle, entries)
              const cur = profitInfo.thresholdCurrency ?? raffle.currency
              const revenueInCur = cur === 'USDC' ? profitInfo.revenue.usdc : cur === 'SOL' ? profitInfo.revenue.sol : profitInfo.revenue.owl
              const threshold = profitInfo.threshold
              const amountOver = threshold != null && threshold > 0 && revenueInCur > threshold
                ? revenueInCur - threshold
                : null
              const thresholdLabel = raffle.prize_type === 'nft' ? 'Floor (threshold)' : 'Threshold'
              return (
                <div className={`${imageSize === 'small' ? 'p-3' : imageSize === 'medium' ? 'p-4' : 'p-5'} rounded-lg bg-muted/30 border`}>
                  <h3 className={`${imageSize === 'small' ? 'text-sm' : imageSize === 'medium' ? 'text-base' : 'text-lg'} font-semibold mb-3`}>Revenue &amp; threshold</h3>
                  <div className="space-y-3">
                    <div>
                      <p className={classes.labelText + ' text-muted-foreground'}>Revenue (from tickets)</p>
                      <p className={classes.contentText + ' font-semibold'}>
                        {revenueInCur.toFixed(cur === 'USDC' ? 2 : 4)} {cur}
                      </p>
                    </div>
                    <div>
                      <p className={classes.labelText + ' text-muted-foreground'}>{thresholdLabel}</p>
                      <p className={classes.contentText + ' font-semibold'}>
                        {threshold != null && threshold > 0
                          ? `${threshold.toFixed(cur === 'USDC' ? 2 : 4)} ${cur}`
                          : 'Not set'}
                      </p>
                    </div>
                    {amountOver != null && amountOver > 0 && (
                      <div>
                        <p className={classes.labelText + ' text-muted-foreground'}>Amount over threshold</p>
                        <p className={classes.contentText + ' font-semibold text-emerald-600 dark:text-emerald-400'}>
                          +{amountOver.toFixed(cur === 'USDC' ? 2 : 4)} {cur}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )
            })()}

            {connected && (
              <div className={`${imageSize === 'small' ? 'p-2' : imageSize === 'medium' ? 'p-3' : 'p-4'} rounded-lg bg-muted/50 border border-primary/20`}>
                <div className="flex items-center justify-between">
                  <div>
                    <p className={classes.labelText + ' text-muted-foreground'}>Your Tickets</p>
                    <p className={`${imageSize === 'small' ? 'text-lg' : imageSize === 'medium' ? 'text-xl' : 'text-2xl'} font-bold`} style={{ color: themeColor }}>
                      {userTickets} {userTickets === 1 ? 'ticket' : 'tickets'}
                    </p>
                    {userPendingTickets > 0 && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        We&apos;re confirming {userPendingTickets} recent {userPendingTickets === 1 ? 'entry' : 'entries'} on Solana. Your total will update automatically.
                      </p>
                    )}
                  </div>
                  {(userTickets > 0 || userPendingTickets > 0) && (
                    <Badge variant="default" className={`${imageSize === 'small' ? 'text-xs px-2 py-1' : imageSize === 'medium' ? 'text-sm px-3 py-1.5' : 'text-lg px-4 py-2'}`}>
                      {userTickets + userPendingTickets}
                    </Badge>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2 mt-2">
                  <p className="text-xs text-muted-foreground">💡 Don't see your entry?</p>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs touch-manipulation"
                    onClick={() => fetchEntries()}
                  >
                    Refresh
                  </Button>
                </div>
              </div>
            )}

            {isActive && !isFuture && (
              <div className="flex flex-col gap-3 items-stretch">
                {purchasesBlocked && (
                  <p className="text-sm text-amber-600 dark:text-amber-400">
                    Ticket purchases are temporarily blocked. Please check back later.
                  </p>
                )}
                <Button
                  onClick={handleOpenEnterRaffleDialog}
                  disabled={purchasesBlocked || (availableTickets !== null && availableTickets <= 0)}
                  size={classes.buttonSize as any}
                  style={
                    purchasesBlocked
                      ? undefined
                      : { backgroundColor: themeColor, color: '#000' }
                  }
                  variant={purchasesBlocked ? 'secondary' : 'default'}
                  className={`w-full touch-manipulation min-h-[44px] text-sm sm:text-base px-4 sm:px-6 ${purchasesBlocked ? 'opacity-70' : ''}`}
                >
                  {purchasesBlocked
                    ? 'Purchases Blocked'
                    : availableTickets !== null && availableTickets <= 0
                    ? 'Sold Out'
                    : 'Enter Raffle'}
                </Button>
              </div>
            )}
            {isFuture && (
              <div className="flex justify-center">
                <Badge variant="default" className="bg-red-500 hover:bg-red-600 text-white px-4 py-2" title={formatDateTimeWithTimezone(raffle.start_time)}>
                  {new Date(raffle.start_time) <= serverTime ? `Started ${formatDistance(new Date(raffle.start_time), serverTime, { addSuffix: true })}` : `Starts ${formatDateTimeLocal(raffle.start_time)}`}
                </Badge>
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
              {connected && (
                <Button
                  variant="outline"
                  size="default"
                  onClick={() => setShowParticipants(true)}
                  className="w-full sm:flex-1 touch-manipulation min-h-[44px] text-sm sm:text-base"
                >
                  <Users className="mr-2 h-4 w-4 shrink-0" />
                  <span className="hidden sm:inline">View Participants ({currentOwlVisionScore.uniqueWallets})</span>
                  <span className="sm:hidden">Participants ({currentOwlVisionScore.uniqueWallets})</span>
                </Button>
              )}
              {raffle.winner_wallet && (
                <Button
                  variant="outline"
                  size="default"
                  className="w-full sm:flex-1 touch-manipulation min-h-[44px] text-sm sm:text-base"
                  onClick={() => setShowWinner(true)}
                >
                  <Trophy className="mr-2 h-4 w-4 shrink-0" />
                  View Winner
                </Button>
              )}
              {showClaimPrizeButton && (
                <Button
                  variant="default"
                  size="default"
                  onClick={handleClaimPrize}
                  disabled={claimPrizeLoading || claimPrizePhase === 'loading'}
                  style={{ backgroundColor: themeColor, color: '#000' }}
                  className="w-full sm:flex-1 touch-manipulation min-h-[44px] text-sm sm:text-base"
                >
                  <Send className="mr-2 h-4 w-4 shrink-0" />
                  {!connected
                    ? 'Connect Wallet'
                    : claimPrizePhase === 'loading'
                    ? 'Claiming…'
                    : 'Claim Prize'}
                </Button>
              )}
              {showNftTransferButton && (
                <Button
                  variant="outline"
                  size="default"
                  onClick={handleOpenNftTransferDialog}
                  className="w-full sm:flex-1 touch-manipulation min-h-[44px] text-sm sm:text-base"
                >
                  <Send className="mr-2 h-4 w-4 shrink-0" />
                  <span className="hidden sm:inline">Record NFT Transfer</span>
                  <span className="sm:hidden">Record Transfer</span>
                </Button>
              )}
              {showReturnPrizeButton && (
                <Button
                  variant="outline"
                  size="default"
                  onClick={() => {
                    setReturnPrizeError(null)
                    setReturnPrizeSuccess(false)
                    setShowReturnPrizeDialog(true)
                  }}
                  className="w-full sm:flex-1 touch-manipulation min-h-[44px] text-sm sm:text-base"
                >
                  <ArrowLeft className="mr-2 h-4 w-4 shrink-0" />
                  <span className="hidden sm:inline">Return Prize to Creator</span>
                  <span className="sm:hidden">Return Prize</span>
                </Button>
              )}
              {isAdmin && (
                <Button
                  variant="outline"
                  size="default"
                  onClick={() => router.push(`/admin/raffles/${raffle.id}`)}
                  className="w-full sm:flex-1 touch-manipulation min-h-[44px] text-sm sm:text-base"
                >
                  <Edit className="mr-2 h-4 w-4 shrink-0" />
                  <span className="hidden sm:inline">Edit Raffle</span>
                  <span className="sm:hidden">Edit</span>
                </Button>
              )}
            </div>
              </TabsContent>
              <TabsContent value="owl-vision" className="mt-0">
                <div className="space-y-4">
                  <div>
                    <h3 className="text-lg font-semibold mb-2 flex items-center gap-2">
                      <Eye className="h-5 w-5 text-green-500" />
                      Owl Vision Trust Score: {currentOwlVisionScore.score}/100
                    </h3>
                    <p className="text-sm text-muted-foreground mb-4">
                      This score summarizes how transparent and fair this raffle is — verified payments, wallet diversity, and time integrity.
                    </p>
                  </div>
                  <div className="rounded-lg border bg-muted/30 p-4 space-y-4">
                    <div>
                      <p className="font-medium text-sm text-muted-foreground">Verified Payments</p>
                      <p className="text-base font-semibold">
                        {Math.round(currentOwlVisionScore.verifiedRatio * 100)}% — {currentOwlVisionScore.confirmedEntries} / {currentOwlVisionScore.totalEntries} entries confirmed on-chain
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">Higher % means more tickets backed by real, verified transactions.</p>
                    </div>
                    <div>
                      <p className="font-medium text-sm text-muted-foreground">Wallet Diversity</p>
                      <p className="text-base font-semibold">
                        {Math.round(currentOwlVisionScore.diversityRatio * 100)}% — {currentOwlVisionScore.uniqueWallets} unique wallets
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">Higher diversity suggests broader, more organic participation.</p>
                    </div>
                    <div>
                      <p className="font-medium text-sm text-muted-foreground">Time Integrity</p>
                      <p className="text-base font-semibold">
                        {currentOwlVisionScore.integrityScore}/10 — {currentOwlVisionScore.editedAfterEntries ? 'Edited after entries' : 'Not edited after entries'}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">Full points when the raffle wasn’t changed after people entered.</p>
                    </div>
                  </div>
                </div>
              </TabsContent>
            </Tabs>
            {showClaimPrizeButton && claimPrizeError && (
              <div className="mt-3 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {claimPrizeError}
              </div>
            )}
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

      <Dialog open={showReturnPrizeDialog} onOpenChange={setShowReturnPrizeDialog}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Return Prize to Creator</DialogTitle>
            <DialogDescription>
              Send the NFT from escrow back to the raffle creator. Use only for: cancelled raffle, wrong NFT deposited, dispute resolution, or platform error. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="return-prize-reason">Reason</Label>
              <select
                id="return-prize-reason"
                value={returnPrizeReason}
                onChange={(e) => setReturnPrizeReason(e.target.value)}
                disabled={returnPrizeLoading}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="cancelled">Raffle cancelled</option>
                <option value="wrong_nft">Wrong NFT deposited</option>
                <option value="dispute">Dispute resolution</option>
                <option value="platform_error">Platform error</option>
                <option value="testing">Testing</option>
              </select>
            </div>
            {returnPrizeError && (
              <div className="p-3 rounded-lg bg-destructive/10 border border-destructive text-destructive text-sm">
                {returnPrizeError}
              </div>
            )}
            {returnPrizeSuccess && (
              <div className="p-3 rounded-lg bg-green-500/10 border border-green-500 text-green-500 text-sm">
                Prize returned to creator successfully.
              </div>
            )}
          </div>
          <DialogFooter className="flex-col sm:flex-row gap-3 sm:gap-2">
            <Button
              variant="outline"
              onClick={() => setShowReturnPrizeDialog(false)}
              disabled={returnPrizeLoading}
              className="w-full sm:w-auto touch-manipulation min-h-[44px] text-base sm:text-sm"
            >
              Cancel
            </Button>
            <Button
              onClick={handleReturnPrizeToCreator}
              disabled={returnPrizeLoading}
              style={{ backgroundColor: themeColor, color: '#000' }}
              className="w-full sm:w-auto touch-manipulation min-h-[44px] text-base sm:text-sm"
            >
              {returnPrizeLoading ? 'Returning...' : 'Return Prize to Creator'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showNftTransferDialog} onOpenChange={setShowNftTransferDialog}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Record NFT Transfer Transaction</DialogTitle>
            <DialogDescription>
              Prefer sending from escrow on the admin raffle page (&quot;Send prize from escrow&quot;). Use this form only when you already transferred the NFT manually and need to record the Solana signature for transparency.
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

      {/* While a purchase is processing, keep users on the page with a simple blocking dialog */}
      <Dialog open={isProcessing} onOpenChange={() => {}}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Processing your entry</DialogTitle>
            <DialogDescription>
              Your payment was sent. We&apos;re confirming it on Solana — this usually takes a few seconds.
              Please keep this page open; your tickets will update automatically once confirmed.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-3 mt-3">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">
              You can safely read this page while we verify on-chain. Closing the tab won&apos;t cancel the transaction.
            </p>
          </div>
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
                <CurrencyIcon currency={raffle.currency as 'SOL' | 'USDC' | 'OWL'} size={20} className="inline-block" />
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

      {(claimPrizePhase === 'loading' || claimPrizePhase === 'success') && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-background/90 backdrop-blur-sm p-4"
          role="alertdialog"
          aria-modal="true"
          aria-busy={claimPrizePhase === 'loading'}
          aria-labelledby="claim-prize-overlay-title"
        >
          <div className="w-full max-w-md rounded-xl border bg-card p-6 shadow-lg space-y-4 text-center">
            {claimPrizePhase === 'loading' ? (
              <>
                <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto" aria-hidden />
                <h2 id="claim-prize-overlay-title" className="text-lg font-semibold text-foreground">
                  Claiming your prize…
                </h2>
                <p className="text-sm text-muted-foreground">
                  Stay on this screen. Your wallet may ask you to sign in first; after that we broadcast
                  the NFT transfer from escrow. Solana usually confirms within a few seconds.
                </p>
              </>
            ) : (
              <>
                <div
                  className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                  aria-hidden
                >
                  <Trophy className="h-8 w-8" />
                </div>
                <h2 id="claim-prize-overlay-title" className="text-lg font-semibold text-foreground">
                  {claimPrizeAlreadyClaimed ? 'Prize already sent' : 'Prize sent!'}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {claimPrizeAlreadyClaimed
                    ? 'This prize was already transferred to your wallet. Open Solscan below to verify the transaction.'
                    : 'Your NFT prize has been sent to your connected wallet. You can confirm the transfer on Solscan.'}
                </p>
                {claimPrizeTxSignature ? (
                  <a
                    href={solscanTransactionUrl(claimPrizeTxSignature)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-md border border-primary/40 bg-primary/10 px-4 py-3 text-sm font-medium text-primary hover:bg-primary/15 w-full touch-manipulation"
                  >
                    View transaction on Solscan
                    <ExternalLink className="h-4 w-4 shrink-0" aria-hidden />
                  </a>
                ) : null}
                <Button
                  type="button"
                  className="w-full min-h-[44px] touch-manipulation text-base"
                  onClick={closeClaimPrizeSuccess}
                >
                  Done
                </Button>
              </>
            )}
          </div>
        </div>
      )}
      </div>
    </>
  )
}
