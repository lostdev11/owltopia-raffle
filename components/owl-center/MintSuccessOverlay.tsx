'use client'

import { useEffect, useState } from 'react'
import { ExternalLink, Loader2 } from 'lucide-react'

import { DeployButton } from '@/components/owl-center/DeployButton'
import { fireMintConfetti, preloadConfetti } from '@/lib/confetti'
import { buildOwlCenterHubCardImageChain } from '@/lib/owl-center/hub-card-image-url'

export type MintSuccessOverlayProps = {
  open: boolean
  /** How many NFTs were minted in this session. */
  quantity: number
  /** Latest mint address from this session — used for the reveal card. */
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

export function MintSuccessOverlay({
  open,
  quantity,
  mintAddress,
  preferMainnet = false,
  transactionSignature,
  explorerUrl,
  onClose,
}: MintSuccessOverlayProps) {
  const [imageLoading, setImageLoading] = useState(false)
  const [resolvedName, setResolvedName] = useState<string | null>(null)
  const [imageAttemptIdx, setImageAttemptIdx] = useState(0)
  const [imageAttemptChain, setImageAttemptChain] = useState<string[]>([])
  const [artworkLoaded, setArtworkLoaded] = useState(false)
  const [revealComplete, setRevealComplete] = useState(false)

  const mint = mintAddress?.trim() ?? ''

  useEffect(() => {
    if (!open || !mint) {
      setImageLoading(false)
      setResolvedName(null)
      setImageAttemptIdx(0)
      setImageAttemptChain([])
      setArtworkLoaded(false)
      setRevealComplete(false)
      return
    }

    let cancelled = false
    setImageLoading(true)
    setResolvedName(null)
    setImageAttemptIdx(0)
    setImageAttemptChain([])
    setArtworkLoaded(false)
    setRevealComplete(false)

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
  }, [open, mint, preferMainnet])

  const currentImageSrc = imageAttemptChain[imageAttemptIdx] ?? null

  const imageSrcKey = `${imageAttemptIdx}:${imageAttemptChain[imageAttemptIdx] ?? ''}`

  useEffect(() => {
    setArtworkLoaded(false)
    setRevealComplete(false)
  }, [imageSrcKey])

  useEffect(() => {
    if (!open) return
    preloadConfetti()
    if (!mint) {
      setRevealComplete(true)
      return
    }
    if (artworkLoaded) {
      const timer = window.setTimeout(() => setRevealComplete(true), 900)
      return () => window.clearTimeout(timer)
    }
    if (!imageLoading && !currentImageSrc) {
      const timer = window.setTimeout(() => setRevealComplete(true), 500)
      return () => window.clearTimeout(timer)
    }
  }, [open, mint, artworkLoaded, imageLoading, currentImageSrc])

  useEffect(() => {
    if (open && revealComplete) {
      fireMintConfetti()
    }
  }, [open, revealComplete])

  if (!open) return null

  const n = Math.max(1, quantity)
  const scanning = Boolean(mint && (imageLoading || (currentImageSrc && !artworkLoaded)))
  const heading = resolvedName
    ? revealComplete
      ? `You minted ${resolvedName}!`
      : 'Revealing your mint…'
    : n === 1
      ? revealComplete
        ? 'Mint successful!'
        : 'Revealing your mint…'
      : `${n} mints successful!`

  return (
    <div
      className="mint-reveal-backdrop fixed inset-0 z-[200] flex items-end justify-center bg-[#0B0F14]/92 p-4 backdrop-blur-sm sm:items-center safe-area-bottom"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="mint-success-overlay-title"
    >
      <div className="mint-reveal-dialog relative w-full max-w-md space-y-4 overflow-hidden border border-[#1A222B] bg-[#0F1419] p-6 shadow-[0_0_40px_rgba(0,255,156,0.12)] sm:text-center">
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

        {mint ? (
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
              {mint ? ' Phantom and Solflare usually catch up within a few seconds.' : ' Open Phantom or Solflare and check Collectibles.'}
              {' '}If you don&apos;t see it yet, pull to refresh in your wallet app.
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
