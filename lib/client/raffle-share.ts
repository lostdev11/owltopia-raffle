import type { Raffle } from '@/lib/types'
import { buildRaffleHostWalletShareLine } from '@/lib/raffles/host-wallet-copy'
import {
  buildOwltopiaRaffleShareText,
  buildOwltopiaRaffleXIntentUrl,
} from '@/lib/raffles/owltopia-share-text'
import { openAdminTweetMirrorRequest } from '@/lib/client/admin-tweet-mirror-host'
import { openRaffleShareCopyRequest } from '@/lib/client/raffle-share-copy-host'

function isMobileNativeSharePreferred(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.share === 'function' &&
    ((typeof navigator.maxTouchPoints === 'number' && navigator.maxTouchPoints > 0) ||
      (typeof window.matchMedia === 'function' &&
        window.matchMedia('(hover: none), (pointer: coarse)').matches))
  )
}

export async function mirrorAdminTweetShareToDiscord(
  raffleId: string,
  tweetUrl: string
): Promise<{ ok: boolean; error?: string; discordContent?: string }> {
  try {
    const res = await fetch('/api/admin/raffle-x-share/discord', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ raffleId, tweetUrl }),
    })
    const data = (await res.json().catch(() => ({}))) as {
      error?: string
      discordContent?: string
    }
    if (!res.ok) {
      return { ok: false, error: typeof data.error === 'string' ? data.error : 'Discord mirror failed' }
    }
    return {
      ok: true,
      discordContent: typeof data.discordContent === 'string' ? data.discordContent : undefined,
    }
  } catch (e) {
    console.warn('[raffle-share] Discord mirror error', e)
    return { ok: false, error: 'Discord mirror request failed' }
  }
}

export async function mirrorAdminTweetSharesBatchToDiscord(
  tweetUrlsText: string
): Promise<{ ok: boolean; error?: string; posted?: number }> {
  try {
    const res = await fetch('/api/admin/raffle-x-share/discord/batch', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tweetUrlsText }),
    })
    const data = (await res.json().catch(() => ({}))) as { error?: string; posted?: number }
    if (!res.ok) {
      return { ok: false, error: typeof data.error === 'string' ? data.error : 'Discord batch mirror failed' }
    }
    return { ok: true, posted: typeof data.posted === 'number' ? data.posted : undefined }
  } catch (e) {
    console.warn('[raffle-share] Discord batch mirror error', e)
    return { ok: false, error: 'Discord batch mirror request failed' }
  }
}

export async function shareRaffleFromBrowser(params: {
  raffle: Raffle
  /** Full admin (Owl Vision) — uses OWLTOPIA block + platform #x-post mirror dialog. */
  isFullAdmin: boolean
  onCopied?: () => void
}): Promise<void> {
  const { raffle, isFullAdmin, onCopied } = params
  if (typeof window === 'undefined') return

  const pageUrl = `${window.location.origin}/raffles/${raffle.slug}`

  if (isFullAdmin) {
    const text = buildOwltopiaRaffleShareText(raffle)
    const intentUrl = buildOwltopiaRaffleXIntentUrl(raffle)

    let postedViaNativeShare = false
    if (isMobileNativeSharePreferred()) {
      try {
        await navigator.share({ text, title: 'Owltopia raffle' })
        postedViaNativeShare = true
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return
      }
    }
    if (!postedViaNativeShare) {
      window.open(intentUrl, '_blank', 'noopener,noreferrer')
    }

    openAdminTweetMirrorRequest({
      raffleId: raffle.id,
      raffleTitle: raffle.title.trim() || 'Raffle',
    })

    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text)
        onCopied?.()
        return
      } catch {
        // Clipboard denied — X intent + mirror dialog still ran.
      }
    }
    return
  }

  const hostWalletLine = buildRaffleHostWalletShareLine(raffle)
  const shareText = [
    `Check out this raffle: ${raffle.title}`,
    hostWalletLine,
    pageUrl,
  ]
    .filter(Boolean)
    .join('\n')

  const shareData = {
    title: raffle.title,
    text: shareText,
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
      await navigator.clipboard.writeText(shareText)
      onCopied?.()
      return
    } catch {
      // Fall through to prompt.
    }
  }

  openRaffleShareCopyRequest({
    title: raffle.title,
    shareText,
    onCopied,
  })
}
