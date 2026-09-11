'use client'

import { useCallback, useEffect, useState } from 'react'

import { AuthorityModelCard } from '@/components/owl-center/AuthorityModelCard'
import { creatorClaimUpdateAuthorityApiPath } from '@/lib/owl-center/creator-api-paths'
import type { OwlCenterLaunchPublic } from '@/lib/owl-center/types'

type StatusPayload = {
  ok?: boolean
  mint_standard?: string
  collection_mint?: string | null
  creator_wallet?: string | null
  updateAuthority?: string | null
  platformDelegateListed?: boolean
  creatorOwnsUa?: boolean
  canClaim?: boolean
  handoffEnabled?: boolean
  error?: string
}

type Props = {
  launchId: string
  launch: OwlCenterLaunchPublic
  apiPath?: string
  onClaimed?: (launch?: OwlCenterLaunchPublic) => void
  embedded?: boolean
}

export function ClaimUpdateAuthorityPanel({
  launchId,
  launch,
  apiPath,
  onClaimed,
  embedded = false,
}: Props) {
  const path = apiPath ?? creatorClaimUpdateAuthorityApiPath(launchId)
  const [status, setStatus] = useState<StatusPayload | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const refresh = useCallback(async () => {
    setErr(null)
    try {
      const res = await fetch(path, { credentials: 'include', cache: 'no-store' })
      const j = (await res.json()) as StatusPayload
      if (!res.ok) throw new Error(j.error || 'status_failed')
      setStatus(j)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'status_failed')
    }
  }, [path])

  useEffect(() => {
    void refresh()
  }, [refresh])

  if (launch.mint_standard !== 'core') return null
  if (!launch.collection_mint?.trim()) return null

  const canClaim = Boolean(status?.canClaim)
  const owns = Boolean(status?.creatorOwnsUa)

  async function claim() {
    setBusy(true)
    setErr(null)
    setMsg(null)
    try {
      const res = await fetch(path, { method: 'POST', credentials: 'include' })
      const j = (await res.json()) as {
        error?: string
        alreadyClaimed?: boolean
        updateAuthority?: string
        launch?: OwlCenterLaunchPublic
      }
      if (!res.ok) throw new Error(j.error || 'claim_failed')
      setMsg(
        j.alreadyClaimed
          ? 'Update authority already on your creator wallet.'
          : 'You now own update authority. Open Orbis and verify with this same wallet.'
      )
      setConfirmOpen(false)
      await refresh()
      onClaimed?.(j.launch)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'claim_failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={embedded ? 'mt-4 space-y-3' : 'space-y-3 rounded-lg border border-[#2A3540] p-4'}>
      <AuthorityModelCard
        launch={launch}
        onchainUpdateAuthority={status?.updateAuthority}
        compact
      />

      {owns ? (
        <p className="text-sm text-emerald-300">Update authority claimed — use your creator wallet on Orbis.</p>
      ) : canClaim ? (
        <div className="space-y-2">
          <p className="text-sm text-[#C5D0DA]">
            Owltopia still holds root update authority on-chain. Claim it to your creator wallet so Orbis verify works.
          </p>
          {!confirmOpen ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirmOpen(true)}
              className="rounded bg-[#EAFBF4] px-3 py-2 text-sm font-medium text-[#0B1218] disabled:opacity-50"
            >
              Claim update authority
            </button>
          ) : (
            <div className="space-y-2 rounded border border-amber-500/40 bg-amber-500/5 p-3 text-sm text-[#EAFBF4]">
              <p>
                Your creator wallet{' '}
                <span className="font-mono">{launch.creator_wallet}</span> becomes the permanent update authority.
                Owltopia keeps UpdateDelegate for reveal / refresh / thaw. This cannot be undone without your wallet.
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void claim()}
                  className="rounded bg-[#EAFBF4] px-3 py-1.5 text-sm font-medium text-[#0B1218] disabled:opacity-50"
                >
                  {busy ? 'Claiming…' : 'Confirm claim'}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setConfirmOpen(false)}
                  className="rounded border border-[#2A3540] px-3 py-1.5 text-sm text-[#C5D0DA]"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <p className="text-sm text-[#9AA6B2]">
          {status?.handoffEnabled === false
            ? 'Creator UA handoff is disabled on this environment.'
            : 'Claim is not available yet (collection may still be deploying, or authority is not held by Owltopia).'}
        </p>
      )}

      {msg ? <p className="text-sm text-emerald-300">{msg}</p> : null}
      {err ? <p className="text-sm text-red-300">{err}</p> : null}
    </div>
  )
}
