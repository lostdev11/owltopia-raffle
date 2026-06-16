'use client'

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useWallet } from '@solana/wallet-adapter-react'
import { Loader2 } from 'lucide-react'

import { CommandCard } from '@/components/owl-center/CommandCard'
import { CommandCardSection } from '@/components/owl-center/CommandCardSection'
import { DeployButton } from '@/components/owl-center/DeployButton'
import { sendRevealDayFeeSolTransfer } from '@/lib/solana/reveal-day-payment-client'
import { resolveLaunchMintNetwork } from '@/lib/solana/launch-cm'
import type { OwlCenterLaunchPublic } from '@/lib/owl-center/types'

type RevealDayStatus = {
  eligible: boolean
  reveal_mode: string | null
  reveal_status: string
  reveal_at: string | null
  reveal_completed_at: string | null
  payment_required: boolean
  payment_received: boolean
  fee_label: string
  fee_lamports_estimate: string | null
  treasury_wallet: string | null
  minted_count: number
  checklist: {
    reveal_day_enabled: boolean
    arweave_ready: boolean
    placeholder_ready: boolean
    cm_deployed: boolean
    payment_ok: boolean
    scheduled: boolean
    revealed: boolean
  }
  reveal_progress?: { error?: string; refreshed_count?: number }
}

const PANEL_LABEL = 'reveal_day.svc · BLIND MINT'

function CheckItem({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li className={ok ? 'text-[#00FF9C]' : 'text-[#9BA8B4]'}>
      {ok ? '✓' : '○'} {label}
    </li>
  )
}

function PanelShell({
  children,
  embedded,
  id,
  label,
}: {
  children: ReactNode
  embedded?: boolean
  id?: string
  label: string
}) {
  if (embedded) {
    return (
      <CommandCardSection id={id} label={label}>
        {children}
      </CommandCardSection>
    )
  }
  return (
    <CommandCard id={id} label={label}>
      {children}
    </CommandCard>
  )
}

export function RevealDayPanel({
  launchId,
  launch,
  anchorId = 'reveal-day',
  apiPath,
  embedded = false,
}: {
  launchId: string
  launch?: Pick<OwlCenterLaunchPublic, 'mint_mode' | 'name' | 'mint_network'>
  anchorId?: string
  apiPath?: string
  embedded?: boolean
}) {
  const revealApi = apiPath ?? `/api/admin/owl-center/collections/${launchId}/reveal-day`
  const isCreatorApi = revealApi.includes('/owl-center/launches/')
  const { publicKey, sendTransaction } = useWallet()

  const [status, setStatus] = useState<RevealDayStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [revealAtLocal, setRevealAtLocal] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setErr(null)
    try {
      const res = await fetch(revealApi, { credentials: 'include', cache: 'no-store' })
      const j = (await res.json()) as RevealDayStatus & { error?: string }
      if (!res.ok) throw new Error(j.error || 'load_failed')
      setStatus(j)
      if (j.reveal_at) {
        const d = new Date(j.reveal_at)
        if (Number.isFinite(d.getTime())) {
          const pad = (n: number) => String(n).padStart(2, '0')
          setRevealAtLocal(
            `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
          )
        }
      }
    } catch (e) {
      setStatus(null)
      setErr(e instanceof Error ? e.message : 'load_failed')
    } finally {
      setLoading(false)
    }
  }, [revealApi])

  useEffect(() => {
    void load()
  }, [load])

  async function postAction(body: Record<string, unknown>) {
    setBusy(true)
    setErr(null)
    setMsg(null)
    try {
      const res = await fetch(revealApi, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const j = (await res.json()) as { ok?: boolean; error?: string; refreshed_count?: number }
      if (!res.ok || j.ok === false) throw new Error(j.error || 'action_failed')
      if (body.action === 'reveal_now' && typeof j.refreshed_count === 'number') {
        setMsg(`Revealed ${j.refreshed_count} mint${j.refreshed_count === 1 ? '' : 's'} on-chain.`)
      } else if (body.action === 'schedule') {
        setMsg('Reveal scheduled — Owltopia will run the bulk update at your chosen time.')
      } else if (body.action === 'enable') {
        setMsg('Reveal Day enabled. Deploy the Candy Machine next (placeholder art until reveal).')
      } else if (body.action === 'confirm_payment') {
        setMsg('Payment confirmed. You can schedule reveal day.')
      }
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'action_failed')
    } finally {
      setBusy(false)
    }
  }

  async function payFee() {
    if (!publicKey || !sendTransaction) {
      setErr('Connect your wallet to pay the Reveal Day fee.')
      return
    }
    const lamports = status?.fee_lamports_estimate ? BigInt(status.fee_lamports_estimate) : null
    if (!lamports || lamports <= 0n) {
      setErr('Fee quote unavailable — retry in a moment.')
      return
    }
    const network = resolveLaunchMintNetwork(
      launch ?? ({ mint_mode: 'public_simple', mint_network: 'mainnet' } as OwlCenterLaunchPublic)
    )
    setBusy(true)
    setErr(null)
    try {
      const paid = await sendRevealDayFeeSolTransfer({
        wallet: publicKey,
        sendTransaction: (tx, conn, opts) => sendTransaction(tx, conn, opts),
        feeLamports: lamports,
        network,
      })
      if (!paid.ok) throw new Error(paid.error)
      await postAction({ action: 'confirm_payment', payment_tx_signature: paid.signature })
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'payment_failed')
      setBusy(false)
    }
  }

  if (launch?.mint_mode === 'gen2_full') return null

  if (loading) {
    return (
      <PanelShell embedded={embedded} id={anchorId} label={PANEL_LABEL}>
        <p className="font-mono text-xs text-[#5C6773]">Loading Reveal Day…</p>
      </PanelShell>
    )
  }

  const enabled = status?.checklist.reveal_day_enabled
  const revealed = status?.checklist.revealed

  return (
    <PanelShell embedded={embedded} id={anchorId} label={PANEL_LABEL}>
      <p className="mb-4 text-sm leading-relaxed text-[#9BA8B4] sm:text-xs">
        <strong className="font-normal text-[#C5D0D8]">Reveal Day</strong> lets collectors mint a placeholder
        silhouette until your scheduled time, then Owltopia bulk-updates every mint to final art on-chain.
        After reveal, tell holders to refresh in Phantom/Solflare and use{' '}
        <strong className="font-normal text-[#C5D0D8]">Refresh metadata</strong> on Tensor / Magic Eden if
        marketplaces lag.
      </p>

      {err && !status ? (
        <p className="mb-3 rounded border border-[#FF9C9C]/30 bg-[#FF9C9C]/10 px-3 py-2 text-sm text-[#FF9C9C]">
          {isCreatorApi ? `Sign in with your creator wallet. (${err})` : err}
        </p>
      ) : null}

      {status ? (
        <ul className="mb-4 space-y-1 font-mono text-xs leading-relaxed">
          <CheckItem ok={status.checklist.arweave_ready} label="Final art on Arweave" />
          <CheckItem ok={status.checklist.reveal_day_enabled} label="Reveal Day enabled (before CM deploy)" />
          <CheckItem ok={status.checklist.placeholder_ready} label="Placeholder metadata ready" />
          <CheckItem ok={status.checklist.cm_deployed} label="Candy Machine deployed" />
          <CheckItem ok={status.checklist.payment_ok} label={`Reveal Day fee (${status.fee_label})`} />
          <CheckItem ok={status.checklist.scheduled} label="Reveal scheduled" />
          <CheckItem ok={status.checklist.revealed} label="On-chain reveal complete" />
        </ul>
      ) : null}

      {status?.reveal_status === 'failed' && status.reveal_progress?.error ? (
        <p className="mb-3 font-mono text-xs text-[#FF9C9C]">Last run: {status.reveal_progress.error}</p>
      ) : null}

      {revealed ? (
        <div className="space-y-2 rounded border border-[#00FF9C]/25 bg-[#00FF9C]/8 px-3 py-3 font-mono text-xs text-[#9BA8B4]">
          <p className="text-[#00FF9C]">Reveal complete.</p>
          <p>
            Marketplace checklist: open your collection on Tensor and Magic Eden → tap{' '}
            <span className="text-[#C5D0D8]">Refresh metadata</span> if pre-reveal art still shows. Wallets:
            pull to refresh in Phantom / Solflare.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {!enabled ? (
            <DeployButton
              type="button"
              className="w-full sm:w-auto"
              disabled={busy || !status?.checklist.arweave_ready || status?.checklist.cm_deployed}
              onClick={() => void postAction({ action: 'enable' })}
            >
              {busy ? <Loader2 className="inline h-4 w-4 animate-spin" /> : 'Enable Reveal Day'}
            </DeployButton>
          ) : null}

          {enabled && status?.payment_required && !status.payment_received ? (
            <DeployButton
              type="button"
              className="w-full sm:w-auto"
              disabled={busy || !publicKey}
              onClick={() => void payFee()}
            >
              {busy ? (
                <>
                  <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
                  Paying…
                </>
              ) : (
                `Pay ${status.fee_label}`
              )}
            </DeployButton>
          ) : null}

          {enabled && status?.checklist.cm_deployed && !revealed ? (
            <>
              <label className="grid gap-1 font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">
                Reveal time (your timezone)
                <input
                  type="datetime-local"
                  value={revealAtLocal}
                  onChange={(e) => setRevealAtLocal(e.target.value)}
                  className="min-h-[44px] touch-manipulation border border-[#1A222B] bg-[#0F1419] px-3 py-2 font-mono text-sm text-[#F4FBF8]"
                />
              </label>
              <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                <DeployButton
                  type="button"
                  className="w-full sm:w-auto"
                  disabled={
                    busy ||
                    !revealAtLocal ||
                    !status.checklist.payment_ok ||
                    status.reveal_status === 'running'
                  }
                  onClick={() => {
                    const ms = new Date(revealAtLocal).getTime()
                    if (!Number.isFinite(ms)) {
                      setErr('Invalid date')
                      return
                    }
                    void postAction({ action: 'schedule', reveal_at: new Date(ms).toISOString() })
                  }}
                >
                  Schedule reveal
                </DeployButton>
                <DeployButton
                  type="button"
                  variant="ghost"
                  className="w-full sm:w-auto"
                  disabled={busy || !status.checklist.payment_ok || status.reveal_status === 'running'}
                  onClick={() => void postAction({ action: 'reveal_now' })}
                >
                  Reveal now
                </DeployButton>
              </div>
            </>
          ) : null}
        </div>
      )}

      {err && status ? <p className="mt-3 font-mono text-xs text-[#FF9C9C]">{err}</p> : null}
      {msg ? <p className="mt-3 font-mono text-xs text-[#00FF9C]">{msg}</p> : null}

      {enabled && !status?.checklist.cm_deployed ? (
        <p className="mt-3 font-mono text-xs text-[#FFD769]">
          Deploy the Candy Machine after enabling — mints will use placeholder art until reveal.
          Optional: add <code className="text-[#C5D0D8]">assets/reveal-placeholder.png</code> +{' '}
          <code className="text-[#C5D0D8]">assets/reveal-placeholder.json</code> to your ZIP for a custom
          silhouette.
        </p>
      ) : null}
    </PanelShell>
  )
}
