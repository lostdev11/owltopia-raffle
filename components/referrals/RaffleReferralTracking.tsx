'use client'

import { useEffect, useRef } from 'react'
import { useSearchParams } from 'next/navigation'

/** Captures ?ref= on eligible raffle pages (server sets httpOnly cookie). */
export function RaffleReferralCapture({ slug }: { slug: string }) {
  const searchParams = useSearchParams()
  const capturedRef = useRef<string | null>(null)

  useEffect(() => {
    const raw = searchParams.get('ref')
    if (!raw?.trim()) return
    const key = `${slug}:${raw.trim().toLowerCase()}`
    if (capturedRef.current === key) return
    capturedRef.current = key
    void fetch(
      `/api/raffles/${encodeURIComponent(slug)}/referral-capture?ref=${encodeURIComponent(raw.trim())}`,
      { credentials: 'include', cache: 'no-store' }
    )
  }, [searchParams, slug])

  return null
}

function getOrCreateSessionId(): string {
  if (typeof window === 'undefined') return ''
  const key = 'owl_raffle_view_session'
  try {
    let id = sessionStorage.getItem(key)
    if (!id) {
      id =
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`
      sessionStorage.setItem(key, id)
    }
    return id
  } catch {
    return `${Date.now()}`
  }
}

/** One view event per page load (deduped server-side by session + raffle). */
export function RaffleViewTracker({
  slug,
  viewerWallet,
}: {
  slug: string
  viewerWallet?: string | null
}) {
  const sentRef = useRef(false)

  useEffect(() => {
    if (sentRef.current) return
    sentRef.current = true
    const sessionId = getOrCreateSessionId()
    void fetch(`/api/raffles/${encodeURIComponent(slug)}/view`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        viewerWallet: viewerWallet?.trim() || undefined,
      }),
    }).catch(() => {})
  }, [slug, viewerWallet])

  return null
}
