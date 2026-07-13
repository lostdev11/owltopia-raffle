'use client'

import { useState, useEffect, useRef, useCallback, useMemo, type CSSProperties } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { useWallet, useConnection } from '@solana/wallet-adapter-react'
import { useSendTransactionForWallet } from '@/lib/hooks/useSendTransactionForWallet'
import Link from 'next/link'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { OwlVisionBadge } from '@/components/OwlVisionBadge'
import { RaffleDeadlineExtensionBadge } from '@/components/RaffleDeadlineExtensionBadge'
import { CreatorModerationBuyerWarning } from '@/components/CreatorModerationBuyerWarning'
import { HootBoostMeter } from '@/components/HootBoostMeter'
import { CurrencyIcon } from '@/components/CurrencyIcon'
import { getPartnerPrizeTokenByCurrency } from '@/lib/partner-prize-tokens'
import type { Raffle, Entry } from '@/lib/types'
import { formatRaffleTicketPriceSummary, raffleAcceptsSolAndBambooTickets } from '@/lib/raffles/dual-ticket-payment'
import {
  type RaffleProfitInfo,
  revenueFlexPromoChipUppercase,
  shouldShowRevenueFlexPublic,
} from '@/lib/raffle-profit'
import { calculateOwlVisionScore } from '@/lib/owl-vision'
import { isRaffleEligibleToDraw, calculateTicketsSold, getRaffleMinimum } from '@/lib/db/raffles'
import {
  getThemeAccentBorderStyle,
  getThemeAccentClasses,
  getThemeAccentColor,
  getThemeAccentRgbChannels,
  partnerStripOuterGlowFromChannels,
  softOuterGlowFromChannels,
} from '@/lib/theme-accent'
import { getCachedAdmin, setCachedAdmin } from '@/lib/admin-check-cache'
import { isOwlEnabled } from '@/lib/tokens'
import {
  executeRafflePurchase,
  TICKETS_CONFIRMING_MESSAGE,
} from '@/lib/client/execute-raffle-purchase'
import { MAX_TICKET_QUANTITY_PER_ENTRY } from '@/lib/entries/max-ticket-quantity'
import { isPartnerSplPrizeRaffle } from '@/lib/partner-prize-tokens'
import { LinkifiedText, LinkifiedTextInsideLinkProvider } from '@/components/LinkifiedText'
import { ReferralComplimentaryHint } from '@/components/ReferralComplimentaryHint'
import { RafflePromoPngButton } from '@/components/RafflePromoPngButton'
import {
  RaffleOverThresholdPngButton,
  buildOverThresholdFlexMetaLines,
} from '@/components/RaffleOverThresholdPngButton'
import { formatDistance, formatDistanceToNow } from 'date-fns'
import { formatDateTimeWithTimezone, formatDateTimeLocal } from '@/lib/utils'
import { Trophy, Share2, BadgeCheck, Loader2, Users, ShoppingCart } from 'lucide-react'
import Image from 'next/image'
import { fireGreenConfetti, preloadConfetti } from '@/lib/confetti'
import {
  buildRaffleImageAttemptChain,
  getRaffleDisplayImageUrl,
  isDirectRaffleImageHost,
} from '@/lib/raffle-display-image-url'
import { useCart } from '@/components/cart/CartProvider'
import { isRaffleCreatorWallet } from '@/lib/cart/validate-raffle-checkout'
import { shareRaffleFromBrowser } from '@/lib/client/raffle-share'
import { useImageAttemptTimeout } from '@/lib/use-image-attempt-timeout'
import { fetchMintNftMetadata } from '@/lib/client/nft-metadata-client'
import { useNearViewportOnce } from '@/hooks/use-near-viewport-once'

/** GIF/animated WebP: avoid Next image optimizer for proxy URLs (matches RaffleDetailClient). */
function raffleImageUnoptimized(src: string): boolean {
  if (src.startsWith('http://') || src.startsWith('/api/proxy-image')) return true
  try {
    const u = new URL(src)
    if (u.protocol === 'https:' && isDirectRaffleImageHost(u.hostname)) return true
  } catch {
    /* ignore */
  }
  return false
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
  /** Partner community creator (2% platform fee); show badge on card */
  isPartnerCommunity?: boolean
  /** Featured partner marquee: softer rim + ambient glow so halos blend on dark backgrounds */
  partnerFeaturedStrip?: boolean
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
  isPartnerCommunity = false,
  partnerFeaturedStrip = false,
}: RaffleCardProps) {
  const router = useRouter()
  const pathname = usePathname()
  const { publicKey, connected } = useWallet()
  const sendTransaction = useSendTransactionForWallet()
  const { connection } = useConnection()
  const { addItem: addCartItem } = useCart()
  const wallet = publicKey?.toBase58() ?? ''
  /** Creators cannot buy tickets in their own raffle */
  const viewerIsCreator = connected && isRaffleCreatorWallet(raffle, wallet)
  const [mounted, setMounted] = useState(false)
  const [now, setNow] = useState<Date | null>(null)
  const [isAdmin, setIsAdmin] = useState(() =>
    typeof window !== 'undefined' && wallet ? (getCachedAdmin(wallet) ?? false) : false
  )
  const [imageModalOpen, setImageModalOpen] = useState(false)
  const [showQuickBuy, setShowQuickBuy] = useState(false)
  const [ticketQuantity, setTicketQuantity] = useState(1)
  const [ticketQuantityDisplay, setTicketQuantityDisplay] = useState('1')
  const [isProcessing, setIsProcessing] = useState(false)
  
  // Calculate purchase amount automatically based on ticket price and quantity
  const purchaseAmount = raffle.ticket_price * ticketQuantity
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [ticketsConfirming, setTicketsConfirming] = useState(false)
  const [cartAddedHint, setCartAddedHint] = useState(false)
  const [winnerDisplayName, setWinnerDisplayName] = useState<string | null>(null)
  const imageAttemptChain = useMemo(() => {
    const fromDb = getRaffleDisplayImageUrl(raffle.image_url)
    const prizeCurrency = (raffle.prize_currency || '').trim().toUpperCase()
    const isLegacyOwltopiaPlaceholder =
      typeof raffle.image_url === 'string' &&
      (/\/logo\.gif$/i.test(raffle.image_url.trim()) || /\/icon\.png$/i.test(raffle.image_url.trim()))
    const cryptoCurrencyArt =
      (raffle.prize_type === 'crypto' || raffle.prize_type == null) &&
      (prizeCurrency === 'SOL' || prizeCurrency === 'USDC')
        ? prizeCurrency === 'SOL'
          ? '/solana-mark.svg'
          : '/usdc.png'
        : null
    if (cryptoCurrencyArt && (!fromDb || isLegacyOwltopiaPlaceholder)) {
      return [cryptoCurrencyArt]
    }
    return buildRaffleImageAttemptChain(raffle.image_url, raffle.image_fallback_url).filter(Boolean)
  }, [raffle.image_url, raffle.image_fallback_url, raffle.prize_type, raffle.prize_currency])
  const imageAttemptChainKey = imageAttemptChain.join('\0')
  const [thumbIdx, setThumbIdx] = useState(0)
  const [thumbLoaded, setThumbLoaded] = useState(false)
  const [modalImgIdx, setModalImgIdx] = useState(0)
  const [listMintThumbSrc, setListMintThumbSrc] = useState<string | null>(null)
  const [listMintThumbLoading, setListMintThumbLoading] = useState(false)
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

  const enableThumbViewportGate = size === 'small' && !priority
  const { ref: thumbViewportRef, visible: thumbNearViewport } = useNearViewportOnce('400px 0px')
  const imageLoadActive = !enableThumbViewportGate || thumbNearViewport

  const canListMintThumb =
    raffle.prize_type === 'nft' && !!(raffle.nft_mint_address && raffle.nft_mint_address.trim())

  useEffect(() => {
    setThumbIdx(0)
    setThumbLoaded(false)
    setListMintThumbSrc(null)
    setListMintThumbLoading(false)
  }, [raffle.id, imageAttemptChainKey])

  useEffect(() => {
    if (imageModalOpen) setModalImgIdx(0)
  }, [imageModalOpen])

  useEffect(() => {
    if (!imageLoadActive) return
    if (thumbIdx < imageAttemptChain.length) return
    if (!canListMintThumb || listMintThumbSrc || listMintThumbLoading) return
    const mint = raffle.nft_mint_address?.trim()
    if (!mint) return
    setListMintThumbLoading(true)
    let cancelled = false
    fetchMintNftMetadata(mint, true)
      .then((data) => {
        if (cancelled) return
        const raw = data.image?.trim() ?? ''
        if (!raw) {
          setListMintThumbLoading(false)
          return
        }
        setThumbLoaded(false)
        setListMintThumbSrc(getRaffleDisplayImageUrl(raw) ?? raw)
        setListMintThumbLoading(false)
      })
      .catch(() => {
        if (!cancelled) setListMintThumbLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [
    thumbIdx,
    imageAttemptChain.length,
    imageAttemptChainKey,
    canListMintThumb,
    raffle.nft_mint_address,
    listMintThumbSrc,
    listMintThumbLoading,
    imageLoadActive,
  ])

  const tryNextThumb = useCallback(() => {
    setThumbLoaded(false)
    setThumbIdx((i) => i + 1)
  }, [])

  const handleThumbLoadOrError = useCallback(
    (e: React.SyntheticEvent<HTMLImageElement>) => {
      if (thumbIdx < imageAttemptChain.length) {
        if (e.type === 'error') {
          tryNextThumb()
          return
        }
        const el = e.currentTarget
        if (el.naturalWidth < 2 || el.naturalHeight < 2) {
          tryNextThumb()
          return
        }
        setThumbLoaded(true)
        return
      }
      if (e.type === 'error') {
        if (listMintThumbSrc) setListMintThumbSrc(null)
        return
      }
      const el = e.currentTarget
      if (el.naturalWidth < 2 || el.naturalHeight < 2) {
        setListMintThumbSrc(null)
        return
      }
      setThumbLoaded(true)
    },
    [thumbIdx, imageAttemptChain.length, tryNextThumb, listMintThumbSrc]
  )

  const onThumbTimeout = useCallback(() => {
    if (thumbIdx < imageAttemptChain.length) {
      tryNextThumb()
    } else if (listMintThumbSrc) {
      setThumbLoaded(false)
      setListMintThumbSrc(null)
    }
  }, [thumbIdx, imageAttemptChain.length, tryNextThumb, listMintThumbSrc])

  const listThumbSrc =
    thumbIdx < imageAttemptChain.length
      ? imageAttemptChain[thumbIdx]
      : (listMintThumbSrc ?? '')
  const listThumbUseContain =
    listThumbSrc === '/solana-mark.svg' || listThumbSrc === '/usdc.png'
  const listThumbMintLoading =
    thumbIdx >= imageAttemptChain.length && listMintThumbLoading && !listMintThumbSrc
  const listThumbDead = imageLoadActive && !listThumbSrc && !listThumbMintLoading

  const promoPngImageAttemptUrls = useMemo(() => {
    const urls = [...imageAttemptChain]
    if (listMintThumbSrc && !urls.includes(listMintThumbSrc)) urls.push(listMintThumbSrc)
    return urls
  }, [imageAttemptChain, listMintThumbSrc])

  useImageAttemptTimeout(
    imageLoadActive && Boolean(listThumbSrc) && !listThumbMintLoading && !thumbLoaded,
    `${thumbIdx}:${listThumbSrc}`,
    onThumbTimeout,
    size === 'small' ? 4000 : 8000
  )

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
  const isPendingDraft =
    raffle.status === 'draft' &&
    !raffle.prize_deposited_at &&
    !raffle.is_active &&
    ((raffle.prize_type === 'nft' && !!(raffle.nft_mint_address && raffle.nft_mint_address.trim())) ||
      isPartnerSplPrizeRaffle(raffle))
  const purchasesBlocked = !!(raffle as { purchases_blocked_at?: string | null }).purchases_blocked_at
  const creatorModerationFlag = raffle.creator_restricted_listing === true
  const isWinner = mounted && !isActive && !!raffle.winner_wallet && publicKey?.toBase58() === raffle.winner_wallet
  const userHasEntered = mounted && !!wallet && entries.some(e => e.wallet_address === wallet && e.status === 'confirmed')
  
  // Use red for future, blue for past, theme accent for active (section-based when available = no hydration mismatch)
  const baseBorderStyle = getThemeAccentBorderStyle(raffle.theme_accent)
  const borderStyleBase = isPendingDraft
    ? { borderColor: '#f59e0b', boxShadow: softOuterGlowFromChannels('245 158 11') }
    : isFuture
      ? { borderColor: '#ef4444', boxShadow: softOuterGlowFromChannels('239 68 68') }
      : !isActive
        ? { borderColor: '#3b82f6', boxShadow: softOuterGlowFromChannels('59 130 246') }
        : baseBorderStyle
  const borderStyle =
    partnerFeaturedStrip && isActive && !isPendingDraft && !isFuture
      ? {
          ...borderStyleBase,
          borderColor: `rgb(${getThemeAccentRgbChannels(raffle.theme_accent)} / 0.85)`,
          boxShadow: partnerStripOuterGlowFromChannels(getThemeAccentRgbChannels(raffle.theme_accent)),
        }
      : borderStyleBase
  const themeColor = isPendingDraft ? '#f59e0b' : (isFuture ? '#ef4444' : (!isActive ? '#3b82f6' : getThemeAccentColor(raffle.theme_accent)))
  const cardSurfaceStyle: CSSProperties =
    isWinner
      ? { ...borderStyle, borderColor: '#facc15' }
      : userHasEntered && !isWinner
        ? {
            ...borderStyle,
            ['--entered-rgb' as string]: getThemeAccentRgbChannels(raffle.theme_accent),
            ['--card-status-glow' as string]: borderStyle.boxShadow,
          }
        : borderStyle
  const statusLabel = isPendingDraft ? 'Pending' : (isFuture ? 'Future' : (isActive ? 'Active' : 'Ended'))
  const statusBadgeClass = isPendingDraft
    ? 'bg-amber-500 hover:bg-amber-600 text-white'
    : (isFuture ? 'bg-red-500 hover:bg-red-600 text-white' : (isActive ? 'bg-green-500 hover:bg-green-600 text-white' : 'bg-blue-500 hover:bg-blue-600 text-white'))
  
  // Calculate available tickets
  const totalTicketsSold = calculateTicketsSold(entries)
  const availableTickets = raffle.max_tickets 
    ? raffle.max_tickets - totalTicketsSold 
    : null
  const maxPurchaseQuantity =
    availableTickets !== null ? Math.max(0, availableTickets) : MAX_TICKET_QUANTITY_PER_ENTRY

  const quantityInputMax = availableTickets !== null ? maxPurchaseQuantity : undefined
  
  // Calculate minimum eligibility
  const minTickets = getRaffleMinimum(raffle)
  const isEligibleToDraw = minTickets ? isRaffleEligibleToDraw(raffle, entries) : true

  // Owl holder verification: show on card when creator is Owltopia (Owl NFT) holder
  const showHolderBadge = isOwlEnabled() && raffle.creator_is_holder === true
  const showPartnerBadge = isPartnerCommunity
  const partnerDisplayName = raffle.creator_partner_display_name?.trim() ?? ''
  const partnerBadgeTitle = partnerDisplayName
    ? `Partner: ${partnerDisplayName} — 2% platform fee on ticket sales`
    : 'Partner community — 2% platform fee on ticket sales'
  const partnerBadgeAria = partnerDisplayName ? `Partner: ${partnerDisplayName}` : 'Partner community'

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

  const dismissQuickBuyAfterSuccess = () => {
    setTimeout(() => {
      setShowQuickBuy(false)
      setSuccess(false)
      setTicketQuantity(1)
      setTicketQuantityDisplay('1')
    }, 2000)
  }

  const handlePurchase = async () => {
    if (!connected || !publicKey) {
      setError('Please connect your wallet first')
      return
    }

    if (viewerIsCreator) {
      setError('You cannot buy tickets in your own raffle.')
      return
    }

    if (raffle.currency === 'OWL' && !isOwlEnabled()) {
      setError('OWL entry is not enabled yet — mint address pending.')
      return
    }

    setIsProcessing(true)
    setError(null)
    setSuccess(false)
    setTicketsConfirming(false)

    try {
      const res = await executeRafflePurchase({
        raffle,
        ticketQuantity,
        publicKey,
        connection,
        sendTransaction,
        routerRefresh: () => router.refresh(),
        celebrateOnComplimentary: true,
        celebrateOnPaymentConfirmed: false,
        onComplimentarySuccess: () => setSuccess(true),
        onVerifyPending: async () => {
          setTicketsConfirming(true)
          setError(null)
          setSuccess(false)
          router.refresh()
        },
      })

      if (!res.ok) {
        setTicketsConfirming(false)
        setError(res.error)
        if (res.isUnconfirmedPayment) router.refresh()
        return
      }

      if (res.verifying) {
        setTicketsConfirming(true)
        setError(null)
        setSuccess(false)
        router.refresh()
        return
      }

      setTicketsConfirming(false)
      setSuccess(true)
      dismissQuickBuyAfterSuccess()
      router.refresh()
    } finally {
      setIsProcessing(false)
    }
  }

  const handleAddToCart = () => {
    setCartAddedHint(false)
    const res = addCartItem(raffle, ticketQuantity)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setError(null)
    setCartAddedHint(true)
    setTimeout(() => setCartAddedHint(false), 2200)
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
      preloadConfetti()
      setTicketQuantity(1)
      setTicketQuantityDisplay('1')
      setError(null)
      setSuccess(false)
    }
    setShowQuickBuy(!showQuickBuy)
  }

  const handleShareRaffle = useCallback(async () => {
    await shareRaffleFromBrowser({
      raffle,
      isFullAdmin: isAdmin,
    })
  }, [raffle, isAdmin])

  // Small size - List format (horizontal)
  if (size === 'small') {
    const smallRaffleHref = `/raffles/${raffle.slug}`

    return (
      <div
        ref={enableThumbViewportGate ? thumbViewportRef : undefined}
        className="relative z-10 flex h-full min-h-0 w-full min-w-0 flex-col md:hover:z-50"
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
      >
          <Card
            className={`raffle-card-modern relative ${getThemeAccentClasses(raffle.theme_accent, 'hover:scale-[1.02] cursor-pointer flex h-full min-h-0 w-full min-w-0 flex-col p-0 rounded-[1.25rem]')} ${isWinner ? 'ring-4 ring-yellow-400 ring-offset-2 winner-golden-card' : ''} ${userHasEntered && !isWinner ? 'raffle-entered-card' : ''}`}
            style={cardSurfaceStyle}
          >
            {/* Clip inner content only; outer Card keeps theme / entered box-shadow uncropped */}
            <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-[1.25rem]">
            {isWinner && (
              <div className="winner-golden-overlay absolute inset-0 rounded-[1.25rem] pointer-events-none z-0" />
            )}
            {userHasEntered && !isWinner && (
              <div className="raffle-entered-overlay absolute inset-0 rounded-[1.25rem] z-0" />
            )}
            {/* Theme accent blob (modern card flair) */}
            <div
              className="raffle-card-accent-blob -top-8 -right-8 z-0"
              style={{ background: themeColor }}
              aria-hidden
            />
            {/* List row layout aligned with production c248996: flex row, square thumb (bg-muted), deadline row mt-auto in one right column */}
            <div className="flex min-h-0 flex-1 flex-row items-stretch">
            {!listThumbDead && (
              <div
                className="!relative z-10 m-0 flex w-24 min-w-[96px] flex-shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-l-[1.25rem] bg-muted p-0 aspect-square sm:w-32 md:w-40"
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  setImageModalOpen(true)
                }}
              >
                {listThumbMintLoading ? (
                  <div className="absolute inset-0 flex items-center justify-center bg-muted/60" aria-hidden>
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : imageLoadActive && listThumbSrc ? (
                  /* eslint-disable-next-line @next/next/no-img-element -- list row: next/image often fails on proxy/GIF in tight layout */
                  <img
                    key={`thumb-${thumbIdx}-${listThumbSrc}`}
                    src={listThumbSrc}
                    alt=""
                    width={160}
                    height={160}
                    loading={priority ? 'eager' : 'lazy'}
                    decoding="async"
                    fetchPriority={priority ? 'high' : 'auto'}
                    className={`pointer-events-none absolute inset-0 h-full w-full ${listThumbUseContain ? 'object-contain p-3' : 'object-cover object-center'}`}
                    onError={handleThumbLoadOrError}
                    onLoad={handleThumbLoadOrError}
                  />
                ) : null}
              </div>
            )}
            {listThumbDead && (
              <Link
                href={smallRaffleHref}
                className="relative z-10 flex aspect-square w-24 min-w-[96px] flex-shrink-0 items-center justify-center rounded-l-[1.25rem] bg-muted sm:w-32 md:w-40"
                onClick={(e) => handleLinkClick(e)}
              >
                <span className="text-[9px] sm:text-[10px] text-muted-foreground text-center px-1">Image unavailable</span>
              </Link>
            )}
            <div className="relative z-10 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
              <Link
                href={smallRaffleHref}
                className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden p-1.5 sm:p-2"
                onClick={(e) => handleLinkClick(e)}
              >
                <LinkifiedTextInsideLinkProvider>
              <div className="flex items-center justify-between gap-1.5 mb-0.5 sm:mb-1 min-w-0">
                <CardTitle className="raffle-card-title !text-[0.8125rem] sm:!text-[0.875rem] !leading-snug line-clamp-3 sm:line-clamp-4 flex-1 min-w-0 overflow-hidden text-foreground pr-0.5 break-words">
                  {raffle.title}
                </CardTitle>
                <div className="flex items-center gap-0.5 sm:gap-1 group/owlvision flex-shrink-0 self-center">
                  {showHolderBadge && (
                    <span
                      className="inline-flex items-center justify-center rounded-full bg-emerald-500/15 border border-emerald-500/50 text-emerald-400 p-0.5"
                      title="Hosted by an Owltopia (Owl NFT) holder — 3% platform fee on tickets"
                      role="img"
                      aria-label="Owl holder"
                    >
                      <BadgeCheck className="h-2.5 w-2.5 sm:h-3 sm:w-3 flex-shrink-0" />
                    </span>
                  )}
                  {showPartnerBadge && (
                    <span
                      className="inline-flex items-center justify-center rounded-full bg-violet-500/15 border border-violet-500/50 text-violet-200 p-0.5"
                      title={partnerBadgeTitle}
                      role="img"
                      aria-label={partnerBadgeAria}
                    >
                      <Users className="h-2.5 w-2.5 sm:h-3 sm:w-3 flex-shrink-0" />
                    </span>
                  )}
                  <OwlVisionBadge
                    score={owlVisionScore}
                    className="!gap-1 !px-1.5 !py-0 !text-[10px] sm:!text-[11px] !leading-none [&_svg]:!h-2.5 [&_svg]:!w-2.5 sm:[&_svg]:!h-3 sm:[&_svg]:!w-3"
                  />
                  {profitInfo && shouldShowRevenueFlexPublic(profitInfo) && section === 'active' && (
                    <span
                      className="inline-flex items-center justify-center gap-0.5 rounded-full border border-emerald-500/45 bg-emerald-500/15 px-1 py-0.5 text-[9px] sm:text-[10px] font-semibold uppercase leading-none tracking-wide text-emerald-200"
                      title={
                        profitInfo.floorComparisonValue != null
                          ? 'Ticket revenue is above the listed floor price for this prize.'
                          : 'Ticket revenue is past the platform revenue bar (e.g. draw minimum or prize value).'
                      }
                    >
                      <Trophy className="h-2.5 w-2.5 sm:h-2.5 sm:w-2.5" aria-hidden />
                      Flex
                    </span>
                  )}
                </div>
              </div>
            <div className="flex flex-wrap items-center gap-x-2 sm:gap-x-3 gap-y-0.5 text-[11px] leading-tight mb-0.5 sm:mb-1 mt-0">
              {raffle.prize_amount != null && raffle.prize_amount > 0 && raffle.prize_currency && (
                <span className="inline-flex items-center gap-1">
                  <span className="text-muted-foreground">Prize: </span>
                  <span className="font-semibold inline-flex items-center gap-1">
                    {raffle.prize_amount} {raffle.prize_currency}
                    {(() => {
                      const u = raffle.prize_currency?.trim().toUpperCase() ?? ''
                      const showPrizeIcon =
                        u === 'SOL' ||
                        u === 'USDC' ||
                        u === 'OWL' ||
                        (u.length > 0 && getPartnerPrizeTokenByCurrency(u) != null)
                      return showPrizeIcon ? (
                        <CurrencyIcon currency={u || 'OWL'} size={12} className="inline-block" />
                      ) : null
                    })()}
                  </span>
                </span>
              )}
              <span className="flex items-center gap-1">
                <span className="text-muted-foreground">Price: </span>
                <span className="font-semibold flex items-center gap-1">
                  {raffleAcceptsSolAndBambooTickets(raffle) ? (
                    formatRaffleTicketPriceSummary(raffle)
                  ) : (
                    <>
                      {raffle.ticket_price} {raffle.currency}
                      <CurrencyIcon
                        currency={raffle.currency as 'SOL' | 'USDC' | 'OWL' | 'BAMBOO'}
                        size={12}
                        className="inline-block"
                      />
                    </>
                  )}
                </span>
              </span>
              {totalTicketsSold > 0 && (
                <span>
                  <span className="text-muted-foreground">Entries: </span>
                  <span className="font-semibold">{totalTicketsSold}</span>
                </span>
              )}
            </div>
                </LinkifiedTextInsideLinkProvider>
              </Link>
              <div className="relative z-10 mt-auto flex flex-wrap items-center gap-x-1 gap-y-1 min-w-0 px-1.5 pb-1.5 pt-0.5 sm:px-2 sm:pb-2 sm:pt-1 [&_a]:relative [&_a]:z-20">
                <Link
                  href={smallRaffleHref}
                  className="inline-flex min-w-0 flex-1 flex-wrap items-center gap-x-1 gap-y-1"
                  onClick={(e) => handleLinkClick(e)}
                >
                  <span className="text-[11px] text-foreground/75 dark:text-muted-foreground min-w-0 max-sm:truncate max-sm:leading-snug">
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
                  <RaffleDeadlineExtensionBadge count={raffle.time_extension_count} compact />
                  {section !== 'active' && (
                    <Badge
                      variant={(isFuture || isActive || isPendingDraft) ? 'default' : 'secondary'}
                      className={`rounded-full text-[9px] sm:text-[10px] min-h-[22px] inline-flex items-center px-1.5 py-0.5 ${statusBadgeClass}`}
                    >
                      {statusLabel}
                    </Badge>
                  )}
                  {creatorModerationFlag && (
                    <CreatorModerationBuyerWarning raffle={raffle} variant="badge" />
                  )}
                </Link>
              </div>
            {!isActive && !isFuture && raffle.winner_wallet && (
              <Link
                href={smallRaffleHref}
                className="relative z-10 mt-1 flex items-center gap-1 border-t border-border/40 px-1.5 pt-1 min-w-0 sm:mt-1.5 sm:px-2 sm:pt-1.5"
                onClick={(e) => handleLinkClick(e)}
              >
                <Trophy className="h-2.5 w-2.5 sm:h-3 sm:w-3 flex-shrink-0 text-yellow-500" />
                <span className="truncate text-[11px] text-muted-foreground min-w-0">
                  Winner:{' '}
                  {winnerDisplayName ? (
                    <span className="font-semibold text-foreground">{winnerDisplayName}</span>
                  ) : (
                    <span className="font-mono font-semibold text-foreground">
                      {raffle.winner_wallet.slice(0, 6)}…{raffle.winner_wallet.slice(-4)}
                    </span>
                  )}
                </span>
              </Link>
            )}
            </div>
            </div>
            </div>
        </Card>
      {isAdmin && (
        <>
          <Dialog open={imageModalOpen} onOpenChange={setImageModalOpen}>
            <DialogContent className="max-w-5xl w-full p-0">
              {imageAttemptChain.length > 0 && modalImgIdx < imageAttemptChain.length ? (
                <div className="!relative w-full h-[80vh] min-h-[500px]">
                  <Image
                    key={`modal-${modalImgIdx}-${imageAttemptChain[modalImgIdx]}`}
                    src={imageAttemptChain[modalImgIdx]}
                    alt={raffle.title}
                    fill
                    sizes="100vw"
                    className="object-contain"
                    priority={priority}
                    onError={() => setModalImgIdx((i) => i + 1)}
                    unoptimized={raffleImageUnoptimized(imageAttemptChain[modalImgIdx])}
                  />
                </div>
              ) : (
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
      content: 'text-sm',
      footer: 'text-xs',
      badge: 'text-xs',
    },
    large: {
      title: 'text-xl',
      content: 'text-base',
      footer: 'text-sm',
      badge: 'text-sm',
    },
  }

  const displaySize = size === 'medium' ? 'medium' : 'large'
  const classes = sizeClasses[displaySize]
  const mediumRaffleHref = `/raffles/${raffle.slug}`

  return (
    <div
      className="relative z-10 flex h-full min-h-0 flex-col md:hover:z-50"
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
    >
        <Card
          className={`raffle-card-modern relative ${getThemeAccentClasses(raffle.theme_accent)} flex h-full min-h-0 flex-col rounded-[1.25rem] hover:scale-[1.02] cursor-pointer p-0 ${isWinner ? 'ring-4 ring-yellow-400 ring-offset-2 winner-golden-card' : ''} ${userHasEntered && !isWinner ? 'raffle-entered-card' : ''}`}
          style={cardSurfaceStyle}
        >
          {/* Inner clip: keep overflow off the shadowed shell so theme / entered glow is not cut to a hard box */}
          <div className="relative z-0 flex min-h-0 flex-1 flex-col overflow-hidden rounded-[1.25rem]">
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
          {!listThumbDead && (
            <>
            <Link
              href={mediumRaffleHref}
              className="block min-h-0 w-full shrink-0 rounded-t-[1.25rem] focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              onClick={(e) => handleLinkClick(e, isFuture)}
            >
              <LinkifiedTextInsideLinkProvider>
            <div className="!relative z-10 m-0 flex aspect-square w-full min-h-0 items-center justify-center overflow-hidden rounded-t-[1.25rem] bg-muted p-0">
              {listThumbMintLoading ? (
                <div className="absolute inset-0 flex items-center justify-center bg-muted/60 z-20" aria-hidden>
                  <Loader2 className="h-10 w-10 animate-spin text-muted-foreground" />
                </div>
              ) : (
                /* eslint-disable-next-line @next/next/no-img-element -- card hero: reliable onError through fallback chain */
                <img
                  key={`card-${thumbIdx}-${listThumbSrc}`}
                  src={listThumbSrc}
                  alt={raffle.title}
                  loading={priority ? 'eager' : 'lazy'}
                  decoding="async"
                  className={`absolute inset-0 h-full w-full ${listThumbUseContain ? 'object-contain p-2' : 'object-cover object-center'}`}
                  onError={handleThumbLoadOrError}
                  onLoad={handleThumbLoadOrError}
                />
              )}
              {/* Metadata overlay on image */}
              <div 
                className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent opacity-0 [@media(hover:hover)_and_(pointer:fine)]:hover:opacity-100 transition-opacity z-10 cursor-pointer"
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  setImageModalOpen(true)
                }}
              >
                <div className="absolute bottom-0 left-0 right-0 p-4">
                  <div className="flex justify-end mb-2">
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
                      {showPartnerBadge && (
                        <span
                          className="inline-flex items-center justify-center rounded-full bg-violet-500/15 border border-violet-500/50 text-violet-200 p-0.5"
                          title={partnerBadgeTitle}
                          role="img"
                          aria-label={partnerBadgeAria}
                        >
                          <Users className="h-3.5 w-3.5 flex-shrink-0" />
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
                      {raffleAcceptsSolAndBambooTickets(raffle) ? (
                        formatRaffleTicketPriceSummary(raffle)
                      ) : (
                        <>
                          {raffle.ticket_price} {raffle.currency}
                          <CurrencyIcon
                            currency={raffle.currency as 'SOL' | 'USDC' | 'OWL' | 'BAMBOO'}
                            size={16}
                            className="inline-block flex-shrink-0"
                          />
                        </>
                      )}
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
                      {creatorModerationFlag && (
                        <CreatorModerationBuyerWarning raffle={raffle} variant="badge" />
                      )}
                      <RaffleDeadlineExtensionBadge count={raffle.time_extension_count} compact onImageOverlay />
                    </div>
                  )}
                  {section === 'active' && (
                    <div className="flex flex-col items-end gap-1 transition-opacity duration-200 group-hover/owlvision:opacity-30" style={{ zIndex: 1 }}>
                      {creatorModerationFlag && (
                        <CreatorModerationBuyerWarning raffle={raffle} variant="badge" />
                      )}
                      <RaffleDeadlineExtensionBadge count={raffle.time_extension_count} compact onImageOverlay />
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
              </LinkifiedTextInsideLinkProvider>
            </Link>
            </>
          )}
          {/* Fallback if no usable image */}
          {listThumbDead && (
            <>
              <Link href={mediumRaffleHref} className="block min-h-0" onClick={(e) => handleLinkClick(e, isFuture)}>
                <LinkifiedTextInsideLinkProvider>
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
                    {showPartnerBadge && (
                      <span
                        className="inline-flex items-center justify-center rounded-full bg-violet-500/15 border border-violet-500/50 text-violet-200 p-0.5"
                        title={partnerBadgeTitle}
                        role="img"
                        aria-label={partnerBadgeAria}
                      >
                        <Users className="h-3 w-3 flex-shrink-0" />
                      </span>
                    )}
                    <OwlVisionBadge score={owlVisionScore} />
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-4 pt-0">
                <div className={classes.content}>
                  {raffle.prize_amount != null && raffle.prize_amount > 0 && raffle.prize_currency && (
                    <div className="flex justify-between items-center gap-2">
                      <span className="text-muted-foreground">Prize</span>
                      <span className="font-semibold inline-flex items-center gap-1.5">
                        {raffle.prize_amount} {raffle.prize_currency}
                        {(() => {
                          const u = raffle.prize_currency?.trim().toUpperCase() ?? ''
                          const showPrizeIcon =
                            u === 'SOL' ||
                            u === 'USDC' ||
                            u === 'OWL' ||
                            (u.length > 0 && getPartnerPrizeTokenByCurrency(u) != null)
                          return showPrizeIcon ? (
                            <CurrencyIcon currency={u || 'OWL'} size={16} className="inline-block" />
                          ) : null
                        })()}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Ticket Price</span>
                    <span className="font-semibold flex items-center gap-1.5 text-right">
                      {raffleAcceptsSolAndBambooTickets(raffle) ? (
                        formatRaffleTicketPriceSummary(raffle)
                      ) : (
                        <>
                          {raffle.ticket_price} {raffle.currency}
                          <CurrencyIcon
                            currency={raffle.currency as 'SOL' | 'USDC' | 'OWL' | 'BAMBOO'}
                            size={16}
                            className="inline-block"
                          />
                        </>
                      )}
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
              </LinkifiedTextInsideLinkProvider>
              </Link>
              <CardFooter className={`flex flex-col ${classes.footer} p-4`}>
                <div className={`w-full flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5 ${displaySize === 'large' ? 'text-sm' : 'text-xs'} text-foreground/75 dark:text-muted-foreground`}>
                  <Link
                    href={mediumRaffleHref}
                    className="inline-flex min-w-0 flex-1 flex-wrap items-center gap-1.5"
                    onClick={(e) => handleLinkClick(e, isFuture)}
                  >
                    <span className="min-w-0">
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
                    <RaffleDeadlineExtensionBadge count={raffle.time_extension_count} compact />
                  </Link>
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
                  <Link
                    href={mediumRaffleHref}
                    className={`mt-2 flex w-full items-center gap-2 border-t pt-2 ${displaySize === 'large' ? 'text-sm' : 'text-xs'}`}
                    onClick={(e) => handleLinkClick(e, isFuture)}
                  >
                    <Trophy className={`${displaySize === 'large' ? 'h-4 w-4' : 'h-3 w-3'} flex-shrink-0 text-yellow-500`} />
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
                  </Link>
                )}
                {!showQuickBuy && (
                  <>
                    <Button 
                      type="button"
                      className={`w-full touch-manipulation min-h-[44px] text-base sm:text-sm ${purchasesBlocked ? 'bg-muted text-muted-foreground cursor-not-allowed opacity-70' : ''}`}
                      size={displaySize === 'large' ? 'lg' : 'default'}
                      onClick={handleToggleQuickBuy}
                      disabled={!isActive || isFuture || purchasesBlocked || viewerIsCreator || (availableTickets !== null && availableTickets <= 0)}
                    >
                      {isFuture ? 'Starts Soon' : (isActive ? (purchasesBlocked ? 'Purchases Blocked' : viewerIsCreator ? 'Your Raffle' : availableTickets !== null && availableTickets <= 0 ? 'Sold Out' : 'Enter Raffle') : 'View Details')}
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
                    <RafflePromoPngButton
                      title={raffle.title}
                      slug={raffle.slug}
                      ticketPrice={raffle.ticket_price}
                      currency={raffle.currency}
                      endTime={raffle.end_time}
                      imageUrl={listThumbDead ? null : listThumbSrc}
                      imageAttemptUrls={listThumbDead ? [] : promoPngImageAttemptUrls}
                      imageFallbackUrl={raffle.image_fallback_url}
                      buttonLabel="Download PNG for X"
                    />
                    <ReferralComplimentaryHint
                      variant="compact"
                      className="mt-2"
                      walletAddress={wallet || undefined}
                      show={
                        isActive &&
                        !isFuture &&
                        !purchasesBlocked &&
                        (availableTickets === null || availableTickets > 0) &&
                        !userHasEntered
                      }
                    />
                  </>
                )}
                {showQuickBuy && isActive && !isFuture && !purchasesBlocked && (
            <div className="w-full space-y-3 pt-2">
              {profitInfo && shouldShowRevenueFlexPublic(profitInfo) && (
                <div
                  className="relative z-20 w-full"
                  onClick={(e) => e.stopPropagation()}
                >
                  <RaffleOverThresholdPngButton
                    title={raffle.title}
                    slug={raffle.slug}
                    ticketPrice={raffle.ticket_price}
                    currency={raffle.currency}
                    endTime={raffle.end_time}
                    imageUrl={listThumbDead ? null : listThumbSrc}
                    imageAttemptUrls={listThumbDead ? [] : promoPngImageAttemptUrls}
                    imageFallbackUrl={raffle.image_fallback_url}
                    metaLines={buildOverThresholdFlexMetaLines(raffle, profitInfo)}
                    promoChipText={revenueFlexPromoChipUppercase(profitInfo)}
                    buttonLabel="Download flex PNG (social)"
                  />
                </div>
              )}
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
                  max={quantityInputMax}
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
              <ReferralComplimentaryHint
                variant="dialog"
                walletAddress={wallet || undefined}
                show={
                  ticketQuantity === 1 &&
                  !userHasEntered &&
                  (availableTickets === null || availableTickets > 0)
                }
              />
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
              {ticketsConfirming && (
                <div className="p-2 rounded-lg bg-amber-500/10 border border-amber-500/40 text-amber-200 text-xs">
                  {TICKETS_CONFIRMING_MESSAGE}
                </div>
              )}
              {success && (
                <div className="p-2 rounded-lg bg-green-500/10 border border-green-500 text-green-500 text-xs">
                  Tickets purchased successfully!
                </div>
              )}
              {cartAddedHint && (
                <div className="p-2 rounded-lg bg-blue-500/10 border border-blue-500/40 text-blue-200 text-xs flex items-center gap-2">
                  <ShoppingCart className="h-4 w-4 shrink-0" aria-hidden />
                  Added to cart — open cart in the header to checkout multiple raffles.
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
                  type="button"
                  variant="secondary"
                  onClick={handleAddToCart}
                  disabled={
                    (availableTickets !== null && availableTickets <= 0) ||
                    !connected ||
                    isProcessing
                  }
                  className="flex-1 touch-manipulation min-h-[44px] text-base sm:text-sm gap-1.5"
                >
                  <ShoppingCart className="h-4 w-4 shrink-0" aria-hidden />
                  Cart
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
          </div>
        </Card>
    {isAdmin && (
      <>
        <Dialog open={imageModalOpen} onOpenChange={setImageModalOpen}>
          <DialogContent className="max-w-5xl w-full p-0">
            {imageAttemptChain.length > 0 && modalImgIdx < imageAttemptChain.length ? (
              <div className="relative w-full h-[80vh] min-h-[500px]">
                <Image
                  key={`modal-lg-${modalImgIdx}-${imageAttemptChain[modalImgIdx]}`}
                  src={imageAttemptChain[modalImgIdx]}
                  alt={raffle.title}
                  fill
                  sizes="100vw"
                  className="object-contain"
                  priority={priority}
                  onError={() => setModalImgIdx((i) => i + 1)}
                  unoptimized={raffleImageUnoptimized(imageAttemptChain[modalImgIdx])}
                />
              </div>
            ) : (
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
