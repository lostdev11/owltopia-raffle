'use client'

import { useState } from 'react'
import { ImageDown, Trophy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { computePromoPngArtDrawRect } from '@/lib/promo-png-art-draw'

type RaffleWinnerPngButtonProps = {
  title: string
  slug: string
  imageUrl?: string | null
  winnerWallet: string
  className?: string
  buttonLabel?: string
  fullWidth?: boolean
}

const WIDTH = 1200
const HEIGHT = 675
const FONT_SANS = '"Plus Jakarta Sans", system-ui, sans-serif'

function shortWallet(wallet: string): string {
  const w = wallet.trim()
  if (w.length <= 12) return w
  return `${w.slice(0, 6)}...${w.slice(-4)}`
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

export function RaffleWinnerPngButton({
  title,
  slug,
  imageUrl,
  winnerWallet,
  className,
  buttonLabel = 'Winner PNG',
  fullWidth = false,
}: RaffleWinnerPngButtonProps) {
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
          /* keep going */
        }
      }
      const canvas = document.createElement('canvas')
      canvas.width = WIDTH
      canvas.height = HEIGHT
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('Canvas unavailable')

      const safeTitle = clampText(title || 'Owltopia Raffle', 110)
      const winnerLine = `Winner: ${shortWallet(winnerWallet)}`

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

      // Large centered Owltopia logo in the panel background (gold card stays readable on top).
      {
        const wm = await tryLoadImage(watermarkIconUrl())
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
      if (imageUrl?.trim()) {
        const loaded = await tryLoadImage(imageUrl)
        if (loaded) {
          const { drawX, drawY, drawW, drawH } = computePromoPngArtDrawRect(loaded, artBox, imageUrl)
          ctx.drawImage(loaded, drawX, drawY, drawW, drawH)
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

      ctx.fillStyle = '#facc15'
      ctx.font = `700 28px ${FONT_SANS}`
      ctx.fillText('WINNER SELECTED', textX, panelY + 96)

      ctx.fillStyle = '#fff6d5'
      ctx.font = `800 62px ${FONT_SANS}`
      const titleWords = safeTitle.split(' ')
      const lines: string[] = []
      let current = ''
      for (const word of titleWords) {
        const next = current ? `${current} ${word}` : word
        if (ctx.measureText(next).width <= textMaxW) current = next
        else {
          if (current) lines.push(current)
          current = word
          if (lines.length >= 2) break
        }
      }
      if (current && lines.length < 3) lines.push(current)
      lines.slice(0, 3).forEach((line, i) => {
        ctx.fillText(line, textX, panelY + 170 + i * 72)
      })

      const badgeY = panelY + panelH - 140
      ctx.save()
      roundRectPath(ctx, textX, badgeY, Math.min(textMaxW, 520), 62, 999)
      ctx.fillStyle = 'rgba(250, 204, 21, 0.16)'
      ctx.fill()
      ctx.strokeStyle = 'rgba(250, 204, 21, 0.65)'
      ctx.lineWidth = 1.5
      ctx.stroke()
      ctx.restore()
      ctx.fillStyle = '#fde68a'
      ctx.font = `600 30px ${FONT_SANS}`
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
        setMessage('Winner PNG downloaded')
      }
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
    </div>
  )
}
