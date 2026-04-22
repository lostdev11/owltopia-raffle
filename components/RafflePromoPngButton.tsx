'use client'

import { useState } from 'react'
import { ImageDown } from 'lucide-react'
import { Button } from '@/components/ui/button'

type RafflePromoPngButtonProps = {
  title: string
  slug: string
  ticketPrice?: number
  currency?: string
  endTime?: string | null
  imageUrl?: string | null
  className?: string
  buttonLabel?: string
  fullWidth?: boolean
  sharePathPrefix?: string
  metaLine?: string
}

const WIDTH = 1200
const HEIGHT = 675

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

function drawWrappedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  maxLines: number
) {
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
  return lines.map((line, index) => {
    ctx.fillText(line, x, y + lineHeight * index)
    return line
  }).length
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

export function RafflePromoPngButton({
  title,
  slug,
  ticketPrice,
  currency,
  endTime,
  imageUrl,
  className,
  buttonLabel = 'Download PNG for X',
  fullWidth = true,
  sharePathPrefix = '/raffles/',
  metaLine,
}: RafflePromoPngButtonProps) {
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
      const canvas = document.createElement('canvas')
      canvas.width = WIDTH
      canvas.height = HEIGHT
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('Canvas unavailable')

      const safePrefix = sharePathPrefix.startsWith('/') ? sharePathPrefix : `/${sharePathPrefix}`
      const raffleUrl = `${window.location.origin}${safePrefix}${slug}`
      const compactUrl = raffleUrl.replace(/^https?:\/\//i, '')
      const safeTitle = clampText(title || 'Owltopia Raffle', 120)
      const safeCurrency = (currency || 'SOL').trim().toUpperCase()
      const safeEndDate = endTime ? new Date(endTime) : null
      const endsLabel =
        safeEndDate && !Number.isNaN(safeEndDate.getTime())
          ? `Ends ${safeEndDate.toLocaleDateString()}`
          : 'Ends soon'
      const infoLine =
        ticketPrice != null && Number.isFinite(ticketPrice)
          ? `Ticket: ${ticketPrice} ${safeCurrency}`
          : clampText(metaLine?.trim() || 'Join the Owltopia giveaway', 56)

      const bg = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT)
      bg.addColorStop(0, '#060b16')
      bg.addColorStop(0.52, '#0a1222')
      bg.addColorStop(1, '#111827')
      ctx.fillStyle = bg
      ctx.fillRect(0, 0, WIDTH, HEIGHT)

      const accent = ctx.createRadialGradient(WIDTH - 64, 18, 10, WIDTH - 64, 18, 400)
      accent.addColorStop(0, 'rgba(34, 211, 238, 0.2)')
      accent.addColorStop(1, 'rgba(34, 211, 238, 0)')
      ctx.fillStyle = accent
      ctx.fillRect(0, 0, WIDTH, HEIGHT)

      const panelX = 44
      const panelY = 44
      const panelW = WIDTH - 88
      const panelH = HEIGHT - 88
      ctx.save()
      roundRectPath(ctx, panelX, panelY, panelW, panelH, 28)
      ctx.fillStyle = 'rgba(12, 18, 33, 0.9)'
      ctx.fill()
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.2)'
      ctx.lineWidth = 1
      ctx.stroke()
      ctx.restore()

      const imageBox = { x: 744, y: 88, w: 328, h: 500 }
      const contentX = 96
      const contentMaxW = 590

      ctx.save()
      roundRectPath(ctx, imageBox.x, imageBox.y, imageBox.w, imageBox.h, 20)
      ctx.clip()
      if (imageUrl?.trim()) {
        const loaded = await tryLoadImage(imageUrl)
        if (loaded) {
          const scale = Math.max(imageBox.w / loaded.width, imageBox.h / loaded.height)
          const drawW = loaded.width * scale
          const drawH = loaded.height * scale
          const drawX = imageBox.x - (drawW - imageBox.w) / 2
          const drawY = imageBox.y - (drawH - imageBox.h) / 2
          ctx.drawImage(loaded, drawX, drawY, drawW, drawH)
        } else {
          ctx.fillStyle = 'rgba(71, 85, 105, 0.3)'
          ctx.fillRect(imageBox.x, imageBox.y, imageBox.w, imageBox.h)
        }
      } else {
        ctx.fillStyle = 'rgba(71, 85, 105, 0.3)'
        ctx.fillRect(imageBox.x, imageBox.y, imageBox.w, imageBox.h)
      }
      ctx.restore()

      const imageShade = ctx.createLinearGradient(0, imageBox.y, 0, imageBox.y + imageBox.h)
      imageShade.addColorStop(0, 'rgba(2, 6, 23, 0)')
      imageShade.addColorStop(1, 'rgba(2, 6, 23, 0.35)')
      ctx.save()
      roundRectPath(ctx, imageBox.x, imageBox.y, imageBox.w, imageBox.h, 20)
      ctx.clip()
      ctx.fillStyle = imageShade
      ctx.fillRect(imageBox.x, imageBox.y, imageBox.w, imageBox.h)
      ctx.restore()

      ctx.fillStyle = '#67e8f9'
      ctx.font = '600 24px Inter, system-ui, sans-serif'
      ctx.fillText('OWLTOPIA', contentX, 112)

      ctx.fillStyle = '#f8fafc'
      ctx.font = '700 56px Inter, system-ui, sans-serif'
      const lineCount = drawWrappedText(ctx, safeTitle, contentX, 198, contentMaxW, 66, 3)
      const infoY = 198 + lineCount * 66 + 36

      ctx.fillStyle = '#cbd5e1'
      ctx.font = '500 29px Inter, system-ui, sans-serif'
      ctx.fillText(infoLine, contentX, infoY)
      ctx.fillText(endsLabel, contentX, infoY + 46)

      const footerY = panelY + panelH - 54
      ctx.fillStyle = 'rgba(148, 163, 184, 0.2)'
      ctx.fillRect(panelX + 52, footerY - 36, panelW - 104, 1)
      ctx.fillStyle = '#94a3b8'
      ctx.font = '500 22px Inter, system-ui, sans-serif'
      ctx.fillText(compactUrl, contentX, footerY)

      const fileSlug = slug.trim() || 'raffle'
      const fileName = `${fileSlug}-x-card.png`
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
            text: 'Save this PNG and post it on X',
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
        className={`min-h-[44px] touch-manipulation ${fullWidth ? 'w-full' : ''}`.trim()}
        onClick={() => void onGenerate()}
        disabled={busy}
        aria-label="Download raffle promo PNG"
      >
        <ImageDown className="mr-2 h-4 w-4" />
        {busy ? 'Generating…' : buttonLabel}
      </Button>
      {message ? <p className="mt-1 text-xs text-muted-foreground">{message}</p> : null}
    </div>
  )
}
