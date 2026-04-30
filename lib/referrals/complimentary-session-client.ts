'use client'

type SessionResponse = {
  showComplimentaryHint?: boolean
  complimentaryLifetimeAvailable?: boolean
}

const sessionCache = new Map<string, { show: boolean }>()
const sessionInflight = new Map<string, Promise<{ show: boolean }>>()

/** Call after a successful referral complimentary confirm so hints refresh without a full reload. */
export function clearReferralComplimentarySessionCache(): void {
  sessionCache.clear()
  sessionInflight.clear()
}

export function fetchReferralComplimentarySessionOnce(
  walletAddress?: string | null
): Promise<{ show: boolean }> {
  const key = (walletAddress ?? '').trim()
  const cached = sessionCache.get(key)
  if (cached) return Promise.resolve(cached)

  let inflight = sessionInflight.get(key)
  if (inflight) return inflight

  const q = key ? `?wallet=${encodeURIComponent(key)}` : ''
  inflight = fetch(`/api/referrals/session${q}`, {
    credentials: 'include',
    cache: 'no-store',
  })
    .then((r) => (r.ok ? r.json() : {}))
    .then((data: SessionResponse) => {
      const cookieOk = data.showComplimentaryHint === true
      const lifetimeOk = data.complimentaryLifetimeAvailable !== false
      const out = { show: cookieOk && lifetimeOk }
      sessionCache.set(key, out)
      return out
    })
    .catch(() => {
      const out = { show: false }
      sessionCache.set(key, out)
      return out
    })
    .finally(() => {
      sessionInflight.delete(key)
    })

  sessionInflight.set(key, inflight)
  return inflight
}
