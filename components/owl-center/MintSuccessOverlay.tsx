'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, ExternalLink, Loader2 } from 'lucide-react'

import { DeployButton } from '@/components/owl-center/DeployButton'
import { fireMintConfetti, preloadConfetti } from '@/lib/confetti'
import { buildOwlCenterHubCardImageChain } from '@/lib/owl-center/hub-card-image-url'

export type MintSuccessOverlayProps = {
  open: boolean
  /** How many NFTs were minted in this session. */
  quantity: number
  /** All mint addresses from this session — swipe between them when quantity > 1. */
  mintAddresses?: string[]
  /** @deprecated Prefer mintAddresses */
  mintAddress?: string | null
  /** Prefer mainnet Helius lookup when minting on mainnet. */
  preferMainnet?: boolean
  transactionSignature: string
  explorerUrl: string
  onClose: () => void
}

const CONFETTI_PIECES = [
  { left: '12%', delay: '0ms', drift: '-18px', spin: '220deg', color: '#00FF9C' },
  { left: '22%', delay: '40ms', drift: '12px', spin: '-160deg', color: '#00C97A' },
  { left: '34%', delay: '20ms', drift: '-8px', spin: '140deg', color: '#7DFFB8' },
  { left: '48%', delay: '60ms', drift: '16px', spin: '-200deg', color: '#00FF9C' },
  { left: '58%', delay: '10ms', drift: '-14px', spin: '190deg', color: '#00E58B' },
  { left: '68%', delay: '50ms', drift: '10px', spin: '-130deg', color: '#00FF9C' },
  { left: '78%', delay: '30ms', drift: '-20px', spin: '240deg', color: '#7DFFB8' },
  { left: '88%', delay: '70ms', drift: '8px', spin: '-170deg', color: '#00C97A' },
] as const

type MintRevealCardProps = {
  mint: string
  preferMainnet: boolean
  active: boolean
  onArtworkLoaded: () => void
}

function MintRevealCard({ mint, preferMainnet, active, onArtworkLoaded }: MintRevealCardProps) {
  const [imageLoading, setImageLoading] = useState(false)
  const [resolvedName, setResolvedName] = useState<string | null>(null)
  const [imageAttemptIdx, setImageAttemptIdx] = useState(0)
  const [imageAttemptChain, setImageAttemptChain] = useState<string[]>([])
  const [artworkLoaded, setArtworkLoaded] = useState(false)

  useEffect(() => {
    if (!active || !mint) {
      setImageLoading(false)
      setResolvedName(null)
      setImageAttemptIdx(0)
      setImageAttemptChain([])
      setArtworkLoaded(false)
      return
    }

    let cancelled = false
    setImageLoading(true)
    setResolvedName(null)
    setImageAttemptIdx(0)
    setImageAttemptChain([])
    setArtworkLoaded(false)

    const qs = preferMainnet ? '&preferMainnet=1' : ''
    fetch(`/api/nft/metadata-image?mint=${encodeURIComponent(mint)}${qs}`, { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((json: { image?: string | null; name?: string | null } | null) => {
        if (cancelled) return
        const raw = json?.image?.trim()
        const name = json?.name?.trim()
        if (name) setResolvedName(name)
        if (!raw) {
          setImageAttemptChain([])
          return
        }
        setImageAttemptChain(buildOwlCenterHubCardImageChain(raw, { includeFallback: false }))
      })
      .catch(() => {
        if (!cancelled) setImageAttemptChain([])
      })
      .finally(() => {
        if (!cancelled) setImageLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [active, mint, preferMainnet])

  const currentImageSrc = imageAttemptChain[imageAttemptIdx] ?? null
  const imageSrcKey = `${imageAttemptIdx}:${imageAttemptChain[imageAttemptIdx] ?? ''}`

  useEffect(() => {
    setArtworkLoaded(false)
  }, [imageSrcKey])

  useEffect(() => {
    if (artworkLoaded) onArtworkLoaded()
  }, [artworkLoaded, onArtworkLoaded])

  useEffect(() => {
    if (!active || !mint) return
    if (!imageLoading && !currentImageSrc) {
      const timer = window.setTimeout(onArtworkLoaded, 250)
      return () => window.clearTimeout(timer)
    }
  }, [active, mint, imageLoading, currentImageSrc, onArtworkLoaded])

  const scanning = Boolean(mint && (imageLoading || (currentImageSrc && !artworkLoaded)))

  return (
    <div className="min-w-full w-full shrink-0 snap-center px-1">
      <div
        className={`mx-auto w-full max-w-[240px] overflow-hidden border border-[#00FF9C]/35 bg-[#0B0F13] shadow-[0_0_28px_rgba(0,255,156,0.18)] mint-reveal-card ${
          scanning ? 'mint-reveal-card--scanning' : ''
        }`}
      >
        <div className="relative aspect-square w-full">
          {imageLoading ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-4 text-center">
              <Loader2 className="h-9 w-9 animate-spin text-[#00FF9C]" aria-hidden />
              <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#00FF9C]">Locating artwork</p>
              <p className="font-mono text-[10px] text-[#5C6773]">
                {mint.slice(0, 4)}…{mint.slice(-4)}
              </p>
            </div>
          ) : currentImageSrc ? (
            <>
              <img
                key={imageSrcKey}
                src={currentImageSrc}
                alt={resolvedName ? `${resolvedName} artwork` : 'Minted NFT artwork'}
                className={
                  artworkLoaded
                    ? 'mint-reveal-art h-full w-full object-cover'
                    : 'pointer-events-none absolute inset-0 h-full w-full object-cover opacity-0'
                }
                ref={(node) => {
                  if (node?.complete && node.naturalWidth > 0) {
                    setArtworkLoaded(true)
                  }
                }}
                onLoad={() => setArtworkLoaded(true)}
                onError={() =>
                  setImageAttemptIdx((idx) => (idx + 1 < imageAttemptChain.length ? idx + 1 : idx))
                }
              />
              {!artworkLoaded ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-4 text-center">
                  <Loader2 className="h-9 w-9 animate-spin text-[#00FF9C]" aria-hidden />
                  <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#00FF9C]">
                    Decrypting metadata
                  </p>
                </div>
              ) : (
                <>
                  <div className="mint-reveal-shine" aria-hidden />
                  <span className="mint-reveal-badge absolute bottom-2 left-2 border border-[#00FF9C]/50 bg-[#0B0F13]/85 px-2 py-1 font-mono text-[9px] font-bold uppercase tracking-[0.24em] text-[#00FF9C]">
                    Minted
                  </span>
                </>
              )}
            </>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
              <p className="font-mono text-[10px] uppercase tracking-widest text-[#9BA8B4]">
                Artwork loading in wallet
              </p>
            </div>
          )}
        </div>
      </div>
      {resolvedName ? (
        <p className="mt-2 truncate px-2 font-mono text-[11px] text-[#C5D0D8]" title={resolvedName}>
          {resolvedName}
        </p>
      ) : null}
    </div>
  )
}

export function MintSuccessOverlay({
  open,
  quantity,
  mintAddresses,
  mintAddress,
  preferMainnet = false,
  transactionSignature,
  explorerUrl,
  onClose,
}: MintSuccessOverlayProps) {
  const mints = useMemo(() => {
    const fromList = (mintAddresses ?? []).map((m) => m.trim()).filter(Boolean)
    if (fromList.length > 0) return fromList
    const single = mintAddress?.trim()
    return single ? [single] : []
  }, [mintAddresses, mintAddress])

  const scrollRef = useRef<HTMLDivElement>(null)
  const [activeIndex, setActiveIndex] = useState(0)
  const [activeArtLoaded, setActiveArtLoaded] = useState(false)
  const [revealComplete, setRevealComplete] = useState(false)

  const n = Math.max(1, quantity, mints.length)
  const multi = mints.length > 1

  const scrollToIndex = useCallback((idx: number) => {
    const el = scrollRef.current
    if (!el) return
    const clamped = Math.max(0, Math.min(idx, mints.length - 1))
    const slide = el.children[clamped] as HTMLElement | undefined
    slide?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
    setActiveIndex(clamped)
    setActiveArtLoaded(false)
  }, [mints.length])

  useEffect(() => {
    if (!open || mints.length === 0) return
    const qs = preferMainnet ? '&preferMainnet=1' : ''
    for (const mint of mints) {
      void fetch(`/api/nft/metadata-image?mint=${encodeURIComponent(mint)}${qs}`, { cache: 'no-store' }).catch(() => {})
    }
  }, [open, mints, preferMainnet])

  useEffect(() => {
    if (!open) {
      setActiveIndex(0)
      setActiveArtLoaded(false)
      setRevealComplete(false)
      return
    }
    setActiveIndex(0)
    setActiveArtLoaded(false)
    setRevealComplete(true)
    scrollRef.current?.scrollTo({ left: 0 })
    preloadConfetti()
    fireMintConfetti()
  }, [open, mints.join(',')])

  const onScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el || mints.length <= 1) return
    const slideWidth = el.clientWidth
    if (slideWidth <= 0) return
    const idx = Math.round(el.scrollLeft / slideWidth)
    if (idx !== activeIndex) {
      setActiveIndex(idx)
      setActiveArtLoaded(false)
    }
  }, [activeIndex, mints.length])

  const handleActiveArtLoaded = useCallback(() => {
    setActiveArtLoaded(true)
  }, [])

  if (!open) return null

  const heading = multi
    ? `You minted ${n} NFTs!`
    : revealComplete
      ? 'You minted your NFT!'
      : 'Revealing your mint…'

  return (
    <div
      className="mint-reveal-backdrop fixed inset-0 z-[200] flex items-center justify-center bg-[#0B0F14]/92 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] backdrop-blur-sm"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="mint-success-overlay-title"
    >
      <div className="mint-reveal-dialog relative w-full max-w-md space-y-4 overflow-hidden border border-[#1A222B] bg-[#0F1419] p-6 text-center shadow-[0_0_40px_rgba(0,255,156,0.12)]">
        {revealComplete ? (
          <div className="pointer-events-none absolute inset-x-0 top-0 h-32 overflow-hidden" aria-hidden>
            {CONFETTI_PIECES.map((piece, index) => (
              <span
                key={index}
                className="mint-reveal-confetti-piece"
                style={{
                  left: piece.left,
                  backgroundColor: piece.color,
                  animationDelay: piece.delay,
                  ['--mint-confetti-drift' as string]: piece.drift,
                  ['--mint-confetti-spin' as string]: piece.spin,
                }}
              />
            ))}
          </div>
        ) : null}

        {mints.length > 0 ? (
          <div className="relative mx-auto w-full max-w-[260px]">
            {multi ? (
              <>
                <button
                  type="button"
                  aria-label="Previous NFT"
                  disabled={activeIndex <= 0}
                  onClick={() => scrollToIndex(activeIndex - 1)}
                  className="absolute left-0 top-[calc(50%-1.25rem)] z-10 flex h-11 w-11 -translate-y-1/2 touch-manipulation items-center justify-center rounded-full border border-[#1A222B] bg-[#0B0F14]/90 text-[#00FF9C] disabled:opacity-30"
                >
                  <ChevronLeft className="h-5 w-5" aria-hidden />
                </button>
                <button
                  type="button"
                  aria-label="Next NFT"
                  disabled={activeIndex >= mints.length - 1}
                  onClick={() => scrollToIndex(activeIndex + 1)}
                  className="absolute right-0 top-[calc(50%-1.25rem)] z-10 flex h-11 w-11 -translate-y-1/2 touch-manipulation items-center justify-center rounded-full border border-[#1A222B] bg-[#0B0F14]/90 text-[#00FF9C] disabled:opacity-30"
                >
                  <ChevronRight className="h-5 w-5" aria-hidden />
                </button>
              </>
            ) : null}

            <div
              ref={scrollRef}
              onScroll={onScroll}
              className={`flex overflow-x-auto scroll-smooth touch-pan-x ${
                multi ? 'snap-x snap-mandatory scrollbar-none' : 'justify-center'
              }`}
              style={{ WebkitOverflowScrolling: 'touch' }}
              aria-roledescription={multi ? 'carousel' : undefined}
              aria-label={multi ? 'Minted NFTs' : undefined}
            >
              {mints.map((mint, idx) => (
                <MintRevealCard
                  key={mint}
                  mint={mint}
                  preferMainnet={preferMainnet}
                  active={idx === activeIndex || !multi}
                  onArtworkLoaded={idx === activeIndex || !multi ? handleActiveArtLoaded : () => {}}
                />
              ))}
            </div>

            {multi ? (
              <div className="mt-3 flex flex-col items-center gap-2">
                <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#9BA8B4]">
                  Swipe to see each NFT · {activeIndex + 1} / {mints.length}
                </p>
                <div className="flex items-center justify-center gap-2" role="tablist" aria-label="NFT slides">
                  {mints.map((mint, idx) => (
                    <button
                      key={mint}
                      type="button"
                      role="tab"
                      aria-selected={idx === activeIndex}
                      aria-label={`NFT ${idx + 1} of ${mints.length}`}
                      onClick={() => scrollToIndex(idx)}
                      className={`h-2.5 min-w-[10px] touch-manipulation rounded-full transition-all ${
                        idx === activeIndex ? 'w-6 bg-[#00FF9C]' : 'w-2.5 bg-[#1A222B]'
                      }`}
                    />
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          <div
            className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[#00FF9C]/15 text-[#00FF9C]"
            aria-hidden
          >
            <span className="font-mono text-lg font-bold text-[#00FF9C]">✓</span>
          </div>
        )}

        <h2
          id="mint-success-overlay-title"
          className={`text-lg font-semibold text-[#E8EEF2] ${revealComplete ? 'mint-reveal-copy' : ''}`}
        >
          {heading}
        </h2>

        {revealComplete ? (
          <>
            <p className="mint-reveal-copy mint-reveal-copy-delay-1 text-sm leading-relaxed text-[#9BA8B4]">
              Your NFT{n === 1 ? '' : 's'} {n === 1 ? 'is' : 'are'} now in your connected wallet.
              {mints.length > 0
                ? ' Phantom and Solflare usually catch up within a few seconds.'
                : ' Open Phantom or Solflare and check Collectibles.'}{' '}
              If you don&apos;t see {n === 1 ? 'it' : 'them'} yet, pull to refresh in your wallet app.
            </p>
            <a
              href={explorerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mint-reveal-copy mint-reveal-copy-delay-2 flex min-h-[44px] w-full touch-manipulation items-center justify-center gap-2 border border-[#1A222B] bg-[#0B0F14] px-4 font-mono text-xs uppercase tracking-widest text-[#00FF9C] hover:border-[#00FF9C]/40"
            >
              <ExternalLink className="h-4 w-4 shrink-0" aria-hidden />
              View transaction
            </a>
            <p
              className="mint-reveal-copy mint-reveal-copy-delay-2 font-mono text-[10px] text-[#5C6773] break-all"
              title={transactionSignature}
            >
              {transactionSignature.slice(0, 8)}…{transactionSignature.slice(-8)}
            </p>
            <DeployButton className="mint-reveal-copy mint-reveal-copy-delay-3 w-full" onClick={onClose}>
              Done
            </DeployButton>
          </>
        ) : (
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-[#5C6773]">Hold tight — almost there</p>
        )}
      </div>
    </div>
  )
}
