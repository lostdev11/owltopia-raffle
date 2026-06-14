'use client'

import { useCallback, useEffect, useState, type ReactNode } from 'react'
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

const PANEL_LABEL = 'metadata_refresh.sys · WALLET DISPLAY'

function AlertBox({ children, tone }: { children: ReactNode; tone: 'warn' | 'error' }) {
  const styles =
    tone === 'error'
      ? 'border-[#FF9C9C]/30 bg-[#FF9C9C]/10 text-[#FF9C9C]'
      : 'border-[#FFD769]/30 bg-[#FFD769]/10 text-[#FFD769]'
  return (
    <p className={`rounded border px-3 py-2.5 text-sm leading-relaxed ${styles}`}>{children}</p>
  )
}

export function MetadataRefreshPanel({
  launchId,
  anchorId = 'metadata-refresh',
}: {
  launchId: string
  anchorId?: string
}) {
  const [status, setStatus] = useState<RefreshStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setErr(null)
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
      <CommandCard label={PANEL_LABEL} id={anchorId}>
        <p className="font-mono text-xs text-[#5C6773]">Loading metadata refresh…</p>
      </CommandCard>
    )
  }

  if (status?.mint_mode === 'gen2_full') {
    return null
  }

  const needsCount = status?.mints.filter((m) => m.needs_refresh).length ?? 0

  return (
    <CommandCard label={PANEL_LABEL} id={anchorId}>
      <p className="mb-4 text-sm leading-relaxed text-[#9BA8B4] sm:text-xs">
        Fixes mints that show only <strong className="font-normal text-[#C5D0D8]">#N</strong> or a blank image in
        Phantom/Solflare on mobile. Updates on-chain name + metadata URI (Irys gateway + collection title).
      </p>

      <div className="mb-4 space-y-3">
        {err && !status ? (
          <AlertBox tone="error">
            Connect an admin wallet, tap Sign in, then retry. ({err})
          </AlertBox>
        ) : null}

        {!status?.enabled ? (
          <AlertBox tone="warn">
            Set <code className="break-all text-[#C5D0D8]">IRYS_PRIVATE_KEY</code> on the server to enable refresh.
          </AlertBox>
        ) : null}

        {!status?.collection_mint ? (
          <AlertBox tone="warn">Deploy the Candy Machine first — refresh needs a live collection mint.</AlertBox>
        ) : null}
      </div>

      {status?.minted_count === 0 ? (
        <p className="text-sm leading-relaxed text-[#9BA8B4]">
          No recorded mints yet — refresh appears after confirm-mint saves wallet mints.
        </p>
      ) : (
        <p className="mb-3 font-mono text-xs leading-relaxed text-[#9BA8B4]">
          {status?.minted_count} recorded mint{status?.minted_count === 1 ? '' : 's'}
          {needsCount > 0 ? ` · ${needsCount} need refresh` : ' · all look current'}
        </p>
      )}

      {status?.mints?.length ? (
        <ul className="mb-4 max-h-56 space-y-2 overflow-y-auto overscroll-y-contain rounded border border-[#1A222B] bg-[#0B0F13] p-3 font-mono text-xs leading-relaxed text-[#9BA8B4] sm:max-h-48 sm:text-[11px]">
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

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        <DeployButton
          type="button"
          className="w-full px-4 text-sm sm:w-auto sm:px-6"
          disabled={busy || !status?.eligible || needsCount === 0}
          onClick={() => void refreshAll()}
        >
          {busy ? (
            <>
              <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
              Refreshing…
            </>
          ) : (
            <>
              <span className="sm:hidden">Refresh metadata{needsCount ? ` (${needsCount})` : ''}</span>
              <span className="hidden sm:inline">Refresh wallet metadata{needsCount ? ` (${needsCount})` : ''}</span>
            </>
          )}
        </DeployButton>

        {err && !status ? (
          <DeployButton type="button" variant="ghost" className="w-full sm:w-auto" onClick={() => void load()}>
            Retry status
          </DeployButton>
        ) : null}
      </div>

      {err && status ? <p className="mt-3 font-mono text-xs leading-relaxed text-[#FF9C9C]">{err}</p> : null}
      {msg ? <p className="mt-3 font-mono text-xs leading-relaxed text-[#00FF9C]">{msg}</p> : null}
    </CommandCard>
  )
}
