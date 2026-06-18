'use client'

import { useEffect, useState } from 'react'
import { Check, Copy, Share2 } from 'lucide-react'

import { CommandCardSection } from '@/components/owl-center/CommandCardSection'
import { mintShortUrl } from '@/lib/owl-center/mint-share'

type Props = {
  slug: string
  collectionName: string
  embedded?: boolean
  anchorId?: string
  /** Skip the top divider when rendered as the first section in a card. */
  first?: boolean
}

const PANEL_LABEL = 'share.sys · MINT LINK'

export function MintShareLinkPanel({ slug, collectionName, embedded, anchorId, first }: Props) {
  const [shortUrl, setShortUrl] = useState('')
  const [copied, setCopied] = useState(false)
  const [shareMsg, setShareMsg] = useState<string | null>(null)
  const [canNativeShare, setCanNativeShare] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    setShortUrl(mintShortUrl(window.location.origin, slug))
    setCanNativeShare(typeof navigator !== 'undefined' && typeof navigator.share === 'function')
  }, [slug])

  const onCopy = async () => {
    if (!shortUrl) return
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shortUrl)
        setCopied(true)
        window.setTimeout(() => setCopied(false), 2000)
      }
    } catch {
      setShareMsg('Copy failed — long-press the link to copy')
      window.setTimeout(() => setShareMsg(null), 2500)
    }
  }

  const onShare = async () => {
    if (!shortUrl) return
    const text = `Mint ${collectionName} on Owl Center:`
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
        await navigator.share({ title: collectionName, text, url: shortUrl })
        setShareMsg('Shared')
      } else {
        await onCopy()
      }
    } catch {
      setShareMsg('Share cancelled')
    } finally {
      window.setTimeout(() => setShareMsg(null), 2500)
    }
  }

  const content = (
    <div className="space-y-3">
      <div className="flex items-center gap-2 rounded-md border border-[#1A222B] bg-[#0F1419] px-3 py-2.5">
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-[#9BA8B4]">
          {shortUrl || '…'}
        </span>
        <button
          type="button"
          onClick={() => void onCopy()}
          disabled={!shortUrl}
          className="inline-flex h-9 shrink-0 touch-manipulation items-center gap-1.5 rounded border border-[#00FF9C]/35 px-3 font-mono text-[11px] font-bold uppercase tracking-widest text-[#00FF9C] hover:bg-[#00FF9C]/10 disabled:opacity-50"
          aria-label="Copy mint link"
        >
          {copied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>

      {canNativeShare ? (
        <button
          type="button"
          onClick={() => void onShare()}
          className="inline-flex min-h-[44px] w-full touch-manipulation items-center justify-center gap-2 rounded-md border border-[#1A222B] bg-[#0F1419] px-4 font-mono text-xs uppercase tracking-widest text-[#F4FBF8] hover:border-[#00FF9C]/35"
          aria-label="Share mint link"
        >
          <Share2 className="h-4 w-4 shrink-0" aria-hidden />
          Share mint link
        </button>
      ) : null}

      {shareMsg ? <p className="text-center font-mono text-[10px] text-[#9BA8B4]">{shareMsg}</p> : null}
      <p className="font-mono text-[10px] leading-snug text-[#5C6773]">
        Short link — X, Discord, and iMessage show the collection art preview.
      </p>
    </div>
  )

  if (embedded) {
    return (
      <CommandCardSection id={anchorId} label={PANEL_LABEL} first={first}>
        {content}
      </CommandCardSection>
    )
  }

  return content
}
