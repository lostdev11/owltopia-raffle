'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Egg, Loader2 } from 'lucide-react'
import { buildRaffleImageAttemptChain } from '@/lib/raffle-display-image-url'
import { cn } from '@/lib/utils'

export type NestingStakedAssetThumbProps = {
  mint?: string | null
  /** From wallet DAS scan — shown immediately while Helius metadata loads. */
  hintImageUrl?: string | null
  /** Optional display name from wallet scan (shown until Helius metadata resolves). */
  hintName?: string | null
  /** Optional override for alt text (rare). */
  name?: string | null
  /** Helius `/api/nft/metadata-image` name (and hints) for parent captions. */
  onResolvedMintMeta?: (meta: { name: string | null }) => void
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

export function NestingStakedAssetThumb({
  mint,
  hintImageUrl,
  hintName,
  name,
  onResolvedMintMeta,
  size = 'md',
  className,
}: NestingStakedAssetThumbProps) {
  const onResolvedMintMetaRef = useRef(onResolvedMintMeta)
  onResolvedMintMetaRef.current = onResolvedMintMeta

  const dim =
    size === 'sm'
      ? 'h-16 w-16 min-h-[64px] min-w-[64px]'
      : size === 'lg'
        ? 'aspect-square h-auto w-full min-h-[100px] max-h-[176px]'
        : 'h-[5.5rem] w-[5.5rem] min-h-[88px] min-w-[88px]'

  const hint = hintImageUrl?.trim() || null
  const mintDep = mint?.trim() ?? ''
  const hintDep = hintImageUrl?.trim() ?? ''
  const [apiImageUri, setApiImageUri] = useState<string | null>(null)
  const [metaFetchDone, setMetaFetchDone] = useState(false)
  const [attemptIdx, setAttemptIdx] = useState(0)
  const [resolvedName, setResolvedName] = useState<string | null>(null)

  /** Wallet CDN first, then indexer URI — avoids replacing a good hint with a broken gateway URL. */
  const attemptChain = useMemo(
    () => buildRaffleImageAttemptChain(hint, apiImageUri),
    [hint, apiImageUri]
  )

  const chainSig = attemptChain.join('\0')

  useEffect(() => {
    setAttemptIdx(0)
  }, [chainSig])

  useEffect(() => {
    setResolvedName(null)
  }, [mintDep, hintDep])

  useEffect(() => {
    const m = mint?.trim()

    if (!m) {
      setApiImageUri(null)
      setMetaFetchDone(true)
      return
    }

    setMetaFetchDone(false)
    setApiImageUri(null)

    let cancelled = false

    fetch(`/api/nft/metadata-image?mint=${encodeURIComponent(m)}&preferMainnet=1`)
      .then((r) => r.json())
      .then((j: { image?: string | null; name?: string | null }) => {
        if (cancelled) return
        const uri = typeof j?.image === 'string' ? j.image.trim() : ''
        const nm = typeof j?.name === 'string' ? j.name.trim() : ''
        if (nm) {
          setResolvedName(nm)
          onResolvedMintMetaRef.current?.({ name: nm })
        }
        setApiImageUri(uri || null)
      })
      .catch(() => {
        if (!cancelled) setApiImageUri(null)
      })
      .finally(() => {
        if (!cancelled) setMetaFetchDone(true)
      })

    return () => {
      cancelled = true
    }
  }, [mintDep])

  const showSpinner = Boolean(mint?.trim()) && !hint && !metaFetchDone

  const labelBase =
    name?.trim() || resolvedName?.trim() || hintName?.trim() || ''
  const altLabel = labelBase ? `${labelBase} artwork` : 'Staked NFT artwork'

  const currentSrc = attemptChain[attemptIdx]
  const imgKey =
    currentSrc != null
      ? `${attemptIdx}-${currentSrc.length > 96 ? currentSrc.slice(0, 96) : currentSrc}`
      : String(attemptIdx)

  return (
    <div
      className={cn(
        'relative shrink-0 overflow-hidden rounded-xl border border-border/60 bg-muted/40',
        dim,
        className
      )}
    >
      {showSpinner ? (
        <div className="flex h-full w-full items-center justify-center bg-muted/50 touch-manipulation">
          <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" aria-hidden />
          <span className="sr-only">Loading NFT artwork</span>
        </div>
      ) : attemptChain.length > 0 && attemptIdx < attemptChain.length && currentSrc ? (
        // eslint-disable-next-line @next/next/no-img-element -- remote NFT URIs via proxy / gateway fallback chain
        <img
          key={imgKey}
          src={currentSrc}
          alt={altLabel}
          className="h-full w-full object-cover touch-manipulation"
          loading={size === 'lg' ? 'eager' : 'lazy'}
          onError={() => setAttemptIdx((i) => i + 1)}
        />
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center gap-1 bg-muted/30 px-1 text-center touch-manipulation">
          <Egg className="h-8 w-8 text-muted-foreground/70" aria-hidden />
          <span className="sr-only">
            {mint?.trim() ? 'Artwork unavailable' : 'No artwork'}
          </span>
        </div>
      )}
    </div>
  )
}
