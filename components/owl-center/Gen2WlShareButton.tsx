'use client'

import { useMemo, useState } from 'react'
import { Share2 } from 'lucide-react'

import type { Gen2MintCheckResponse } from '@/lib/owl-center/types'
import { gen2WlCheckSharePath } from '@/lib/owl-center/gen2-wl-check-share'

type Props = {
  wallet: string
  mintCheck: Gen2MintCheckResponse | null
}

function canShowShare(mintCheck: Gen2MintCheckResponse | null): boolean {
  const wl = mintCheck?.phases.find((p) => p.phase === 'WHITELIST')
  if (!wl?.wl) return false
  if ((wl.wl.available_mints ?? 0) > 0) return true
  if (wl.wl.discord_whitelist && (wl.wl.allowed_mints ?? 0) === 0) return true
  if ((wl.wl.allowed_mints ?? 0) > 0 && (wl.wl.available_mints ?? 0) <= 0) return true
  return false
}

export function Gen2WlShareButton({ wallet, mintCheck }: Props) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const visible = useMemo(() => canShowShare(mintCheck), [mintCheck])

  if (!visible) return null

  const onShare = async () => {
    if (typeof window === 'undefined') return
    setBusy(true)
    setMessage(null)
    const path = gen2WlCheckSharePath(wallet)
    const url = `${window.location.origin}${path}`
    const wl = mintCheck?.phases.find((p) => p.phase === 'WHITELIST')
    const text =
      wl?.is_active && wl.is_eligible
        ? 'I’m eligible to mint Owltopia Gen2 — check my WL status:'
        : (wl?.wl?.available_mints ?? 0) > 0
          ? 'I have Owltopia Gen2 WL mint spots — verify here:'
          : wl?.wl?.discord_whitelist
            ? 'I’m on the Owltopia Gen2 Discord WL — status:'
            : 'I minted my Owltopia Gen2 WL allocation — proof:'

    try {
      if (typeof navigator.share === 'function') {
        await navigator.share({ title: 'Owltopia Gen2 WL', text, url })
        setMessage('Shared')
        window.setTimeout(() => setMessage(null), 2200)
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(`${text}\n${url}`)
        setMessage('Copied')
        window.setTimeout(() => setMessage(null), 2200)
      }
    } catch {
      /* cancelled */
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col items-end gap-0.5">
      <button
        type="button"
        onClick={() => void onShare()}
        disabled={busy}
        className="inline-flex min-h-[44px] touch-manipulation items-center gap-1.5 px-3 font-mono text-[10px] uppercase tracking-widest text-[#00FF9C] underline-offset-4 hover:underline disabled:opacity-50"
        aria-label="Share Gen2 WL status card"
      >
        <Share2 className="h-3.5 w-3.5" aria-hidden />
        {busy ? '…' : 'Share WL'}
      </button>
      {message ? <span className="font-mono text-[9px] text-[#5C6773]">{message}</span> : null}
    </div>
  )
}
