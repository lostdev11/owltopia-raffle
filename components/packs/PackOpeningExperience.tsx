'use client'

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import Image from 'next/image'
import Link from 'next/link'
import { CheckCircle2, Coins, ImageIcon, Sparkles, Ticket } from 'lucide-react'
import type { PackOpenClientResult } from '@/lib/client/execute-pack-purchase'
import {
  PACK_ANIMATION_POSTER,
  PACK_ANIMATIONS,
  PACK_REVEAL_TIMING,
  getPackCategoryReveal,
} from '@/lib/packs/animations'
import { PackHoverClip } from '@/components/packs/PackHoverVideo'
import { fireMintConfetti } from '@/lib/confetti'
import { cn } from '@/lib/utils'

export type PackOpeningStage =
  | 'hovering'
  | 'ready'
  | 'opening'
  | 'whiteTransition'
  | 'revealing'
  | 'complete'

export type PackOpeningExperienceProps = {
  reward: PackOpenClientResult
  onComplete?: () => void
  /** Dev / preview: start at a specific stage. Production defaults to hovering + Open pack. */
  initialStage?: PackOpeningStage
  /**
   * When true (default), purchased pack hovers until the user taps Open pack.
   * Set false for the opening-only / reveal-only previews.
   */
  includeHoverGate?: boolean
  /** Dev: loop hovering only — no Open pack, no opening clip. */
  hoverOnly?: boolean
  className?: string
}

function categoryLabel(category: string) {
  if (category === 'jackpot') return 'Jackpot'
  if (category === 'sol') return 'SOL'
  if (category === 'nft') return 'NFT'
  return '$OWL'
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function preloadRewardImage(url: string | null | undefined): Promise<boolean> {
  if (!url) return Promise.resolve(true)
  return new Promise((resolve) => {
    const img = new window.Image()
    img.onload = () => resolve(true)
    img.onerror = () => resolve(false)
    img.src = url
  })
}

function PrizeArt({ reward }: { reward: PackOpenClientResult }) {
  if (reward.category === 'nft' && reward.nftImageUrl) {
    return (
      <Image
        src={reward.nftImageUrl}
        alt={reward.nftName || reward.prizeLabel}
        width={320}
        height={320}
        className="h-full w-full object-cover"
        unoptimized
        priority
      />
    )
  }
  if (reward.category === 'sol' || reward.category === 'jackpot') {
    return <Coins className="h-20 w-20 text-[#00FF9C]" aria-hidden />
  }
  if (reward.category === 'owl') {
    return <Sparkles className="h-20 w-20 text-[#00FF9C]" aria-hidden />
  }
  return <ImageIcon className="h-20 w-20 text-[#00FF9C]" aria-hidden />
}

/**
 * Fullscreen pack-open cinematic:
 * hovering + Open pack → opening clip (once) → pure white overlay → CSS reward reveal.
 */
export function PackOpeningExperience({
  reward,
  onComplete,
  initialStage,
  includeHoverGate = true,
  hoverOnly = false,
  className,
}: PackOpeningExperienceProps) {
  const openingRef = useRef<HTMLVideoElement | null>(null)
  const revealStartedRef = useRef(false)
  const whiteEnteredRef = useRef(false)
  const whiteReadyRef = useRef(false)
  const rewardReadyRef = useRef(false)
  const confettiFiredRef = useRef(false)
  const [reducedMotion] = useState(() => prefersReducedMotion())

  const [stage, setStage] = useState<PackOpeningStage>(() => {
    if (reducedMotion && !hoverOnly) return 'whiteTransition'
    if (initialStage) return initialStage
    return includeHoverGate ? 'hovering' : 'opening'
  })
  const [openFailed, setOpenFailed] = useState(false)
  const [hoverFailed, setHoverFailed] = useState(false)
  const [openClicked, setOpenClicked] = useState(false)
  const [whiteOpaque, setWhiteOpaque] = useState(() => reducedMotion && !hoverOnly)
  const [showReward, setShowReward] = useState(false)
  const [showName, setShowName] = useState(false)
  const [showMeta, setShowMeta] = useState(false)
  const [showControls, setShowControls] = useState(false)
  const [hoverReady, setHoverReady] = useState(false)

  const revealCfg = getPackCategoryReveal(reward.category)

  const beginRevealSequence = useCallback(() => {
    if (revealStartedRef.current) return
    if (!whiteReadyRef.current || !rewardReadyRef.current) return
    revealStartedRef.current = true
    setStage('revealing')
    setWhiteOpaque(true)

    const t = PACK_REVEAL_TIMING
    const enterDelay = reducedMotion ? 0 : t.rewardEnterDelayMs
    const nameDelay = reducedMotion ? 80 : t.nameAppearMs
    const metaDelay = reducedMotion ? 120 : t.metaAppearMs
    const controlsDelay = reducedMotion ? 160 : t.controlsAppearMs

    window.setTimeout(() => setWhiteOpaque(false), reducedMotion ? 0 : 40)
    window.setTimeout(() => setShowReward(true), enterDelay)
    window.setTimeout(() => {
      if (reducedMotion || confettiFiredRef.current) return
      confettiFiredRef.current = true
      fireMintConfetti()
    }, enterDelay + 80)
    window.setTimeout(() => setShowName(true), nameDelay)
    window.setTimeout(() => setShowMeta(true), metaDelay)
    window.setTimeout(() => {
      setShowControls(true)
      setStage('complete')
    }, controlsDelay)
  }, [reducedMotion])

  const tryStartReveal = useCallback(() => {
    beginRevealSequence()
  }, [beginRevealSequence])

  const enterWhiteTransition = useCallback(() => {
    if (whiteEnteredRef.current || revealStartedRef.current) return
    whiteEnteredRef.current = true
    setStage('whiteTransition')
    setWhiteOpaque(true)
    whiteReadyRef.current = true
    tryStartReveal()
  }, [tryStartReveal])

  // Preload reward image as soon as we have the reward
  useEffect(() => {
    let cancelled = false
    void preloadRewardImage(reward.nftImageUrl).then(() => {
      if (cancelled) return
      rewardReadyRef.current = true
      tryStartReveal()
    })
    const grace = window.setTimeout(() => {
      if (cancelled) return
      rewardReadyRef.current = true
      tryStartReveal()
    }, PACK_REVEAL_TIMING.rewardImageGraceMs)
    return () => {
      cancelled = true
      window.clearTimeout(grace)
    }
  }, [reward.nftImageUrl, tryStartReveal])

  // Reduced motion / failed open / whiteTransition entry
  useEffect(() => {
    if (hoverOnly) return
    if (stage !== 'whiteTransition') return
    whiteReadyRef.current = true
    tryStartReveal()
  }, [stage, hoverOnly, tryStartReveal])

  // Hover clip is WebM or animated WebP — mark ready as soon as the stage is shown
  useEffect(() => {
    if (stage !== 'hovering' && stage !== 'ready') return
    setHoverReady(true)
    setStage((s) => (s === 'hovering' ? 'ready' : s))
  }, [stage])

  // Never leave Open pack disabled if hover decode hangs
  useEffect(() => {
    if (hoverOnly) return
    if (stage !== 'hovering' && stage !== 'ready') return
    const id = window.setTimeout(() => {
      setHoverReady(true)
      setStage((s) => (s === 'hovering' ? 'ready' : s))
    }, PACK_REVEAL_TIMING.hoverReadyFallbackMs)
    return () => window.clearTimeout(id)
  }, [stage, hoverOnly])

  // Autoplay opening once
  useEffect(() => {
    if (stage !== 'opening') return
    if (reducedMotion) {
      enterWhiteTransition()
      return
    }
    const el = openingRef.current
    if (!el) {
      enterWhiteTransition()
      return
    }
    el.currentTime = 0
    const p = el.play()
    if (p && typeof p.then === 'function') {
      p.catch(() => {
        if (process.env.NODE_ENV === 'development') {
          console.warn('[packs] opening clip failed — white → reveal fallback')
        }
        setOpenFailed(true)
        enterWhiteTransition()
      })
    }
  }, [stage, enterWhiteTransition, reducedMotion])

  // Hung opening clip must not trap the user
  useEffect(() => {
    if (stage !== 'opening') return
    const el = openingRef.current
    const durationMs =
      el && Number.isFinite(el.duration) && el.duration > 0
        ? Math.min(el.duration * 1000 + 2500, PACK_REVEAL_TIMING.openFailsafeMs)
        : PACK_REVEAL_TIMING.openFailsafeMs
    const id = window.setTimeout(() => {
      if (process.env.NODE_ENV === 'development') {
        console.warn('[packs] opening clip timed out — revealing prize')
      }
      setOpenFailed(true)
      enterWhiteTransition()
    }, durationMs)
    return () => window.clearTimeout(id)
  }, [stage, enterWhiteTransition])

  useEffect(() => {
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const openEl = openingRef.current
    return () => {
      document.body.style.overflow = prevOverflow
      openEl?.pause()
    }
  }, [])

  function onOpenPack() {
    if (openClicked || hoverOnly) return
    setOpenClicked(true)
    setStage('opening')
  }

  function handleContinue() {
    onComplete?.()
  }

  const inHoverStages = stage === 'hovering' || stage === 'ready'
  const showVideoLayer =
    !reducedMotion &&
    (inHoverStages ||
      stage === 'opening' ||
      (stage === 'whiteTransition' && whiteOpaque))

  const showHoverLayer = includeHoverGate && (inHoverStages || stage === 'opening')
  const keepOpeningMounted =
    !hoverOnly &&
    !reducedMotion &&
    (includeHoverGate
      ? inHoverStages || stage === 'opening' || (stage === 'whiteTransition' && whiteOpaque && !openFailed)
      : stage === 'opening' || (stage === 'whiteTransition' && whiteOpaque && !openFailed))
  const openingVisible = stage === 'opening' || (stage === 'whiteTransition' && whiteOpaque && !openFailed)

  const overlay = (
    <div
      className={cn(
        'fixed inset-0 left-0 top-0 z-[9999] h-[100dvh] w-screen overflow-hidden overscroll-none bg-black',
        'touch-manipulation',
        className
      )}
      role="dialog"
      aria-modal="true"
      aria-label="Pack opening experience"
    >
      {/* Reveal environment (under white). Opaque so the page never shows through. */}
      <div className="absolute inset-0 flex flex-col bg-black">
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'radial-gradient(circle at center, rgba(0,255,156,0.18) 0%, rgba(0,255,156,0.06) 38%, transparent 62%)',
          }}
          aria-hidden
        />
        <div
          className={cn(
            'pointer-events-none absolute left-1/2 top-1/2 h-[min(70vw,420px)] w-[min(70vw,420px)]',
            'rounded-full border border-[#00FF9C]/30',
            reducedMotion ? '-translate-x-1/2 -translate-y-1/2' : '',
            showReward && !reducedMotion ? 'animate-pack-energy-spin' : ''
          )}
          style={{
            boxShadow: `0 0 ${40 * revealCfg.pulseStrength}px rgba(0,255,156,${revealCfg.ringOpacity * 0.45})`,
            opacity: showReward ? revealCfg.ringOpacity : 0,
            transition: reducedMotion ? 'opacity 200ms ease' : 'opacity 600ms ease',
          }}
          aria-hidden
        />
        <div
          className="pointer-events-none absolute left-1/2 top-1/2 h-[min(55vw,320px)] w-[min(55vw,320px)] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(0,255,156,0.2),transparent_70%)] blur-2xl"
          style={{
            opacity: showReward ? revealCfg.glowOpacity + 0.2 : 0,
            transition: reducedMotion ? 'opacity 200ms ease' : 'opacity 700ms ease',
          }}
          aria-hidden
        />

        <div
          className={cn(
            'relative z-[1] flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto',
            'px-4 pt-[max(1rem,env(safe-area-inset-top))]',
            showReward
              ? reducedMotion
                ? 'opacity-100'
                : 'animate-pack-reward-enter'
              : 'opacity-0'
          )}
          style={
            showReward && !reducedMotion
              ? ({
                  ['--pack-enter-scale' as string]: String(revealCfg.entranceScale),
                } as CSSProperties)
              : undefined
          }
        >
          <div className="relative aspect-square w-[min(64vw,min(240px,34dvh))]">
            <div
              className={cn(
                'relative flex h-full w-full items-center justify-center overflow-hidden rounded-2xl',
                'bg-gradient-to-b from-[#121816] to-[#070a08]',
                'ring-1 ring-[#00FF9C]/40',
                'shadow-[0_0_60px_-12px_rgba(0,255,156,0.65)]'
              )}
            >
              <PrizeArt reward={reward} />
            </div>
          </div>

          <p
            className={cn(
              'mt-4 text-[11px] font-semibold uppercase tracking-[0.32em] text-[#00FF9C]/85 transition-opacity duration-500',
              showName ? 'opacity-100' : 'opacity-0'
            )}
          >
            You revealed {categoryLabel(reward.category)}
          </p>
          <h2
            className={cn(
              'mt-1 font-display text-2xl tracking-[0.04em] text-white transition-opacity duration-500 sm:text-3xl',
              showName ? 'opacity-100' : 'opacity-0'
            )}
          >
            {reward.prizeLabel}
          </h2>

          <div
            className={cn(
              'mt-2 max-w-md space-y-1.5 text-center transition-opacity duration-500',
              showMeta ? 'opacity-100' : 'opacity-0'
            )}
          >
            <p className="text-sm leading-relaxed text-white/60">{reward.revealMessage}</p>
            {reward.category === 'nft' && reward.nftMint ? (
              <p className="font-mono text-[11px] text-white/40">
                {reward.nftMint.slice(0, 4)}…{reward.nftMint.slice(-4)}
              </p>
            ) : null}
            {reward.category === 'owl' && reward.freeTicketCredits > 0 ? (
              <p className="inline-flex items-center gap-2 rounded-full border border-[#00E58B]/25 bg-[#00E58B]/10 px-3 py-1.5 text-sm text-[#00FF9C]">
                <Ticket className="h-4 w-4" aria-hidden />
                {reward.freeTicketCredits} free raffle ticket
                {reward.freeTicketCredits === 1 ? '' : 's'} credited
              </p>
            ) : null}
          </div>
        </div>

        <div
          className={cn(
            'relative z-[4] flex w-full shrink-0 flex-col gap-3 px-4',
            'pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3',
            'sm:flex-row sm:justify-center',
            'transition-opacity duration-500',
            showControls ? 'opacity-100' : 'pointer-events-none opacity-0'
          )}
        >
          <button
            type="button"
            onClick={handleContinue}
            className="inline-flex min-h-[48px] min-w-[180px] items-center justify-center rounded-xl border border-[#00FF9C]/45 bg-transparent px-6 text-sm font-bold uppercase tracking-wider text-[#00FF9C] transition hover:bg-[#00FF9C]/10"
          >
            Continue
          </button>
          <Link
            href={`/packs/verify/${reward.openId}`}
            className="inline-flex min-h-[48px] min-w-[180px] items-center justify-center gap-2 rounded-xl bg-[#00FF9C] px-6 text-sm font-bold uppercase tracking-wider text-[#062016] transition hover:bg-[#7DFFB8]"
          >
            <CheckCircle2 className="h-4 w-4" aria-hidden />
            View item
          </Link>
        </div>
      </div>

      {/* Video layer */}
      {showVideoLayer ? (
        <div className="absolute inset-0 z-[2] flex items-center justify-center bg-black">
          <div className="relative flex h-[min(78dvh,720px)] w-[min(90vw,520px)] items-center justify-center">
            {showHoverLayer ? (
              hoverFailed ? (
                <div
                  className="flex min-h-[40dvh] items-center justify-center text-sm text-[#A9CBB9] transition-opacity ease-out"
                  style={{
                    transitionDuration: `${PACK_REVEAL_TIMING.videoCrossfadeMs}ms`,
                    opacity: stage === 'opening' ? 0 : 1,
                  }}
                >
                  Pack ready
                </div>
              ) : (
                <div
                  className="flex h-full w-full items-center justify-center transition-opacity ease-out"
                  style={{
                    transitionDuration: `${PACK_REVEAL_TIMING.videoCrossfadeMs}ms`,
                    opacity: stage === 'opening' ? 0 : 1,
                  }}
                >
                  <PackHoverClip
                    className="mx-auto max-h-full max-w-full object-contain"
                    onHoverFailed={() => setHoverFailed(true)}
                  />
                </div>
              )
            ) : null}

            {keepOpeningMounted ? (
              <video
                ref={openingRef}
                className={cn(
                  'max-h-full max-w-full object-contain object-center',
                  includeHoverGate ? 'absolute inset-0 m-auto h-full w-full' : 'relative',
                  openingVisible ? '' : 'pointer-events-none'
                )}
                style={{
                  transition: `opacity ${PACK_REVEAL_TIMING.videoCrossfadeMs}ms ease`,
                  opacity: openingVisible ? 1 : 0,
                }}
                poster={PACK_ANIMATION_POSTER}
                muted
                playsInline
                controls={false}
                preload="auto"
                onEnded={() => enterWhiteTransition()}
                onError={() => {
                  setOpenFailed(true)
                  enterWhiteTransition()
                }}
              >
                <source src={PACK_ANIMATIONS.opening} type="video/mp4" />
              </video>
            ) : null}
          </div>

          {hoverOnly && inHoverStages ? (
            <div className="absolute inset-x-0 bottom-[max(2rem,env(safe-area-inset-bottom))] flex justify-center px-4">
              <button
                type="button"
                onClick={handleContinue}
                className="inline-flex min-h-[48px] min-w-[160px] items-center justify-center rounded-xl border border-white/25 px-6 text-sm font-semibold uppercase tracking-wider text-white/80 hover:bg-white/10"
              >
                Close
              </button>
            </div>
          ) : null}

          {!hoverOnly &&
          includeHoverGate &&
          inHoverStages &&
          !openClicked ? (
            <div className="absolute inset-x-0 bottom-[max(2rem,env(safe-area-inset-bottom))] flex justify-center px-4">
              <button
                type="button"
                disabled={!hoverReady || openClicked}
                onClick={onOpenPack}
                className={cn(
                  'inline-flex min-h-[52px] min-w-[200px] items-center justify-center rounded-xl px-8',
                  'bg-[#00FF9C] text-sm font-bold uppercase tracking-[0.14em] text-[#062016]',
                  'shadow-[0_0_40px_-8px_rgba(0,255,156,0.65)] transition',
                  'hover:bg-[#7DFFB8] disabled:cursor-not-allowed disabled:opacity-45'
                )}
              >
                Open pack
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Pure white transition overlay */}
      <div
        className={cn(
          'pointer-events-none absolute inset-0 z-[3] bg-white',
          'transition-opacity ease-out'
        )}
        style={{
          opacity: whiteOpaque ? 1 : 0,
          transitionDuration: `${reducedMotion ? 180 : PACK_REVEAL_TIMING.whiteFadeMs}ms`,
          visibility:
            stage === 'whiteTransition' ||
            stage === 'revealing' ||
            stage === 'complete' ||
            whiteOpaque
              ? 'visible'
              : 'hidden',
        }}
        aria-hidden
      />
    </div>
  )

  if (typeof document === 'undefined') return overlay
  return createPortal(overlay, document.body)
}
