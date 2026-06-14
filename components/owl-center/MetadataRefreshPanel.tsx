'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'

import { CommandCard } from '@/components/owl-center/CommandCard'
import { DeployButton } from '@/components/owl-center/DeployButton'

type MintPreview = {
  mint: string
  token_index: string | null
  current_name: string | null
  current_uri: string | null
  target_name: string | null
  target_uri: string | null
  needs_refresh: boolean
  skip_reason: string | null
}

type RefreshStatus = {
  enabled: boolean
  eligible: boolean
  arweave_ready: boolean
  mint_mode: string | null
  collection_mint: string | null
  minted_count: number
  mint_addresses: string[]
  mints: MintPreview[]
}

export function MetadataRefreshPanel({ launchId }: { launchId: string }) {
  const [status, setStatus] = useState<RefreshStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/owl-center/collections/${launchId}/metadata-refresh`, {
        credentials: 'include',
        cache: 'no-store',
      })
      const j = (await res.json()) as RefreshStatus & { error?: string }
      if (!res.ok) throw new Error(j.error || 'load_failed')
      setStatus(j)
    } catch (e) {
      setStatus(null)
      setErr(e instanceof Error ? e.message : 'load_failed')
    } finally {
      setLoading(false)
    }
  }, [launchId])

  useEffect(() => {
    void load()
  }, [load])

  async function refreshAll() {
    setBusy(true)
    setErr(null)
    setMsg(null)
    try {
      const res = await fetch(`/api/admin/owl-center/collections/${launchId}/metadata-refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'refresh_all' }),
      })
      const j = (await res.json()) as {
        ok?: boolean
        error?: string
        refreshed?: { mint: string; signature?: string }[]
        skipped?: { mint: string; error?: string }[]
      }
      if (!res.ok || !j.ok) throw new Error(j.error || 'refresh_failed')
      const okCount = j.refreshed?.length ?? 0
      const skipCount = j.skipped?.length ?? 0
      setMsg(`Updated ${okCount} mint${okCount === 1 ? '' : 's'} on-chain${skipCount ? ` · ${skipCount} skipped` : ''}.`)
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'refresh_failed')
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <CommandCard label="metadata_refresh.sys">
        <p className="font-mono text-xs text-[#5C6773]">Loading metadata refresh…</p>
      </CommandCard>
    )
  }

  if (status?.mint_mode === 'gen2_full') {
    return null
  }

  const needsCount = status?.mints.filter((m) => m.needs_refresh).length ?? 0

  return (
    <CommandCard label="metadata_refresh.sys · WALLET DISPLAY">
      <p className="mb-4 text-xs leading-relaxed text-[#9BA8B4]">
        Fixes mints that show only <strong className="font-normal text-[#C5D0D8]">#N</strong> or a blank image in
        Phantom/Solflare. Rewrites on-chain name + metadata URI to the Irys gateway and collection-prefixed title (uses{' '}
        <code className="text-[#7D8A93]">IRYS_PRIVATE_KEY</code> deployer as update authority).
      </p>

      {!status?.enabled ? (
        <p className="rounded border border-[#FFD769]/30 bg-[#FFD769]/10 px-3 py-2 text-sm text-[#FFD769]">
          Set <code className="text-[#C5D0D8]">IRYS_PRIVATE_KEY</code> on the server to enable metadata refresh.
        </p>
      ) : null}

      {!status?.collection_mint ? (
        <p className="rounded border border-[#FFD769]/30 bg-[#FFD769]/10 px-3 py-2 text-sm text-[#FFD769]">
          Deploy the Candy Machine first — refresh needs a live collection mint.
        </p>
      ) : null}

      {status?.minted_count === 0 ? (
        <p className="text-sm text-[#9BA8B4]">No recorded mints yet — refresh appears after confirm-mint saves wallet mints.</p>
      ) : (
        <p className="mb-3 font-mono text-xs text-[#9BA8B4]">
          {status?.minted_count} recorded mint{status?.minted_count === 1 ? '' : 's'}
          {needsCount > 0 ? ` · ${needsCount} need refresh` : ' · all look current'}
        </p>
      )}

      {status?.mints?.length ? (
        <ul className="mb-4 max-h-48 space-y-2 overflow-y-auto rounded border border-[#1A222B] bg-[#0B0F13] p-3 font-mono text-[11px] text-[#9BA8B4]">
          {status.mints.map((m) => (
            <li key={m.mint} className="break-all">
              <span className="text-[#C5D0D8]">{m.target_name ?? m.current_name ?? m.mint.slice(0, 8)}</span>
              {m.needs_refresh ? (
                <span className="text-[#FFD769]"> · needs refresh</span>
              ) : m.skip_reason ? (
                <span className="text-[#5C6773]"> · {m.skip_reason}</span>
              ) : (
                <span className="text-[#00FF9C]"> · ok</span>
              )}
            </li>
          ))}
        </ul>
      ) : null}

      <DeployButton
        type="button"
        className="min-h-[44px] w-full touch-manipulation sm:w-auto"
        disabled={busy || !status?.eligible || needsCount === 0}
        onClick={() => void refreshAll()}
      >
        {busy ? (
          <>
            <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
            Refreshing…
          </>
        ) : (
          `Refresh wallet metadata${needsCount ? ` (${needsCount})` : ''}`
        )}
      </DeployButton>

      {err ? <p className="mt-3 font-mono text-xs text-[#FF9C9C]">{err}</p> : null}
      {msg ? <p className="mt-3 font-mono text-xs text-[#00FF9C]">{msg}</p> : null}
    </CommandCard>
  )
}
