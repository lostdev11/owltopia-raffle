'use client'

import { useState } from 'react'
import { Share2 } from 'lucide-react'

import type { Gen2WlCheckShareVariant } from '@/lib/owl-center/gen2-wl-check-share'
import { gen2WlCheckSharePath } from '@/lib/owl-center/gen2-wl-check-share'

type Props = {
  wallet: string
  snapshotVariant: Gen2WlCheckShareVariant
}

function shareText(variant: Gen2WlCheckShareVariant): string {
  switch (variant) {
    case 'eligible_active':
      return 'I’m eligible to mint Owltopia Gen2 — check my WL status:'
    case 'eligible_assigned':
      return 'I have Owltopia Gen2 WL mint spots — verify here:'
    case 'pending_allocation':
      return 'I’m on the Owltopia Gen2 Discord WL — status:'
    case 'used_up':
      return 'I minted my Owltopia Gen2 WL allocation — proof:'
    default:
      return 'Check my Owltopia Gen2 WL status:'
  }
}

export function Gen2WlShareActions({ wallet, snapshotVariant }: Props) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const onShare = async () => {
    if (typeof window === 'undefined') return
    setBusy(true)
    setMessage(null)
    const path = gen2WlCheckSharePath(wallet)
    const url = `${window.location.origin}${path}`
    const text = shareText(snapshotVariant)
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
        await navigator.share({ title: 'Owltopia Gen2 WL', text, url })
        setMessage('Shared')
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(`${text}\n${url}`)
        setMessage('Link copied')
      } else {
        setMessage('Copy the URL from your browser bar')
      }
    } catch {
      setMessage('Share cancelled')
    } finally {
      setBusy(false)
      window.setTimeout(() => setMessage(null), 2500)
    }
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => void onShare()}
        disabled={busy}
        className="inline-flex min-h-[44px] w-full touch-manipulation items-center justify-center gap-2 rounded-md border border-[#1A222B] bg-[#0F1419] px-4 font-mono text-xs uppercase tracking-widest text-[#F4FBF8] hover:border-[#00FF9C]/35 disabled:opacity-50"
        aria-label="Share Gen2 WL status"
      >
        <Share2 className="h-4 w-4 shrink-0" aria-hidden />
        {busy ? 'Sharing…' : 'Share WL card'}
      </button>
      {message ? <p className="text-center font-mono text-[10px] text-[#9BA8B4]">{message}</p> : null}
      <p className="text-center font-mono text-[10px] leading-snug text-[#5C6773]">
        X, Discord, and iMessage load the preview image from this link.
      </p>
    </div>
  )
}
