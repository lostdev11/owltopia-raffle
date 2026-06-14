'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'

import { CommandCard } from '@/components/owl-center/CommandCard'
import { DeployButton } from '@/components/owl-center/DeployButton'

type DeployStatus = {
  arweave_ready: boolean
  can_deploy: boolean
  onchain_deploy_enabled: boolean
  server_deploy_max_supply: number
  candy_machine_id: string | null
  collection_mint: string | null
  deploy_state: {
    status: string
    error?: string | null
    candy_guard_id?: string | null
  } | null
  mint_mode: string
  terminal_command: string
}

export function SugarDeployPanel({
  launchId,
  onApplied,
}: {
  launchId: string
  onApplied: () => void
}) {
  const [status, setStatus] = useState<DeployStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [manualCm, setManualCm] = useState('')
  const [manualCol, setManualCol] = useState('')

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/owl-center/collections/${launchId}/assets/sugar-deploy`, {
        credentials: 'include',
        cache: 'no-store',
      })
      const j = (await res.json()) as DeployStatus & { error?: string }
      if (!res.ok) throw new Error(j.error || 'load_failed')
      setStatus(j)
      if (j.candy_machine_id) setManualCm(j.candy_machine_id)
      if (j.collection_mint) setManualCol(j.collection_mint)
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

  async function deployOnchain() {
    setBusy(true)
    setErr(null)
    setMsg(null)
    try {
      const res = await fetch(`/api/admin/owl-center/collections/${launchId}/assets/sugar-deploy`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'deploy_onchain' }),
      })
      const j = (await res.json()) as {
        ok?: boolean
        error?: string
        result?: { candy_machine_id: string; collection_mint: string; candy_guard_id: string; already_deployed?: boolean }
      }
      if (!res.ok || !j.ok) throw new Error(j.error || 'deploy_failed')
      setMsg(
        j.result?.already_deployed
          ? 'Candy Machine already deployed — IDs synced to marketplace.'
          : `Deployed · CM ${j.result?.candy_machine_id?.slice(0, 8)}… · guard attached.`
      )
      onApplied()
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'deploy_failed')
    } finally {
      setBusy(false)
    }
  }

  async function registerManual() {
    setBusy(true)
    setErr(null)
    setMsg(null)
    try {
      const res = await fetch(`/api/admin/owl-center/collections/${launchId}/assets/sugar-deploy`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'register_ids',
          candy_machine_id: manualCm.trim(),
          collection_mint: manualCol.trim(),
        }),
      })
      const j = (await res.json()) as { ok?: boolean; error?: string }
      if (!res.ok || !j.ok) throw new Error(j.error || 'register_failed')
      setMsg('Candy Machine IDs saved to marketplace.')
      onApplied()
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'register_failed')
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <CommandCard label="phase_b.sys · DEPLOY CM">
        <p className="font-mono text-xs text-[#5C6773]">Loading deploy status…</p>
      </CommandCard>
    )
  }

  if (status?.mint_mode === 'gen2_full') {
    return (
      <CommandCard label="phase_b.sys · DEPLOY CM">
        <p className="text-sm text-[#9BA8B4]">
          Gen2 uses phased guard groups — deploy with Sugar CLI and paste IDs in Marketplace readiness below.
        </p>
      </CommandCard>
    )
  }

  const deployed = Boolean(status?.candy_machine_id && status?.collection_mint)

  return (
    <CommandCard label="phase_b.sys · DEPLOY CM + GUARD">
      <p className="mb-4 text-xs leading-relaxed text-[#9BA8B4]">
        After Arweave upload completes, deploy the Candy Machine and Candy Guard from admin (uses{' '}
        <code className="text-[#7D8A93]">IRYS_PRIVATE_KEY</code> deployer) or run the terminal fallback for large
        collections.
      </p>

      {!status?.arweave_ready ? (
        <p className="rounded border border-[#FFD769]/30 bg-[#FFD769]/10 px-3 py-2 text-sm text-[#FFD769]">
          Finish <strong className="font-normal">Push to Arweave</strong> above before deploying.
        </p>
      ) : null}

      {deployed ? (
        <dl className="mb-4 grid gap-2 font-mono text-xs text-[#9BA8B4] sm:grid-cols-2">
          <div className="sm:col-span-2">
            <dt className="text-[#5C6773]">Candy Machine</dt>
            <dd className="break-all text-[#00FF9C]">{status?.candy_machine_id}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-[#5C6773]">Collection mint</dt>
            <dd className="break-all text-[#00FF9C]">{status?.collection_mint}</dd>
          </div>
          {status?.deploy_state?.candy_guard_id ? (
            <div className="sm:col-span-2">
              <dt className="text-[#5C6773]">Candy Guard</dt>
              <dd className="break-all text-[#C5D0D8]">{status.deploy_state.candy_guard_id}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}

      {status?.deploy_state?.status === 'failed' && status.deploy_state.error ? (
        <p className="mb-4 rounded border border-[#FF9C9C]/30 bg-[#FF9C9C]/10 px-3 py-2 text-sm text-[#FF9C9C]">
          Last deploy failed: {status.deploy_state.error}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-3">
        {status?.can_deploy ? (
          <DeployButton type="button" className="min-h-[44px] touch-manipulation" disabled={busy} onClick={() => void deployOnchain()}>
            {busy ? (
              <>
                <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
                Deploying…
              </>
            ) : (
              'Deploy CM + guard (server)'
            )}
          </DeployButton>
        ) : null}

        {!status?.onchain_deploy_enabled && status?.arweave_ready && !deployed ? (
          <p className="text-xs text-[#FFD769]">Set IRYS_PRIVATE_KEY on the server to enable one-click deploy.</p>
        ) : null}
      </div>

      <details className="mt-4 rounded border border-[#1A222B] bg-[#0B0F13] px-3 py-2">
        <summary className="cursor-pointer touch-manipulation py-2 font-mono text-xs uppercase tracking-wide text-[#9BA8B4]">
          Terminal fallback (Sugar CLI)
        </summary>
        <p className="mt-2 text-xs text-[#9BA8B4]">
          For collections over {status?.server_deploy_max_supply ?? 250} items or if server deploy fails:
        </p>
        <pre className="mt-2 overflow-x-auto rounded bg-[#0F1419] p-3 font-mono text-[11px] text-[#C5D0D8]">
          npm run prepare:sugar-deploy -- --launch-id={launchId}
          {'\n'}
          {status?.terminal_command ?? 'npm run sugar:deploy -- collections/your-folder'}
        </pre>
      </details>

      <div className="mt-4 space-y-3 border-t border-[#1A222B] pt-4">
        <p className="font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">Or paste IDs from Sugar cache</p>
        <label className="grid gap-1 text-sm text-[#C5D0D8]">
          Candy Machine ID
          <input
            value={manualCm}
            onChange={(e) => setManualCm(e.target.value)}
            className="min-h-[44px] touch-manipulation border border-[#1A222B] bg-[#0F1419] px-3 font-mono text-sm"
          />
        </label>
        <label className="grid gap-1 text-sm text-[#C5D0D8]">
          Collection mint
          <input
            value={manualCol}
            onChange={(e) => setManualCol(e.target.value)}
            className="min-h-[44px] touch-manipulation border border-[#1A222B] bg-[#0F1419] px-3 font-mono text-sm"
          />
        </label>
        <DeployButton
          type="button"
          variant="ghost"
          className="min-h-[44px] touch-manipulation"
          disabled={busy || !manualCm.trim() || !manualCol.trim()}
          onClick={() => void registerManual()}
        >
          Save IDs to marketplace
        </DeployButton>
      </div>

      {err ? <p className="mt-3 font-mono text-xs text-[#FF9C9C]">{err}</p> : null}
      {msg ? <p className="mt-3 font-mono text-xs text-[#00FF9C]">{msg}</p> : null}
    </CommandCard>
  )
}
