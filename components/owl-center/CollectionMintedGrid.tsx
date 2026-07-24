'use client'

import { useEffect, useId, useState } from 'react'
import { ChevronDown, ChevronUp, Download, ExternalLink, Loader2 } from 'lucide-react'

import { CommandCard } from '@/components/owl-center/CommandCard'
import { buildOwlCenterHubCardImageChain } from '@/lib/owl-center/hub-card-image-url'
import { fetchMintNftMetadata } from '@/lib/client/nft-metadata-client'
import { useSaveImage } from '@/components/use-save-image'
import { useNearViewportOnce } from '@/hooks/use-near-viewport-once'
import { cn } from '@/lib/utils'

function MintedPieceCard({
  mint,
  preferMainnet,
  index,
}: {
  mint: string
  preferMainnet: boolean
  index: number
}) {
  const { ref, visible } = useNearViewportOnce('320px 0px')
  const [name, setName] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [imageAttemptIdx, setImageAttemptIdx] = useState(0)
  const [imageAttemptChain, setImageAttemptChain] = useState<string[]>([])
  const [downloading, setDownloading] = useState(false)
  const { saveImage, savePngOverlay } = useSaveImage()

  useEffect(() => {
    if (!visible) return

    let cancelled = false
    setLoading(true)
    setName(null)
    setImageAttemptIdx(0)
    setImageAttemptChain([])

    fetchMintNftMetadata(mint, preferMainnet)
      .then((json) => {
        if (cancelled) return
        const raw = json.image?.trim()
        const n = json.name?.trim()
        if (n) setName(n)
        setImageAttemptChain(buildOwlCenterHubCardImageChain(raw ?? null))
      })
      .catch(() => {
        if (!cancelled) setImageAttemptChain(buildOwlCenterHubCardImageChain(null))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [mint, preferMainnet, visible])

  const imageSrc = imageAttemptChain[imageAttemptIdx] ?? null
  const showLoading = !visible || loading

  const tryNextImage = () =>
    setImageAttemptIdx((idx) => (idx + 1 < imageAttemptChain.length ? idx + 1 : idx))

  const handleImageLoad = (img: HTMLImageElement) => {
    if (img.naturalWidth > 0) return
    tryNextImage()
  }

  const explorer = preferMainnet
    ? `https://solscan.io/token/${mint}`
    : `https://solscan.io/token/${mint}?cluster=devnet`

  const downloadName = `${(name ?? `owl-${mint.slice(0, 8)}`).replace(/[^a-z0-9-_]+/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'owl'}.png`

  async function handleDownload() {
    if (!imageSrc || downloading) return
    setDownloading(true)
    try {
      const res = await fetch(imageSrc, { mode: 'cors' })
      if (!res.ok) throw new Error('fetch failed')
      const blob = await res.blob()
      await saveImage(blob, downloadName, { title: name ?? 'Owl artwork' })
    } catch {
      window.open(imageSrc, '_blank', 'noopener,noreferrer')
    } finally {
      setDownloading(false)
    }
  }

  return (
    <article ref={ref} className="overflow-hidden border border-[#1A222B] bg-[#10161C]/85">
      <div className="relative aspect-square w-full bg-[#0B0F13]">
        {showLoading ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-7 w-7 animate-spin text-[#00FF9C]" aria-hidden />
          </div>
        ) : imageSrc ? (
          // eslint-disable-next-line @next/next/no-img-element -- gateway fallbacks via onError chain
          <img
            key={`${imageAttemptIdx}-${imageSrc.slice(0, 96)}`}
            src={imageSrc}
            alt={name ? `${name} artwork` : `Minted NFT ${index + 1}`}
            className="h-full w-full object-cover"
            loading="lazy"
            decoding="async"
            onLoad={(e) => handleImageLoad(e.currentTarget)}
            onError={tryNextImage}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-3 text-center">
            <span className="font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">Artwork loading</span>
            <span className="font-mono text-[10px] text-[#7D8A93]">
              {mint.slice(0, 4)}…{mint.slice(-4)}
            </span>
          </div>
        )}
      </div>
      <div className="space-y-2 border-t border-[#1A222B] p-3">
        <p className="truncate font-mono text-xs text-[#E8EEF2]">{name ?? `Mint #${index + 1}`}</p>
        <div className="flex gap-2">
          <a
            href={explorer}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-[44px] flex-1 touch-manipulation items-center justify-center gap-1.5 border border-[#1A222B] bg-[#0B0F13] px-2 font-mono text-[10px] uppercase tracking-widest text-[#00FF9C] hover:border-[#00FF9C]/35"
          >
            <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden />
            View mint
          </a>
          <button
            type="button"
            onClick={handleDownload}
            disabled={!imageSrc || downloading}
            aria-label={name ? `Download ${name} image` : `Download minted NFT ${index + 1} image`}
            className="inline-flex min-h-[44px] min-w-[44px] touch-manipulation items-center justify-center border border-[#1A222B] bg-[#0B0F13] px-2 font-mono text-[10px] uppercase tracking-widest text-[#00FF9C] hover:border-[#00FF9C]/35 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {downloading ? (
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />
            ) : (
              <Download className="h-3.5 w-3.5 shrink-0" aria-hidden />
            )}
          </button>
        </div>
      </div>
      {savePngOverlay}
    </article>
  )
}

export function CollectionMintedGrid({
  mints,
  preferMainnet = true,
  label,
  description = 'Pieces already minted from this drop. Pull to refresh in your wallet if you just minted — new entries appear here after confirm-mint records the tx.',
  /** Cap grid height and scroll inside the card (default on). */
  scrollable = true,
  /** Show expand/collapse control for the mint grid (default on). */
  collapsible = true,
  /** Initial open state when `collapsible` is true. */
  defaultExpanded = true,
}: {
  mints: string[]
  preferMainnet?: boolean
  label?: string
  description?: string
  scrollable?: boolean
  collapsible?: boolean
  defaultExpanded?: boolean
}) {
  const gridId = useId()
  const [expanded, setExpanded] = useState(defaultExpanded)

  if (!mints.length) return null

  // Only offer collapse once the grid is longer than ~2 rows (3-col layout).
  const showCollapse = collapsible && mints.length > 6
  const gridVisible = !showCollapse || expanded

  return (
    <CommandCard label={label ?? `MINTED // ${mints.length}`}>
      <p className="mb-4 text-sm leading-relaxed text-[#9BA8B4]">{description}</p>

      {showCollapse ? (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">
            {expanded
              ? `Showing ${mints.length} mint${mints.length === 1 ? '' : 's'}`
              : `${mints.length} mint${mints.length === 1 ? '' : 's'} hidden`}
          </p>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            aria-controls={gridId}
            className="inline-flex min-h-[44px] touch-manipulation items-center gap-1.5 border border-[#1A222B] bg-[#0B0F13] px-3 font-mono text-[10px] uppercase tracking-widest text-[#00FF9C] hover:border-[#00FF9C]/35"
          >
            {expanded ? (
              <>
                <ChevronUp className="h-3.5 w-3.5 shrink-0" aria-hidden />
                Collapse
              </>
            ) : (
              <>
                <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden />
                Expand
              </>
            )}
          </button>
        </div>
      ) : null}

      {gridVisible ? (
        <div
          id={gridId}
          className={cn(
            scrollable &&
              'max-h-[min(36rem,55vh)] overflow-y-auto overscroll-contain [scrollbar-gutter:stable] scrollbar-themed',
            scrollable && 'rounded-none border border-[#1A222B] bg-[#0B0F13]/40 p-3 sm:p-4'
          )}
        >
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:gap-4">
            {mints.map((mint, index) => (
              <li key={mint}>
                <MintedPieceCard mint={mint} preferMainnet={preferMainnet} index={index} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </CommandCard>
  )
}
