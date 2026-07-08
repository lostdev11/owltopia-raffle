'use client'

import { useState } from 'react'
import { ImageDown, Trophy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { computePromoPngArtDrawRect } from '@/lib/promo-png-art-draw'
import { ensurePromoPngFontsReady, getPromoPngFontFamily } from '@/lib/promo-png-fonts'
import { loadPromoPngArt, loadPromoPngSiteAsset } from '@/lib/promo-png-load-image'
import { buildRaffleImageAttemptChain } from '@/lib/raffle-display-image-url'
import {
  computeWinnerPnlDisplay,
  formatWinnerPnlAmount,
  formatWinnerPnlRoi,
  type WinnerPnlDisplay,
  type WinnerPnlRaffleLike,
  type WinnerSpendEntryLike,
} from '@/lib/raffles/winner-pnl'
import { useSaveImage } from '@/components/use-save-image'

type RaffleWinnerPngButtonProps = {
  title: string
  slug: string
  imageUrl?: string | null
  imageAttemptUrls?: string[] | null
  imageFallbackUrl?: string | null
  /** When artwork is missing from raffle rows, resolve via Helius DAS metadata. */
  nftMintAddress?: string | null
  winnerWallet: string
  /** Platform display name when already known (skips lookup). */
  winnerDisplayName?: string | null
  /** Raffle fields used to compute P&L when the PNG is generated (winner-only). */
  pnlRaffle?: WinnerPnlRaffleLike | null
  /** Confirmed entries for the winner wallet on this raffle (same raffle as `pnlRaffle`). */
  pnlEntries?: WinnerSpendEntryLike[] | null
  className?: string
  buttonLabel?: string
  fullWidth?: boolean
}

const WIDTH = 1200
const HEIGHT = 675

function shortWallet(wallet: string): string {
  const w = wallet.trim()
  if (w.length <= 12) return w
  return `${w.slice(0, 6)}...${w.slice(-4)}`
}

async function resolveWinnerDisplayLabel(
  winnerWallet: string,
  preferredName?: string | null
): Promise<string> {
  const pref = preferredName?.trim()
  if (pref) return pref
  const wallet = winnerWallet.trim()
  if (!wallet) return 'Winner'
  try {
    const res = await fetch(`/api/profiles?wallets=${encodeURIComponent(wallet)}`, {
      cache: 'no-store',
    })
    if (res.ok) {
      const map = (await res.json().catch(() => null)) as Record<string, string> | null
      const name = map?.[wallet]
      if (typeof name === 'string' && name.trim()) return name.trim()
    }
  } catch {
    /* fall through */
  }
  return shortWallet(wallet)
}

function fitSingleLineText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string {
  if (maxWidth <= 0 || ctx.measureText(text).width <= maxWidth) return text
  const ell = '…'
  let end = text.length
  while (end > 0) {
    const candidate = `${text.slice(0, end).trimEnd()}${ell}`
    if (ctx.measureText(candidate).width <= maxWidth) return candidate
    end -= 1
  }
  return ell
}

function clampText(input: string, max: number): string {
  const normalized = input.trim().replace(/\s+/g, ' ')
  if (normalized.length <= max) return normalized
  return `${normalized.slice(0, max - 1).trimEnd()}...`
}

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) {
  const r = Math.min(radius, width / 2, height / 2)
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + width, y, x + width, y + height, r)
  ctx.arcTo(x + width, y + height, x, y + height, r)
  ctx.arcTo(x, y + height, x, y, r)
  ctx.arcTo(x, y, x + width, y, r)
  ctx.closePath()
}

/** Owltopia site icon — same asset as X promo PNG watermarks (`RafflePromoPngButton`). */
function watermarkIconUrl(): string {
  if (typeof window === 'undefined') return '/icon.png'
  return new URL('/icon.png', window.location.origin).href
}

function winnerPnlBlockHeight(pnl: WinnerPnlDisplay): number {
  return pnl.isFreeWin ? 92 : 132
}

function drawWinnerPnlBlock(
  ctx: CanvasRenderingContext2D,
  fontFamily: string,
  pnl: WinnerPnlDisplay,
  x: number,
  y: number,
  maxWidth: number
): number {
  const blockH = winnerPnlBlockHeight(pnl)
  const blockW = Math.min(maxWidth, 560)

  ctx.save()
  roundRectPath(ctx, x, y, blockW, blockH, 16)
  ctx.fillStyle = 'rgba(250, 204, 21, 0.14)'
  ctx.fill()
  ctx.strokeStyle = 'rgba(250, 204, 21, 0.55)'
  ctx.lineWidth = 2
  ctx.stroke()
  ctx.restore()

  const padX = 22
  const innerW = blockW - padX * 2
  ctx.textBaseline = 'alphabetic'

  if (pnl.isFreeWin) {
    ctx.fillStyle = '#facc15'
    ctx.font = `700 24px ${fontFamily}`
    ctx.fillText('FREE WIN', x + padX, y + 40)
    ctx.fillStyle = '#fff6d5'
    ctx.font = `700 28px ${fontFamily}`
    const prizeLabel = pnl.prizeValueKind === 'floor' ? 'floor' : 'prize'
    const line = `Prize: ${formatWinnerPnlAmount(pnl.prizeValue, pnl.currency)} (${prizeLabel})`
    ctx.fillText(fitSingleLineText(ctx, line, innerW), x + padX, y + 78)
    return blockH
  }

  const colW = innerW / 3
  const labels = ['Spent', pnl.prizeValueKind === 'floor' ? 'Won (floor)' : 'Won', 'Net']
  const values = [
    formatWinnerPnlAmount(pnl.amountSpent, pnl.currency),
    formatWinnerPnlAmount(pnl.prizeValue, pnl.currency),
    `${pnl.netProfit >= 0 ? '+' : ''}${formatWinnerPnlAmount(pnl.netProfit, pnl.currency)}`,
  ]

  ctx.fillStyle = '#fde68a'
  ctx.font = `600 22px ${fontFamily}`
  labels.forEach((label, i) => {
    ctx.fillText(fitSingleLineText(ctx, label, colW - 6), x + padX + colW * i, y + 34)
  })

  ctx.fillStyle = '#ffffff'
  ctx.font = `700 32px ${fontFamily}`
  values.forEach((value, i) => {
    ctx.fillText(fitSingleLineText(ctx, value, colW - 6), x + padX + colW * i, y + 78)
  })

  if (pnl.roiPercent != null) {
    const roiText = formatWinnerPnlRoi(pnl.roiPercent)
    const roiColor = pnl.roiPercent >= 0 ? '#4ade80' : '#f87171'
    ctx.fillStyle = roiColor
    ctx.font = `700 24px ${fontFamily}`
    ctx.fillText(roiText, x + padX + colW * 2, y + 114)
  }

  return blockH
}

async function resolveMintImageAttemptUrls(mint: string): Promise<string[]> {
  const trimmed = mint.trim()
  if (!trimmed) return []
  try {
    const res = await fetch(`/api/nft/metadata-image?mint=${encodeURIComponent(trimmed)}`, {
      cache: 'no-store',
    })
    if (!res.ok) return []
    const data = (await res.json().catch(() => null)) as { image?: string | null } | null
    const raw = typeof data?.image === 'string' ? data.image.trim() : ''
    if (!raw) return []
    return buildRaffleImageAttemptChain(raw, null)
  } catch {
    return []
  }
}

async function resolveWinnerPngArtCandidates(
  imageAttemptUrls: string[] | null | undefined,
  imageUrl: string | null | undefined,
  imageFallbackUrl: string | null | undefined,
  nftMintAddress: string | null | undefined
): Promise<string[]> {
  const fromProps =
    imageAttemptUrls && imageAttemptUrls.length > 0
      ? imageAttemptUrls
      : imageUrl?.trim()
        ? [imageUrl.trim()]
        : []
  if (fromProps.length > 0) return fromProps
  const mint = nftMintAddress?.trim()
  if (!mint) return []
  return resolveMintImageAttemptUrls(mint)
}

export function RaffleWinnerPngButton({
  title,
  slug,
  imageUrl,
  imageAttemptUrls,
  imageFallbackUrl,
  nftMintAddress,
  winnerWallet,
  winnerDisplayName,
  pnlRaffle,
  pnlEntries,
  className,
  buttonLabel = 'Winner PNG',
  fullWidth = false,
}: RaffleWinnerPngButtonProps) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const { saveImage, savePngOverlay } = useSaveImage()

  const clearMessageSoon = () => {
    window.setTimeout(() => setMessage(null), 2200)
  }

  const onGenerate = async () => {
    if (typeof window === 'undefined') return
    setBusy(true)
    setMessage(null)
    try {
      await ensurePromoPngFontsReady()
      const fontFamily = getPromoPngFontFamily()

      const canvas = document.createElement('canvas')
      canvas.width = WIDTH
      canvas.height = HEIGHT
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('Canvas unavailable')

      const safeTitle = clampText(title || 'Owltopia Raffle', 110)
      const winnerLabel = await resolveWinnerDisplayLabel(winnerWallet, winnerDisplayName)
      const pnl =
        pnlRaffle != null
          ? computeWinnerPnlDisplay(pnlRaffle, pnlEntries ?? [], winnerWallet)
          : null
      const showPnl = pnl != null && pnl.prizeValue > 0

      const bg = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT)
      bg.addColorStop(0, '#1a1200')
      bg.addColorStop(0.5, '#2b1f06')
      bg.addColorStop(1, '#120c00')
      ctx.fillStyle = bg
      ctx.fillRect(0, 0, WIDTH, HEIGHT)

      const panelX = 48
      const panelY = 48
      const panelW = WIDTH - 96
      const panelH = HEIGHT - 96

      ctx.save()
      roundRectPath(ctx, panelX, panelY, panelW, panelH, 30)
      const panel = ctx.createLinearGradient(panelX, panelY, panelX + panelW, panelY + panelH)
      panel.addColorStop(0, 'rgba(45, 32, 8, 0.98)')
      panel.addColorStop(1, 'rgba(25, 17, 4, 0.98)')
      ctx.fillStyle = panel
      ctx.fill()
      ctx.restore()

      {
        const wm = await loadPromoPngSiteAsset(watermarkIconUrl())
        if (wm) {
          ctx.save()
          roundRectPath(ctx, panelX, panelY, panelW, panelH, 30)
          ctx.clip()
          const s = Math.min(panelW, panelH) * 0.88
          const wx = panelX + (panelW - s) / 2
          const wy = panelY + (panelH - s) / 2
          ctx.globalAlpha = 0.07
          ctx.drawImage(wm, wx, wy, s, s)
          ctx.globalAlpha = 1
          ctx.restore()
        }
      }

      const artSize = 390
      const artX = panelX + panelW - artSize - 42
      const artY = panelY + Math.round((panelH - artSize) / 2)
      const artBox = { x: artX, y: artY, w: artSize, h: artSize }

      ctx.save()
      roundRectPath(ctx, artBox.x, artBox.y, artBox.w, artBox.h, 20)
      ctx.clip()
      const artCandidates = await resolveWinnerPngArtCandidates(
        imageAttemptUrls,
        imageUrl,
        imageFallbackUrl,
        nftMintAddress
      )
      if (artCandidates.length > 0) {
        const loadedArt = await loadPromoPngArt(artCandidates, imageUrl, imageFallbackUrl)
        if (loadedArt) {
          try {
            const { drawX, drawY, drawW, drawH } = computePromoPngArtDrawRect(
              loadedArt.img,
              artBox,
              loadedArt.sourceUrl
            )
            ctx.drawImage(loadedArt.img, drawX, drawY, drawW, drawH)
          } finally {
            loadedArt.revoke()
          }
        } else {
          ctx.fillStyle = '#2a1f08'
          ctx.fillRect(artBox.x, artBox.y, artBox.w, artBox.h)
        }
      } else {
        ctx.fillStyle = '#2a1f08'
        ctx.fillRect(artBox.x, artBox.y, artBox.w, artBox.h)
      }
      ctx.restore()

      ctx.save()
      roundRectPath(ctx, artBox.x, artBox.y, artBox.w, artBox.h, 20)
      ctx.strokeStyle = 'rgba(250, 204, 21, 0.9)'
      ctx.shadowColor = 'rgba(250, 204, 21, 0.45)'
      ctx.shadowBlur = 16
      ctx.lineWidth = 3
      ctx.stroke()
      ctx.restore()

      const textX = panelX + 72
      const textMaxW = artX - textX - 44
      ctx.textBaseline = 'alphabetic'

      const badgeH = 62
      const badgeW = Math.min(textMaxW, 520)
      const badgeY = panelY + panelH - badgeH - 36
      const pnlBlockH = showPnl && pnl ? winnerPnlBlockHeight(pnl) : 0
      const pnlY = showPnl && pnl ? badgeY - 20 - pnlBlockH : 0
      const titleLineH = 72
      const titleStartY = panelY + 170
      const titleMaxBottom = showPnl ? pnlY - 14 : badgeY - 18
      const maxTitleLines = Math.min(
        showPnl ? 2 : 3,
        Math.max(1, Math.floor((titleMaxBottom - titleStartY) / titleLineH))
      )

      ctx.fillStyle = '#facc15'
      ctx.font = `700 28px ${fontFamily}`
      ctx.fillText('WINNER SELECTED', textX, panelY + 96)

      ctx.fillStyle = '#fff6d5'
      ctx.font = `800 62px ${fontFamily}`
      const titleWords = safeTitle.split(' ')
      const lines: string[] = []
      let current = ''
      for (const word of titleWords) {
        const next = current ? `${current} ${word}` : word
        if (ctx.measureText(next).width <= textMaxW) current = next
        else {
          if (current) lines.push(current)
          current = word
          if (lines.length >= maxTitleLines - 1) break
        }
      }
      if (current && lines.length < maxTitleLines) lines.push(current)
      lines.slice(0, maxTitleLines).forEach((line, i) => {
        ctx.fillText(line, textX, titleStartY + i * titleLineH)
      })

      if (showPnl && pnl) {
        drawWinnerPnlBlock(ctx, fontFamily, pnl, textX, pnlY, textMaxW)
      }

      ctx.save()
      roundRectPath(ctx, textX, badgeY, badgeW, badgeH, 999)
      ctx.fillStyle = 'rgba(250, 204, 21, 0.16)'
      ctx.fill()
      ctx.strokeStyle = 'rgba(250, 204, 21, 0.65)'
      ctx.lineWidth = 1.5
      ctx.stroke()
      ctx.restore()
      ctx.fillStyle = '#fde68a'
      ctx.font = `600 30px ${fontFamily}`
      const badgeInnerW = badgeW - 40
      const winnerPrefix = 'Winner: '
      const winnerNameMaxW = badgeInnerW - ctx.measureText(winnerPrefix).width
      const winnerLine = `${winnerPrefix}${fitSingleLineText(ctx, winnerLabel, winnerNameMaxW)}`
      ctx.fillText(winnerLine, textX + 20, badgeY + 41)

      ctx.save()
      roundRectPath(ctx, panelX, panelY, panelW, panelH, 30)
      ctx.strokeStyle = 'rgba(250, 204, 21, 0.75)'
      ctx.lineWidth = 3
      ctx.stroke()
      ctx.restore()

      const fileSlug = slug.trim() || 'raffle'
      const fileName = `${fileSlug}-winner-card.png`
      const pngBlob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((blob) => {
          if (blob) resolve(blob)
          else reject(new Error('Could not create PNG blob'))
        }, 'image/png')
      })

      const result = await saveImage(pngBlob, fileName, {
        title: safeTitle,
        text: 'Save this winner PNG',
      })
      if (result === 'shared') setMessage('Use Save Image in the share sheet')
      else if (result === 'preview') setMessage('Long-press the image to save')
      else if (result === 'downloaded') setMessage('Winner PNG download started')
      else setMessage('Save cancelled')
    } catch {
      setMessage('Could not generate winner PNG')
    } finally {
      setBusy(false)
      clearMessageSoon()
    }
  }

  return (
    <div className={className}>
      <Button
        type="button"
        variant="outline"
        className={`min-h-[44px] touch-manipulation ${fullWidth ? 'w-full' : ''}`.trim()}
        onClick={() => void onGenerate()}
        disabled={busy}
        aria-label="Download winner PNG"
      >
        <Trophy className="mr-2 h-4 w-4 text-yellow-500" />
        <ImageDown className="mr-2 h-4 w-4" />
        {busy ? 'Generating…' : buttonLabel}
      </Button>
      {message ? <p className="mt-1 text-xs text-muted-foreground">{message}</p> : null}
      {savePngOverlay}
    </div>
  )
}
