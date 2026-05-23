import type { Raffle } from '@/lib/types'
import {
  buildOwltopiaRaffleShareText,
  buildOwltopiaRaffleXIntentUrl,
} from '@/lib/raffles/owltopia-share-text'

function isMobileNativeSharePreferred(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.share === 'function' &&
    ((typeof navigator.maxTouchPoints === 'number' && navigator.maxTouchPoints > 0) ||
      (typeof window.matchMedia === 'function' &&
        window.matchMedia('(hover: none), (pointer: coarse)').matches))
  )
}

async function mirrorAdminShareToDiscord(raffleId: string): Promise<void> {
  try {
    const res = await fetch('/api/admin/raffle-x-share/discord', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ raffleId }),
    })
    if (!res.ok) {
      console.warn('[raffle-share] Discord mirror failed', await res.text().catch(() => ''))
    }
  } catch (e) {
    console.warn('[raffle-share] Discord mirror error', e)
  }
}

export async function shareRaffleFromBrowser(params: {
  raffle: Raffle
  /** Full admin (Owl Vision) — uses OWLTOPIA block + mirrors to #x-post. */
  isFullAdmin: boolean
  onCopied?: () => void
}): Promise<void> {
  const { raffle, isFullAdmin, onCopied } = params
  if (typeof window === 'undefined') return

  const pageUrl = `${window.location.origin}/raffles/${raffle.slug}`

  if (isFullAdmin) {
    const text = buildOwltopiaRaffleShareText(raffle)
    const intentUrl = buildOwltopiaRaffleXIntentUrl(raffle)

    if (isMobileNativeSharePreferred()) {
      try {
        await navigator.share({ text, title: 'Owltopia raffle' })
        await mirrorAdminShareToDiscord(raffle.id)
        return
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return
      }
    }

    window.open(intentUrl, '_blank', 'noopener,noreferrer')
    void mirrorAdminShareToDiscord(raffle.id)

    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text)
        onCopied?.()
        return
      } catch {
        // Clipboard denied — X intent + Discord mirror still ran.
      }
    }
    return
  }

  const shareData = {
    title: raffle.title,
    text: `Check out this raffle: ${raffle.title}`,
    url: pageUrl,
  }

  if (isMobileNativeSharePreferred()) {
    try {
      await navigator.share(shareData)
      return
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return
    }
  }

  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(pageUrl)
      onCopied?.()
      return
    } catch {
      // Fall through to prompt.
    }
  }

  window.prompt('Copy raffle link:', pageUrl)
}
