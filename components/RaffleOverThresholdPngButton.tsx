'use client'

import { useState } from 'react'
import { ImageDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { computePromoPngArtDrawRect } from '@/lib/promo-png-art-draw'
import type { Raffle } from '@/lib/types'
import {
  normalizeRaffleTicketCurrency,
  revenueInCurrency,
  type RaffleProfitInfo,
} from '@/lib/raffle-profit'

const WIDTH = 1200
const HEIGHT = 675

const FONT_SANS = '"Plus Jakarta Sans", system-ui, sans-serif'

const THEME = {
  background: '#0a0a0a',
  foreground: '#fafafa',
  muted: '#a3a3a3',
  prime: '#00ff88',
  midnight: '#00d4ff',
  greenRgb: '34, 197, 94',
} as const

const PROMO = {
  imageSize: 420,
  contentX: 72,
  textImageGap: 40,
  artRightPad: 36,
  afterTitleGap: 22,
  betweenMetaLines: 30,
  cornerR: 28,
  imageCornerR: 20,
} as const

type RaffleOverThresholdPngButtonProps = {
  title: string
  slug: string
  ticketPrice?: number
  currency?: string
  endTime?: string | null
  imageUrl?: string | null
  /** Revenue / bar / surplus lines (faint Owltopia mark matches X promo cards). */
  metaLines: string[]
  /** Uppercase badge on generated PNG (e.g. above listed floor vs composite threshold). */
  promoChipText?: string
  className?: string
  fullWidth?: boolean
  buttonLabel?: string
}

function clampText(input: string, max: number): string {
  const normalized = input.trim().replace(/\s+/g, ' ')
  if (normalized.length <= max) return normalized
  return `${normalized.slice(0, max - 1).trimEnd()}...`
}

async function tryLoadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new window.Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = src
  })
}

function wrapTextToLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number
): string[] {
  const words = text.split(' ')
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    const next = current ? `${current} ${word}` : word
    if (ctx.measureText(next).width <= maxWidth) {
      current = next
      continue
    }
    if (current) lines.push(current)
    current = word
    if (lines.length >= maxLines - 1) break
  }
  if (current && lines.length < maxLines) lines.push(current)
  return lines
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

function drawPanelNeonFrame(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.save()
  roundRectPath(ctx, x, y, w, h, r)
  ctx.lineJoin = 'round'
  ctx.shadowColor = 'rgba(0, 255, 136, 0.5)'
  ctx.shadowBlur = 22
  ctx.strokeStyle = 'rgba(0, 255, 136, 0.95)'
  ctx.lineWidth = 2.5
  ctx.stroke()
  ctx.restore()
}

function siteHostnameForPromo(): string {
  const raw =
    typeof process !== 'undefined' && process.env.NEXT_PUBLIC_SITE_URL
      ? process.env.NEXT_PUBLIC_SITE_URL.trim()
      : ''
  if (raw) {
    try {
      const url = raw.startsWith('http') ? raw : `https://${raw}`
      return new URL(url).hostname.replace(/^www\./i, '')
    } catch {
      /* fall through */
    }
  }
  if (typeof window !== 'undefined') {
    const h = window.location.hostname.replace(/^www\./i, '')
    if (h && !/^localhost$/i.test(h)) return h
  }
  return 'owltopia.xyz'
}

function watermarkIconUrl(): string {
  if (typeof window === 'undefined') return '/icon.png'
  return new URL('/icon.png', window.location.origin).href
}

/**
 * Pre-formatted stat lines for the “over threshold” social PNG (matches card / detail UI).
 */
export function buildOverThresholdFlexMetaLines(raffle: Raffle, profitInfo: RaffleProfitInfo): string[] {
  const ticketCur = normalizeRaffleTicketCurrency(raffle.currency)
  const listedFloor = profitInfo.floorComparisonValue
  const floorCur = profitInfo.floorComparisonCurrency

  if (listedFloor != null && floorCur != null) {
    const rev = revenueInCurrency(profitInfo.revenue, floorCur)
    const surplus = profitInfo.surplusOverFloor
    const lines = [
      `Revenue: ${rev.toFixed(floorCur === 'USDC' ? 2 : 4)} ${floorCur}`,
      `Floor: ${listedFloor.toFixed(floorCur === 'USDC' ? 2 : 4)} ${floorCur}`,
    ]
    if (surplus != null && surplus > 0) {
      lines.push(`+${surplus.toFixed(floorCur === 'USDC' ? 2 : 4)} ${floorCur} past floor`)
    }
    return lines
  }

  const thCur = profitInfo.thresholdCurrency
    ? normalizeRaffleTicketCurrency(profitInfo.thresholdCurrency)
    : ticketCur
  const rev = revenueInCurrency(profitInfo.revenue, ticketCur)
  const th = profitInfo.threshold
  const surplus = profitInfo.surplusOverThreshold
  const barWord = raffle.prize_type === 'nft' ? 'Floor' : 'Threshold'
  const lines: string[] = [
    `Revenue: ${rev.toFixed(ticketCur === 'USDC' ? 2 : 4)} ${ticketCur}`,
  ]
  if (th != null) {
    lines.push(`${barWord}: ${th.toFixed(thCur === 'USDC' ? 2 : 4)} ${thCur}`)
  }
  if (surplus != null && surplus > 0) {
    lines.push(`+${surplus.toFixed(thCur === 'USDC' ? 2 : 4)} ${thCur} past bar`)
  }
  return lines
}

export function RaffleOverThresholdPngButton({
  title,
  slug,
  ticketPrice,
  currency,
  endTime,
  imageUrl,
  metaLines,
  promoChipText = 'OVER THRESHOLD',
  className,
  fullWidth = true,
  buttonLabel = 'Download flex PNG (social)',
}: RaffleOverThresholdPngButtonProps) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const clearMessageSoon = () => {
    window.setTimeout(() => setMessage(null), 2200)
  }

  const isLikelyMobile = () =>
    (typeof navigator.maxTouchPoints === 'number' && navigator.maxTouchPoints > 0) ||
    (typeof window.matchMedia === 'function' && window.matchMedia('(hover: none), (pointer: coarse)').matches)

  const onGenerate = async () => {
    if (typeof window === 'undefined') return
    setBusy(true)
    setMessage(null)
    try {
      if (typeof document !== 'undefined' && document.fonts?.ready) {
        try {
          await document.fonts.ready
        } catch {
          /* continue */
        }
      }
      const canvas = document.createElement('canvas')
      canvas.width = WIDTH
      canvas.height = HEIGHT
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('Canvas unavailable')

      const promoHost = siteHostnameForPromo()
      const safeTitle = clampText(title || 'Owltopia Raffle', 120)
      const safeCurrency = (currency || 'SOL').trim().toUpperCase()
      const safeEndDate = endTime ? new Date(endTime) : null
      const endsLabel =
        safeEndDate && !Number.isNaN(safeEndDate.getTime())
          ? `Ends ${safeEndDate.toLocaleDateString()}`
          : 'Ends soon'
      const ticketLine =
        ticketPrice != null && Number.isFinite(ticketPrice)
          ? `Ticket: ${ticketPrice} ${safeCurrency} · ${endsLabel}`
          : endsLabel

      ctx.fillStyle = THEME.background
      ctx.fillRect(0, 0, WIDTH, HEIGHT)

      const r1 = ctx.createRadialGradient(WIDTH * 0.2, HEIGHT * 0.5, 0, WIDTH * 0.2, HEIGHT * 0.5, WIDTH * 0.55)
      r1.addColorStop(0, 'rgba(0, 255, 136, 0.14)')
      r1.addColorStop(0.55, 'rgba(0, 255, 136, 0.02)')
      r1.addColorStop(1, 'rgba(0, 255, 136, 0)')
      ctx.fillStyle = r1
      ctx.fillRect(0, 0, WIDTH, HEIGHT)

      const r2 = ctx.createRadialGradient(WIDTH * 0.85, HEIGHT * 0.15, 0, WIDTH * 0.85, HEIGHT * 0.15, WIDTH * 0.5)
      r2.addColorStop(0, 'rgba(0, 212, 255, 0.12)')
      r2.addColorStop(0.5, 'rgba(0, 212, 255, 0.02)')
      r2.addColorStop(1, 'rgba(0, 212, 255, 0)')
      ctx.fillStyle = r2
      ctx.fillRect(0, 0, WIDTH, HEIGHT)

      const panelX = 44
      const panelY = 44
      const panelW = WIDTH - 88
      const panelH = HEIGHT - 88
      ctx.save()
      roundRectPath(ctx, panelX, panelY, panelW, panelH, PROMO.cornerR)
      const panelGrad = ctx.createLinearGradient(panelX, panelY, panelX + panelW, panelY + panelH)
      panelGrad.addColorStop(0, 'rgba(8, 32, 22, 0.98)')
      panelGrad.addColorStop(0.5, 'rgba(4, 18, 12, 0.99)')
      panelGrad.addColorStop(1, 'rgba(10, 28, 18, 0.98)')
      ctx.fillStyle = panelGrad
      ctx.fill()
      ctx.restore()

      // Faint site icon (same as X / promo PNG) — field texture behind copy + art
      {
        const wm = await tryLoadImage(watermarkIconUrl())
        if (wm) {
          ctx.save()
          roundRectPath(ctx, panelX, panelY, panelW, panelH, PROMO.cornerR)
          ctx.clip()
          const s = Math.min(panelW, panelH) * 0.88
          const wx = panelX + (panelW - s) / 2
          const wy = panelY + (panelH - s) / 2
          ctx.globalAlpha = 0.055
          ctx.drawImage(wm, wx, wy, s, s)
          ctx.globalAlpha = 1
          ctx.restore()
        }
      }

      const hi = ctx.createLinearGradient(panelX, panelY, panelX + panelW, panelY)
      hi.addColorStop(0, 'rgba(255, 255, 255, 0)')
      hi.addColorStop(0.5, 'rgba(255, 255, 255, 0.05)')
      hi.addColorStop(1, 'rgba(255, 255, 255, 0)')
      ctx.fillStyle = hi
      roundRectPath(ctx, panelX + 40, panelY + 1, panelW - 80, 1, 0.5)
      ctx.fill()

      const iz = PROMO.imageSize
      const imageX = Math.round(panelX + panelW - PROMO.artRightPad - iz)
      const imageY = Math.round(panelY + (panelH - iz) / 2)
      const contentX = PROMO.contentX
      const contentMaxW = imageX - contentX - PROMO.textImageGap
      const imageBox = { x: imageX, y: imageY, w: iz, h: iz }

      ctx.save()
      roundRectPath(ctx, imageBox.x, imageBox.y, imageBox.w, imageBox.h, PROMO.imageCornerR)
      ctx.clip()
      if (imageUrl?.trim()) {
        const loaded = await tryLoadImage(imageUrl)
        if (loaded) {
          const { drawX, drawY, drawW, drawH } = computePromoPngArtDrawRect(loaded, imageBox, imageUrl)
          ctx.drawImage(loaded, drawX, drawY, drawW, drawH)
        } else {
          ctx.fillStyle = 'rgba(6, 20, 12, 0.75)'
          ctx.fillRect(imageBox.x, imageBox.y, imageBox.w, imageBox.h)
        }
      } else {
        ctx.fillStyle = 'rgba(6, 20, 12, 0.75)'
        ctx.fillRect(imageBox.x, imageBox.y, imageBox.w, imageBox.h)
      }
      ctx.restore()

      const imageShade = ctx.createLinearGradient(0, imageBox.y, 0, imageBox.y + imageBox.h)
      imageShade.addColorStop(0, 'rgba(0, 0, 0, 0)')
      imageShade.addColorStop(1, 'rgba(4, 24, 12, 0.42)')
      ctx.save()
      roundRectPath(ctx, imageBox.x, imageBox.y, imageBox.w, imageBox.h, PROMO.imageCornerR)
      ctx.clip()
      ctx.fillStyle = imageShade
      ctx.fillRect(imageBox.x, imageBox.y, imageBox.w, imageBox.h)
      ctx.restore()

      ctx.save()
      roundRectPath(ctx, imageBox.x, imageBox.y, imageBox.w, imageBox.h, PROMO.imageCornerR)
      ctx.strokeStyle = 'rgba(0, 255, 136, 0.55)'
      ctx.lineWidth = 2
      ctx.shadowColor = 'rgba(0, 255, 136, 0.28)'
      ctx.shadowBlur = 10
      ctx.stroke()
      ctx.restore()

      // Flex chip — title below uses textBaseline: top so glyphs do not overlap the chip
      const chipText = promoChipText.trim().toUpperCase() || 'OVER THRESHOLD'
      ctx.font = `800 20px ${FONT_SANS}`
      const chipPadX = 14
      const chipH = 32
      const chipW = Math.ceil(ctx.measureText(chipText).width + chipPadX * 2)
      const chipX = contentX
      const chipY = panelY + 28
      ctx.save()
      roundRectPath(ctx, chipX, chipY, chipW, chipH, 8)
      const chipG = ctx.createLinearGradient(chipX, chipY, chipX + chipW, chipY)
      chipG.addColorStop(0, 'rgba(16, 185, 129, 0.45)')
      chipG.addColorStop(1, 'rgba(5, 150, 105, 0.35)')
      ctx.fillStyle = chipG
      ctx.fill()
      ctx.strokeStyle = 'rgba(167, 243, 208, 0.5)'
      ctx.lineWidth = 1
      ctx.stroke()
      ctx.fillStyle = '#ecfdf5'
      ctx.textBaseline = 'middle'
      ctx.fillText(chipText, chipX + chipPadX, chipY + chipH / 2 + 0.5)
      ctx.textBaseline = 'alphabetic'
      ctx.restore()

      const titleBlockLineH = 52
      const titleTop = chipY + chipH + 12
      ctx.save()
      ctx.textBaseline = 'top'
      ctx.font = `700 48px ${FONT_SANS}`
      const titleLines = wrapTextToLines(ctx, safeTitle, contentMaxW, 2)
      const lineCount = titleLines.length

      const barGrad = ctx.createLinearGradient(
        contentX - 16,
        titleTop,
        contentX - 8,
        titleTop + lineCount * titleBlockLineH
      )
      barGrad.addColorStop(0, THEME.prime)
      barGrad.addColorStop(1, THEME.midnight)
      ctx.fillStyle = barGrad
      roundRectPath(
        ctx,
        contentX - 20,
        titleTop - 2,
        5,
        Math.max(40, lineCount * titleBlockLineH + 2),
        2
      )
      ctx.fill()

      ctx.fillStyle = THEME.foreground
      ctx.shadowColor = 'rgba(0, 255, 136, 0.2)'
      ctx.shadowBlur = 16
      titleLines.forEach((line, i) => {
        ctx.fillText(line, contentX, titleTop + i * titleBlockLineH)
      })
      ctx.shadowBlur = 0

      let lineY = titleTop + lineCount * titleBlockLineH + PROMO.afterTitleGap
      ctx.fillStyle = THEME.muted
      const metaFont = metaLines.length > 3 ? `500 24px ${FONT_SANS}` : `500 26px ${FONT_SANS}`
      const metaGap = metaLines.length > 3 ? 26 : PROMO.betweenMetaLines
      ctx.font = metaFont
      for (const line of metaLines.slice(0, 4)) {
        ctx.fillText(clampText(line, 80), contentX, lineY)
        lineY += metaGap
      }
      ctx.font = `500 24px ${FONT_SANS}`
      ctx.fillText(clampText(ticketLine, 72), contentX, lineY)
      ctx.textBaseline = 'alphabetic'
      ctx.restore()

      const badgeText = `LIVE ON ${promoHost}`
      ctx.font = `700 16px ${FONT_SANS}`
      const badgePaddingX = 16
      const badgeH = 34
      const badgeW = Math.ceil(ctx.measureText(badgeText).width + badgePaddingX * 2)
      const badgeX = contentX
      const badgeBottomGap = 44
      const badgeY = panelY + panelH - badgeBottomGap - badgeH
      ctx.save()
      roundRectPath(ctx, badgeX, badgeY, badgeW, badgeH, 999)
      const badgeFill = ctx.createLinearGradient(badgeX, badgeY, badgeX + badgeW, badgeY)
      badgeFill.addColorStop(0, 'rgba(0, 255, 136, 0.2)')
      badgeFill.addColorStop(1, 'rgba(0, 212, 255, 0.14)')
      ctx.fillStyle = badgeFill
      ctx.fill()
      ctx.strokeStyle = `rgba(${THEME.greenRgb}, 0.45)`
      ctx.lineWidth = 1
      ctx.stroke()
      ctx.restore()
      ctx.fillStyle = '#d1fae5'
      ctx.textBaseline = 'middle'
      ctx.fillText(badgeText, badgeX + badgePaddingX, badgeY + badgeH / 2 + 0.5)
      ctx.textBaseline = 'alphabetic'

      drawPanelNeonFrame(ctx, panelX, panelY, panelW, panelH, PROMO.cornerR)

      const fileSlug = slug.trim() || 'raffle'
      const fileName = `${fileSlug}-over-threshold-flex.png`
      const pngBlob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((blob) => {
          if (blob) resolve(blob)
          else reject(new Error('Could not create PNG blob'))
        }, 'image/png')
      })

      const nav = typeof navigator !== 'undefined' ? navigator : null
      const shareCapable = !!nav && typeof nav.share === 'function'
      const canShareFile =
        shareCapable &&
        typeof nav.canShare === 'function' &&
        nav.canShare({
          files: [new File([pngBlob], fileName, { type: 'image/png' })],
        })

      if (canShareFile) {
        try {
          await nav.share({
            title: safeTitle,
            text: 'Post this flex — over-threshold ticket revenue on Owltopia',
            files: [new File([pngBlob], fileName, { type: 'image/png' })],
          })
          setMessage('Use Save Image in the share sheet')
          return
        } catch (shareErr) {
          if (shareErr instanceof DOMException && shareErr.name === 'AbortError') {
            setMessage('Save cancelled')
            return
          }
        }
      }

      const blobUrl = window.URL.createObjectURL(pngBlob)
      if (isLikelyMobile()) {
        window.open(blobUrl, '_blank', 'noopener,noreferrer')
        window.setTimeout(() => window.URL.revokeObjectURL(blobUrl), 60_000)
        setMessage('Image opened - long-press to save')
      } else {
        const download = document.createElement('a')
        download.href = blobUrl
        download.download = fileName
        document.body.appendChild(download)
        download.click()
        download.remove()
        window.setTimeout(() => window.URL.revokeObjectURL(blobUrl), 10_000)
        setMessage('PNG downloaded')
      }
    } catch {
      setMessage('Could not generate PNG')
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
        className={`min-h-[44px] touch-manipulation border-emerald-500/50 bg-emerald-500/5 hover:bg-emerald-500/10 ${fullWidth ? 'w-full' : ''}`.trim()}
        onClick={() => void onGenerate()}
        disabled={busy}
        aria-label="Download over-threshold flex PNG for social"
      >
        <ImageDown className="mr-2 h-4 w-4 shrink-0" />
        {busy ? 'Generating…' : buttonLabel}
      </Button>
      {message ? <p className="mt-1 text-xs text-muted-foreground">{message}</p> : null}
    </div>
  )
}
