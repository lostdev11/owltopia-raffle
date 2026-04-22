'use client'

import { useState } from 'react'
import { Share2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

type GiveawayShareButtonProps = {
  title: string
  className?: string
}

export function GiveawayShareButton({ title, className }: GiveawayShareButtonProps) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const clearMessageSoon = () => {
    window.setTimeout(() => setMessage(null), 2200)
  }

  const onShare = async () => {
    if (typeof window === 'undefined') return
    setBusy(true)
    setMessage(null)
    try {
      const url = window.location.href
      if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
        await navigator.share({
          title,
          text: `Check out this giveaway on Owltopia: ${title}`,
          url,
        })
        setMessage('Shared')
      } else if (
        typeof navigator !== 'undefined' &&
        navigator.clipboard &&
        typeof navigator.clipboard.writeText === 'function'
      ) {
        await navigator.clipboard.writeText(url)
        setMessage('Link copied')
      } else {
        setMessage('Sharing unavailable')
      }
    } catch {
      setMessage('Share cancelled')
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
        className="min-h-[44px] w-full touch-manipulation"
        onClick={() => void onShare()}
        disabled={busy}
        aria-label="Share giveaway"
      >
        <Share2 className="mr-2 h-4 w-4" />
        {busy ? 'Sharing…' : 'Share giveaway'}
      </Button>
      {message ? <p className="mt-1 text-xs text-muted-foreground">{message}</p> : null}
    </div>
  )
}
