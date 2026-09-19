'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { CheckCircle2, Loader2 } from 'lucide-react'

import { CommandCard } from '@/components/owl-center/CommandCard'
import { DeployButton } from '@/components/owl-center/DeployButton'
import {
  configLineProgressPercent,
  deployPhaseLabel,
  formatConfigLineProgress,
  formatDeploySuccessMessage,
  isDeployWorkInProgress,
  isLikelyDeployTransportError,
} from '@/lib/owl-center/deploy-panel-status'

type DeployStatus = {
  arweave_ready: boolean
  can_deploy: boolean
  can_continue_loading?: boolean
  can_retry_handoff?: boolean
  onchain_deploy_enabled: boolean
  server_deploy_max_supply: number
  tm_server_deploy_max_supply?: number
  config_line_count?: number | null
  over_server_cap?: boolean
  fully_deployed?: boolean
  candy_machine_id: string | null
  collection_mint: string | null
  in_progress_candy_machine_id?: string | null
  in_progress_collection_mint?: string | null
  deploy_state: {
    status: string
    error?: string | null
    candy_guard_id?: string | null
    config_lines_loaded?: number | null
    config_lines_total?: number | null
  } | null
  mint_mode: string
  mint_standard?: string | null
  creator_wallet?: string | null
  terminal_command: string
}

function shortPk(pk: string | null | undefined): string {
  const s = pk?.trim() || ''
  if (s.length < 10) return s || '—'
  return `${s.slice(0, 4)}…${s.slice(-4)}`
}

type GoLiveSummary = {
  ok?: boolean
  already_live?: boolean
  blockers?: string[]
}

type DeployActionResult = {
  candy_machine_id: string
  collection_mint: string
  candy_guard_id: string
  already_deployed?: boolean
  continue_loading?: boolean
  config_lines_loaded?: number
  config_lines_total?: number
  go_live?: GoLiveSummary
}

const POLL_MS = 2_500
const WATCH_AFTER_TRANSPORT_MS = 8 * 60_000

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
  const [watching, setWatching] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [manualCm, setManualCm] = useState('')
  const [manualCol, setManualCol] = useState('')
  const cacheInputRef = useRef<HTMLInputElement>(null)
  const autoContinueRef = useRef(false)
  const statusRef = useRef<DeployStatus | null>(null)
  const onAppliedRef = useRef(onApplied)
  onAppliedRef.current = onApplied

  const applyStatus = useCallback((j: DeployStatus) => {
    statusRef.current = j
    setStatus(j)
    if (j.candy_machine_id) setManualCm(j.candy_machine_id)
    else if (j.in_progress_candy_machine_id) setManualCm(j.in_progress_candy_machine_id)
    if (j.collection_mint) setManualCol(j.collection_mint)
    else if (j.in_progress_collection_mint) setManualCol(j.in_progress_collection_mint)
  }, [])

  const load = useCallback(
    async (opts?: { quiet?: boolean }) => {
      try {
        const res = await fetch(`/api/admin/owl-center/collections/${launchId}/assets/sugar-deploy`, {
          credentials: 'include',
          cache: 'no-store',
        })
        const j = (await res.json()) as DeployStatus & { error?: string }
        if (!res.ok) throw new Error(j.error || 'load_failed')
        applyStatus(j)
        if (!opts?.quiet) setErr(null)
        return j
      } catch (e) {
        // Never wipe a good in-progress snapshot on a flaky poll.
        if (!opts?.quiet && !statusRef.current) {
          setErr(e instanceof Error ? e.message : 'load_failed')
        }
        return null
      } finally {
        setLoading(false)
      }
    },
    [applyStatus, launchId]
  )

  useEffect(() => {
    void load()
  }, [load])

  // Poll while deploying / watching / server-side work is in progress.
  useEffect(() => {
    const shouldPoll = busy || watching || isDeployWorkInProgress(status)
    if (!shouldPoll) return

    let cancelled = false
    const tick = async () => {
      const next = await load({ quiet: true })
      if (cancelled || !next) return

      if (next.fully_deployed) {
        setWatching(false)
        setBusy(false)
        autoContinueRef.current = false
        setErr(null)
        setMsg(
          formatDeploySuccessMessage({
            candyMachineId: next.candy_machine_id || next.in_progress_candy_machine_id || '',
            collectionMint: next.collection_mint || next.in_progress_collection_mint || '',
            goLiveOk: true,
          })
        )
        onAppliedRef.current()
        return
      }

      const progress = formatConfigLineProgress(next)
      const phase = deployPhaseLabel(next.deploy_state?.status)
      if (progress || phase) {
        setMsg(
          [
            watching ? 'Server still working after a network timeout — watching status…' : null,
            phase,
            progress ? `Progress: ${progress}` : null,
            next.in_progress_candy_machine_id
              ? `CM ${shortPk(next.in_progress_candy_machine_id)}`
              : null,
          ]
            .filter(Boolean)
            .join(' · ')
        )
      }

      if (next.deploy_state?.status === 'failed' && next.deploy_state.error) {
        setWatching(false)
        setErr(next.deploy_state.error)
      }
    }

    void tick()
    const id = window.setInterval(() => void tick(), POLL_MS)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [busy, watching, status?.deploy_state?.status, status?.fully_deployed, load])

  async function postDeployOnchain(): Promise<DeployActionResult> {
    const res = await fetch(`/api/admin/owl-center/collections/${launchId}/assets/sugar-deploy`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'deploy_onchain' }),
    })
    const j = (await res.json()) as {
      ok?: boolean
      error?: string
      result?: DeployActionResult
    }
    if (!res.ok || !j.ok || !j.result) {
      throw new Error(j.error || 'deploy_failed')
    }
    return j.result
  }

  async function watchUntilSettled(startedAt = Date.now()): Promise<DeployStatus | null> {
    setWatching(true)
    setMsg('Request timed out or dropped — deploy may still be running on the server. Watching progress…')
    while (Date.now() - startedAt < WATCH_AFTER_TRANSPORT_MS) {
      await new Promise((r) => window.setTimeout(r, POLL_MS))
      const next = await load({ quiet: true })
      if (!next) continue
      if (next.fully_deployed || next.deploy_state?.status === 'completed') {
        setWatching(false)
        return next
      }
      if (next.deploy_state?.status === 'failed') {
        setWatching(false)
        return next
      }
      // If work finished a round and is waiting for continue, resume the POST loop.
      if (next.can_continue_loading || next.can_retry_handoff) {
        setWatching(false)
        return next
      }
      if (!isDeployWorkInProgress(next) && !next.can_deploy) {
        setWatching(false)
        return next
      }
    }
    setWatching(false)
    return statusRef.current
  }

  async function deployOnchain() {
    setBusy(true)
    setErr(null)
    setMsg('Starting on-chain deploy… transactions will appear here as they confirm.')
    autoContinueRef.current = true
    try {
      let rounds = 0
      while (autoContinueRef.current && rounds < 80) {
        rounds += 1
        setMsg(`Deploy round ${rounds} — submitting Solana transactions…`)
        let result: DeployActionResult
        try {
          result = await postDeployOnchain()
        } catch (e) {
          if (isLikelyDeployTransportError(e)) {
            const watched = await watchUntilSettled()
            if (watched?.fully_deployed) {
              setMsg(
                formatDeploySuccessMessage({
                  candyMachineId: watched.candy_machine_id || '',
                  collectionMint: watched.collection_mint || '',
                  goLiveOk: true,
                })
              )
              onApplied()
              break
            }
            if (watched?.can_continue_loading || watched?.can_retry_handoff) {
              setMsg('Server still has work queued — continuing automatically…')
              continue
            }
            if (watched?.deploy_state?.status === 'failed') {
              throw new Error(watched.deploy_state.error || 'deploy_failed')
            }
            throw new Error(
              'Lost connection while deploy was running. Refresh this page — if progress shows loaded items, click Continue loading items.'
            )
          }
          throw e
        }

        if (result.continue_loading) {
          const loaded = result.config_lines_loaded ?? 0
          const total = result.config_lines_total ?? statusRef.current?.config_line_count ?? '?'
          setMsg(
            `On-chain progress: ${loaded}/${total} items loaded (round ${rounds}). Continuing automatically…`
          )
          await load({ quiet: true })
          continue
        }

        setMsg(
          formatDeploySuccessMessage({
            candyMachineId: result.candy_machine_id,
            collectionMint: result.collection_mint,
            alreadyDeployed: result.already_deployed,
            goLiveOk: result.go_live?.ok,
            alreadyLive: result.go_live?.already_live,
            blockers: result.go_live?.blockers,
          })
        )
        onApplied()
        await load({ quiet: true })
        break
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'deploy_failed')
      await load({ quiet: true })
    } finally {
      autoContinueRef.current = false
      setBusy(false)
      setWatching(false)
    }
  }

  async function postDeployAction(body: Record<string, unknown>, successPrefix: string) {
    setBusy(true)
    setErr(null)
    setMsg(null)
    try {
      const res = await fetch(`/api/admin/owl-center/collections/${launchId}/assets/sugar-deploy`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const j = (await res.json()) as {
        ok?: boolean
        error?: string
        result?: DeployActionResult
      }
      if (!res.ok || !j.ok || !j.result) throw new Error(j.error || 'save_failed')
      if (j.result.candy_machine_id) setManualCm(j.result.candy_machine_id)
      if (j.result.collection_mint) setManualCol(j.result.collection_mint)
      setMsg(
        formatDeploySuccessMessage({
          candyMachineId: j.result.candy_machine_id,
          collectionMint: j.result.collection_mint,
          alreadyDeployed: false,
          goLiveOk: j.result.go_live?.ok,
          alreadyLive: j.result.go_live?.already_live,
          blockers: j.result.go_live?.blockers,
        }).replace(/^Success — Candy Machine deployed/, successPrefix.replace(/\.$/, ''))
      )
      onApplied()
      await load({ quiet: true })
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'save_failed')
    } finally {
      setBusy(false)
    }
  }

  async function registerManual() {
    await postDeployAction(
      {
        action: 'register_ids',
        candy_machine_id: manualCm.trim(),
        collection_mint: manualCol.trim(),
      },
      'Success — Candy Machine IDs saved.'
    )
  }

  async function importCacheFile(file: File) {
    setBusy(true)
    setErr(null)
    setMsg(null)
    try {
      const text = await file.text()
      const cache = JSON.parse(text) as {
        program?: { candyMachine?: string; collectionMint?: string; candyGuard?: string }
      }
      const cm = cache.program?.candyMachine?.trim() ?? ''
      const col = cache.program?.collectionMint?.trim() ?? ''
      if (!cm || !col) {
        throw new Error('cache.json missing program.candyMachine or program.collectionMint — run sugar deploy first.')
      }
      setManualCm(cm)
      setManualCol(col)
      await postDeployAction({ action: 'sync_from_cache', cache }, 'Success — Imported cache.json.')
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'import_failed')
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

  const isCore = status?.mint_standard === 'core'
  const deployed = Boolean(status?.fully_deployed ?? (status?.candy_machine_id && status?.collection_mint))
  const loaded = status?.deploy_state?.config_lines_loaded
  const total = status?.deploy_state?.config_lines_total ?? status?.config_line_count
  const progressPct = configLineProgressPercent(status)
  const progressLabel = formatConfigLineProgress(status)
  const showLoadProgress =
    busy ||
    watching ||
    status?.deploy_state?.status === 'loading_items' ||
    status?.deploy_state?.status === 'running' ||
    (typeof loaded === 'number' && typeof total === 'number' && loaded < total && !deployed)
  const tmCap = status?.tm_server_deploy_max_supply ?? 250
  const phase = deployPhaseLabel(status?.deploy_state?.status)
  const active = busy || watching || isDeployWorkInProgress(status)

  return (
    <CommandCard label="phase_b.sys · DEPLOY CM + GUARD">
      <p className="mb-4 text-xs leading-relaxed text-[#9BA8B4]">
        After Arweave upload, deploy the Candy Machine
        {isCore ? (
          <>
            {' '}
            with <strong className="font-normal text-[#E8EEF2]">Deploy CM + guard</strong>. Large Core collections
            load items in short rounds with live progress below.
          </>
        ) : (
          <>
            {' '}
            with <strong className="font-normal text-[#E8EEF2]">Deploy CM + guard</strong> (≤{tmCap} items) or Sugar
            CLI below.
          </>
        )}{' '}
        IDs sync to marketplace automatically and trigger go-live when metadata is ready.
      </p>

      {!status?.arweave_ready ? (
        <p className="rounded border border-[#FFD769]/30 bg-[#FFD769]/10 px-3 py-2 text-sm text-[#FFD769]">
          Finish <strong className="font-normal">Push to Arweave</strong> above before deploying.
        </p>
      ) : null}

      {status?.over_server_cap ? (
        <p className="mb-4 rounded border border-[#FFD769]/30 bg-[#FFD769]/10 px-3 py-2 text-sm text-[#FFD769]">
          Supply {status.config_line_count} exceeds the Token Metadata server deploy cap ({tmCap}). Use Sugar CLI
          below, then import <code className="text-[#7D8A93]">cache.json</code>.
        </p>
      ) : null}

      {isCore && status?.config_line_count && status.config_line_count > tmCap ? (
        <p className="mb-4 rounded border border-[#00FF9C]/25 bg-[#00FF9C]/5 px-3 py-2 text-sm text-[#9BA8B4]">
          Supply {status.config_line_count} — Core in-app deploy supports large collections via resumable item
          loading (Sugar CLI cannot deploy Core Candy Machines).
        </p>
      ) : null}

      {deployed ? (
        <div
          className="mb-4 rounded border border-[#00FF9C]/40 bg-[#00FF9C]/10 px-3 py-3"
          role="status"
          aria-live="polite"
        >
          <p className="mb-2 flex items-center gap-2 font-mono text-sm text-[#00FF9C]">
            <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
            Deploy successful — Candy Machine is on-chain
          </p>
          <dl className="grid gap-2 font-mono text-xs text-[#9BA8B4]">
            <div>
              <dt className="text-[#5C6773]">Candy Machine</dt>
              <dd className="break-all text-[#E8EEF2]">{status?.candy_machine_id}</dd>
            </div>
            <div>
              <dt className="text-[#5C6773]">Collection mint</dt>
              <dd className="break-all text-[#E8EEF2]">{status?.collection_mint}</dd>
            </div>
            {status?.deploy_state?.candy_guard_id ? (
              <div>
                <dt className="text-[#5C6773]">Candy Guard</dt>
                <dd className="break-all text-[#C5D0D8]">{status.deploy_state.candy_guard_id}</dd>
              </div>
            ) : null}
          </dl>
        </div>
      ) : null}

      {active || showLoadProgress ? (
        <div
          className="mb-4 rounded border border-[#1A222B] bg-[#0B0F13] px-3 py-3"
          role="status"
          aria-live="polite"
          aria-busy={active}
        >
          <div className="mb-2 flex items-center gap-2 font-mono text-xs text-[#C5D0D8]">
            {active ? <Loader2 className="h-3.5 w-3.5 animate-spin text-[#00FF9C]" aria-hidden /> : null}
            <span>{phase || (active ? 'Deploy in progress…' : 'Deploy status')}</span>
          </div>
          {progressLabel ? (
            <p className="mb-2 font-mono text-[11px] text-[#9BA8B4]">Config lines: {progressLabel}</p>
          ) : (
            <p className="mb-2 font-mono text-[11px] text-[#5C6773]">
              {active
                ? 'Waiting for first on-chain confirmation… this panel refreshes every few seconds.'
                : null}
            </p>
          )}
          {typeof progressPct === 'number' ? (
            <div className="h-2 overflow-hidden rounded bg-[#1A222B]" aria-hidden>
              <div
                className="h-full bg-[#00FF9C]/80 transition-[width] duration-500 ease-out"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          ) : null}
          {(status?.in_progress_candy_machine_id || status?.in_progress_collection_mint) && !deployed ? (
            <dl className="mt-3 grid gap-1 font-mono text-[11px] text-[#7D8A93]">
              {status.in_progress_candy_machine_id ? (
                <div>
                  <span className="text-[#5C6773]">CM (in progress) </span>
                  <span className="break-all text-[#C5D0D8]">{status.in_progress_candy_machine_id}</span>
                </div>
              ) : null}
              {status.in_progress_collection_mint ? (
                <div>
                  <span className="text-[#5C6773]">Collection (in progress) </span>
                  <span className="break-all text-[#C5D0D8]">{status.in_progress_collection_mint}</span>
                </div>
              ) : null}
            </dl>
          ) : null}
        </div>
      ) : null}

      {status?.mint_standard === 'core' &&
      status.creator_wallet &&
      (status.can_deploy || status.can_continue_loading || status.can_retry_handoff) ? (
        <p className="mb-4 rounded border border-[#FFD769]/30 bg-[#FFD769]/10 px-3 py-2 text-sm text-[#FFD769]">
          Creator wallet <span className="font-mono">{shortPk(status.creator_wallet)}</span> becomes root update
          authority after deploy. Use a wallet you will keep (hardware / multisig recommended). Owltopia keeps
          UpdateDelegate for reveal / refresh / thaw — we cannot move UA later without the creator&apos;s signature.
        </p>
      ) : null}

      {status?.deploy_state?.status === 'failed' && status.deploy_state.error ? (
        <p className="mb-4 rounded border border-[#FF9C9C]/30 bg-[#FF9C9C]/10 px-3 py-2 text-sm text-[#FF9C9C]">
          Last deploy failed: {status.deploy_state.error}
        </p>
      ) : null}

      {status?.deploy_state?.status === 'cm_ready' ? (
        <p className="mb-4 rounded border border-[#FFD769]/30 bg-[#FFD769]/10 px-3 py-2 text-sm text-[#FFD769]">
          Candy Machine exists; authority handoff incomplete
          {status.deploy_state.error ? `: ${status.deploy_state.error}` : ''}. Retry to finish handoff (idempotent).
        </p>
      ) : null}

      <div className="flex flex-wrap gap-3">
        {status?.can_deploy ? (
          <DeployButton type="button" className="min-h-[44px] touch-manipulation" disabled={busy || watching} onClick={() => void deployOnchain()}>
            {busy || watching ? (
              <>
                <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
                {watching ? 'Watching deploy…' : 'Deploying…'}
              </>
            ) : (
              'Deploy CM + guard (server)'
            )}
          </DeployButton>
        ) : null}

        {status?.can_continue_loading ? (
          <DeployButton type="button" className="min-h-[44px] touch-manipulation" disabled={busy || watching} onClick={() => void deployOnchain()}>
            {busy || watching ? (
              <>
                <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
                Loading items…
              </>
            ) : (
              `Continue loading items${progressLabel ? ` (${loaded}/${total})` : ''}`
            )}
          </DeployButton>
        ) : null}

        {status?.can_retry_handoff ? (
          <DeployButton type="button" className="min-h-[44px] touch-manipulation" disabled={busy || watching} onClick={() => void deployOnchain()}>
            {busy || watching ? (
              <>
                <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
                Finishing handoff…
              </>
            ) : (
              'Retry authority handoff'
            )}
          </DeployButton>
        ) : null}

        {!status?.onchain_deploy_enabled && status?.arweave_ready && !deployed ? (
          <p className="text-xs text-[#FFD769]">Set IRYS_PRIVATE_KEY on the server to enable one-click deploy.</p>
        ) : null}
      </div>

      {!isCore ? (
        <details
          className="mt-4 rounded border border-[#1A222B] bg-[#0B0F13] px-3 py-2"
          open={Boolean(status?.over_server_cap)}
        >
          <summary className="cursor-pointer touch-manipulation py-2 font-mono text-xs uppercase tracking-wide text-[#9BA8B4]">
            Terminal fallback (Sugar CLI)
          </summary>
          <p className="mt-2 text-xs text-[#9BA8B4]">
            For Token Metadata collections over {tmCap} items or if server deploy fails. The deploy script auto-syncs
            IDs to Owl Center when <code className="text-[#7D8A93]">config.json</code> includes{' '}
            <code className="text-[#7D8A93]">owlCenter.launchId</code> (added by prepare script).
          </p>
          <pre className="mt-2 overflow-x-auto rounded bg-[#0F1419] p-3 font-mono text-[11px] text-[#C5D0D8]">
            npm run prepare:sugar-deploy -- --launch-id={launchId}
            {'\n'}
            {status?.terminal_command ?? 'npm run sugar:deploy -- collections/your-folder'}
          </pre>
        </details>
      ) : (
        <p className="mt-4 text-xs text-[#5C6773]">
          Core collections must use in-app deploy. Keep this panel open while deploying — progress and success are
          updated live even if a single HTTP request times out.
        </p>
      )}

      <div className="mt-4 space-y-3 border-t border-[#1A222B] pt-4">
        <p className="font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">
          {isCore ? 'Paste base58 IDs (ops recovery)' : 'Sugar CLI — import cache.json'}
        </p>
        {!isCore ? (
          <>
            <input
              ref={cacheInputRef}
              type="file"
              accept="application/json,.json"
              className="sr-only"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void importCacheFile(file)
                e.target.value = ''
              }}
            />
            <DeployButton
              type="button"
              variant="ghost"
              className="min-h-[44px] w-full touch-manipulation sm:w-auto"
              disabled={busy || watching}
              onClick={() => cacheInputRef.current?.click()}
            >
              Import cache.json → save + go live
            </DeployButton>
          </>
        ) : null}

        <p className="font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">Or paste base58 IDs manually</p>
        <label className="grid gap-1 text-sm text-[#C5D0D8]">
          Candy Machine ID
          <input
            value={manualCm}
            onChange={(e) => setManualCm(e.target.value)}
            placeholder="Base58 Candy Machine address"
            className="min-h-[44px] touch-manipulation border border-[#1A222B] bg-[#0F1419] px-3 font-mono text-sm"
          />
        </label>
        <label className="grid gap-1 text-sm text-[#C5D0D8]">
          Collection mint
          <input
            value={manualCol}
            onChange={(e) => setManualCol(e.target.value)}
            placeholder="Base58 collection mint"
            className="min-h-[44px] touch-manipulation border border-[#1A222B] bg-[#0F1419] px-3 font-mono text-sm"
          />
        </label>
        <DeployButton
          type="button"
          variant="ghost"
          className="min-h-[44px] touch-manipulation"
          disabled={busy || watching || !manualCm.trim() || !manualCol.trim()}
          onClick={() => void registerManual()}
        >
          Save IDs + try go live
        </DeployButton>
      </div>

      {err ? (
        <p className="mt-3 rounded border border-[#FF9C9C]/30 bg-[#FF9C9C]/10 px-3 py-2 font-mono text-xs text-[#FF9C9C]" role="alert">
          {err}
        </p>
      ) : null}
      {msg ? (
        <p
          className={`mt-3 rounded border px-3 py-2 font-mono text-xs ${
            msg.toLowerCase().startsWith('success')
              ? 'border-[#00FF9C]/35 bg-[#00FF9C]/10 text-[#00FF9C]'
              : 'border-[#1A222B] bg-[#0B0F13] text-[#C5D0D8]'
          }`}
          role="status"
          aria-live="polite"
        >
          {msg}
        </p>
      ) : null}
    </CommandCard>
  )
}
