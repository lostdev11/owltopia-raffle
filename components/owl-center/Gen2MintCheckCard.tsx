'use client'

import { useEffect, useState, type ReactNode } from 'react'

import { useWallet } from '@solana/wallet-adapter-react'

import { CommandCard } from '@/components/owl-center/CommandCard'
import { formatPhasePriceSolOrFree } from '@/lib/owl-center/format-phase-price-sol'
import { MintAllocationBar } from '@/components/owl-center/MintAllocationBar'
import { reasonLabel } from '@/lib/owl-center/mint-check-reason-label'
import { owlCenterActivePhaseTag } from '@/lib/owl-center/phase-display'
import type { Gen2MintCheckPhasePreview, Gen2MintCheckResponse } from '@/lib/owl-center/types'
import { Gen2WlShareButton } from '@/components/owl-center/Gen2WlShareButton'
import { cn } from '@/lib/utils'

function MintCheckShell({
  embedded,
  children,
}: {
  embedded?: boolean
  children: ReactNode
}) {
  if (embedded) {
    return (
      <div id="allocation" className="mt-6 scroll-mt-28 border-t border-[#1A222B] pt-6 md:scroll-mt-24">
        <p className="mb-4 font-mono text-[10px] font-bold uppercase tracking-[0.25em] text-[#5C6773]">
          Your allocation
        </p>
        {children}
      </div>
    )
  }
  return <CommandCard label="mint_allocation_checker.sys">{children}</CommandCard>
}

/** Unminted Gen1 + presale spots still reserved outside the WL/public shared pool. */
function backstopSupplyRemaining(phases: Gen2MintCheckPhasePreview[]): number {
  let remaining = 0
  for (const phase of ['AIRDROP', 'PRESALE', 'PRESALE_OVERAGE'] as const) {
    const row = phases.find((p) => p.phase === phase)
    if (!row) continue
    remaining += Math.max(0, row.phase_supply - row.phase_minted)
  }
  return remaining
}

function phaseActiveTag(p: Gen2MintCheckPhasePreview, presaleSoldOut: boolean): string | null {
  if (!p.is_active) return null
  return owlCenterActivePhaseTag(p.phase, { presaleSoldOut })
}

function shortWallet(w: string): string {
  return w.length > 12 ? `${w.slice(0, 4)}…${w.slice(-4)}` : w
}

/** Slim per-phase supply progress bar — shows how much of the phase cap is left to mint. */
function PhaseSupplyBar({
  minted,
  total,
  remaining: remainingOverride,
}: {
  minted: number
  total: number
  remaining?: number
}) {
  const safeTotal = Math.max(0, total)
  const safeMinted = Math.max(0, Math.min(minted, safeTotal || minted))
  const pct = safeTotal > 0 ? Math.min(100, (safeMinted / safeTotal) * 100) : safeMinted > 0 ? 100 : 0
  const remaining = Math.max(0, remainingOverride ?? safeTotal - safeMinted)
  const soldOut = safeTotal > 0 && remaining === 0
  return (
    <div className="mt-2 space-y-1">
      <div className="h-1.5 w-full overflow-hidden border border-[#1A222B] bg-[#0B0F14]">
        <div
          className={cn(
            'h-full transition-[width] duration-300 motion-reduce:transition-none',
            soldOut ? 'bg-[#FFD769]/80' : 'bg-[#00FF9C]/70'
          )}
          style={{ width: `${pct}%` }}
          role="progressbar"
          aria-valuenow={safeMinted}
          aria-valuemin={0}
          aria-valuemax={safeTotal || safeMinted}
          aria-label="Phase mint progress"
        />
      </div>
      <p className="text-[10px] tabular-nums text-[#5C6773]">
        <span className={soldOut ? 'text-[#FFD769]' : 'text-[#00FF9C]'}>{safeMinted}</span>
        {safeTotal > 0 ? ` / ${safeTotal} minted · ${remaining} left` : ' minted'}
      </p>
    </div>
  )
}

/** Live countdown to a phase's window close (e.g. the WHITELIST 48h timer). */
function PhaseWindowCountdown({ endsAt, active }: { endsAt: string; active: boolean }) {
  // Start null so server render and first client paint match (no hydration mismatch), then tick.
  const [now, setNow] = useState<number | null>(null)
  useEffect(() => {
    setNow(Date.now())
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])

  const end = new Date(endsAt).getTime()
  if (now == null || !Number.isFinite(end)) return null

  const msLeft = end - now
  if (msLeft <= 0) {
    return (
      <p className="mt-2 font-mono text-[10px] uppercase tracking-widest text-[#FFD769]">
        WL window closed · leftover rolls into Public
      </p>
    )
  }

  const totalSec = Math.floor(msLeft / 1000)
  const d = Math.floor(totalSec / 86_400)
  const h = Math.floor((totalSec % 86_400) / 3_600)
  const m = Math.floor((totalSec % 3_600) / 60)
  const s = totalSec % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  const text = d > 0 ? `${d}d ${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(h)}:${pad(m)}:${pad(s)}`
  return (
    <p className="mt-2 font-mono text-[10px] uppercase tracking-widest text-[#00FF9C]">
      {active ? 'WL closes in' : 'WL window ends in'}{' '}
      <span className="tabular-nums text-[#EAFBF4]">{text}</span>
    </p>
  )
}

/** A phase the connected wallet can mint in now, has reserved for later, or already minted in. */
function phaseHasAllocation(p: Gen2MintCheckPhasePreview): boolean {
  if (p.reserved_mints > 0) return true
  if (p.is_eligible && p.max_mintable > 0) return true
  if (p.minted_in_phase > 0) return true
  return false
}

function phaseHeaderRight(p: Gen2MintCheckPhasePreview, connected: boolean): string {
  if (!connected) return '—'
  if (p.is_active && p.is_eligible && p.max_mintable > 0) {
    return `Can mint ${p.max_mintable}`
  }
  if (p.reserved_mints > 0) {
    return `${p.reserved_mints} reserved`
  }
  if (p.minted_in_phase > 0) {
    return `${p.minted_in_phase} minted`
  }
  return '—'
}

export function Gen2MintCheckCard({
  check,
  loading,
  err,
  onRefresh,
  embedded = false,
  collectionRemaining,
}: {
  check: Gen2MintCheckResponse | null
  loading: boolean
  err: string | null
  onRefresh: () => void
  /** When true, render inline inside Supply & phases (no nested CommandCard). */
  embedded?: boolean
  /** Total collection supply remaining (all phases) — reconciles with Overview. */
  collectionRemaining?: number
}) {
  const { publicKey, connected } = useWallet()
  const walletStr = publicKey?.toBase58() ?? null
  const [showAll, setShowAll] = useState(false)

  const cluster = check?.wallet_cluster
  const connectedRow = cluster?.wallets.find((w) => w.is_connected_wallet)

  const allPhases = check?.phases ?? []
  const allocatedPhases = allPhases.filter(phaseHasAllocation)
  const backstopRemaining = backstopSupplyRemaining(allPhases)
  // Once connected, default to only the phases this wallet can mint in. Without a
  // connection (or with zero allocation) show everything so the section isn't empty.
  const showFiltered = connected && allocatedPhases.length > 0 && !showAll
  const visiblePhases = showFiltered ? allocatedPhases : allPhases
  const hiddenCount = allPhases.length - visiblePhases.length

  return (
    <MintCheckShell embedded={embedded}>
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-end gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {connected && walletStr ? <Gen2WlShareButton wallet={walletStr} mintCheck={check} /> : null}
            {!connected ? (
              <p className="text-xs text-[#9BA8B4]">Connect your wallet using the button in the site header above.</p>
            ) : null}
            <button
              type="button"
              onClick={() => void onRefresh()}
              disabled={loading}
              className="min-h-[44px] touch-manipulation px-3 font-mono text-[10px] uppercase tracking-widest text-[#00FF9C] underline-offset-4 hover:underline disabled:opacity-50"
            >
              {loading ? 'Checking…' : 'Refresh'}
            </button>
          </div>
        </div>

        {check?.presale_sold_out ? (
          <p className="border border-[#00FF9C]/25 bg-[#00FF9C]/8 px-3 py-2 text-xs text-[#9BA8B4]">
            Presale purchases are sold out. Paid buyers can still redeem credits during the Presale mint phase below.
          </p>
        ) : null}

        {connected && cluster && cluster.linked_count > 0 ? (
          <div className="space-y-3 border border-[#1A222B] bg-[#0F1419] p-4">
            <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-[#5C6773]">
              Linked cluster · primary {shortWallet(cluster.primary_wallet)}
            </p>
            <MintAllocationBar
              label="Paid presale credits (linked cluster)"
              minted={cluster.totals.purchased_mints - cluster.totals.purchased_available_mints}
              total={cluster.totals.purchased_mints}
              hint={`${cluster.totals.purchased_available_mints} paid spots left to mint · ${cluster.paid_participant_count} wallet(s) with presale purchases`}
            />
            <ul className="space-y-1 font-mono text-[10px] text-[#9BA8B4]">
              {cluster.wallets.map((row) => (
                <li key={row.wallet} className={row.is_connected_wallet ? 'text-[#00FF9C]' : ''}>
                  {shortWallet(row.wallet)}
                  {row.is_connected_wallet ? ' (connected)' : ''}
                  {row.is_paid_participant ? '' : ' · no presale payment'}
                  {row.is_paid_participant
                    ? `: ${row.purchased_available_mints} paid left · ${row.purchased_mints} bought`
                    : ''}
                </li>
              ))}
            </ul>
          </div>
        ) : connected && connectedRow && connectedRow.is_paid_participant ? (
          <MintAllocationBar
            label="This wallet — paid presale"
            minted={connectedRow.purchased_mints - connectedRow.purchased_available_mints}
            total={connectedRow.purchased_mints}
            hint={`${connectedRow.purchased_available_mints} paid spots left to mint (${connectedRow.purchased_mints} purchased)`}
          />
        ) : connected && connectedRow && !connectedRow.is_paid_participant ? (
          <p className="text-xs text-[#FFD769]">
            Connected wallet is not in presale purchase records. Link the wallet that paid, or switch wallets.
          </p>
        ) : null}

        {err ? <p className="text-sm text-[#FF9C9C]">{err}</p> : null}

        {check ? (
          <ul className="space-y-3">
            {visiblePhases.map((p) => {
              const active = p.is_active
              const eligible = p.is_eligible
              const canMintNow = connected && active && eligible && p.max_mintable > 0
              const hasUserAllocation = connected && p.reserved_mints > 0
              const activeTag = phaseActiveTag(p, check.presale_sold_out)
              // WL has run its course (window elapsed / sold out → launch on PUBLIC) and is no longer
              // live, so its unminted spots have rolled into the Public pool — not "reserved" anymore.
              const wlClosed =
                p.phase === 'WHITELIST' &&
                !active &&
                (check.active_phase === 'PUBLIC' ||
                  check.active_phase === 'SOLD_OUT' ||
                  check.active_phase === 'TRADING_ACTIVE')
              return (
                <li
                  key={p.phase}
                  id={p.phase === 'WHITELIST' ? 'whitelist-detail' : undefined}
                  className={cn(
                    'scroll-mt-28 border px-3 py-3 font-mono text-xs md:scroll-mt-24',
                    p.phase === 'WHITELIST' && hasUserAllocation && 'ring-1 ring-[#00FF9C]/25',
                    canMintNow && 'border-[#00FF9C] bg-[#00FF9C]/12 ring-1 ring-[#00FF9C]/45',
                    active && !canMintNow && 'border-[#00FF9C]/40 bg-[#00FF9C]/6',
                    !active && hasUserAllocation && 'border-[#00FF9C]/30 border-dashed bg-[#00FF9C]/5',
                    !active && !hasUserAllocation && !canMintNow && 'border-[#1A222B] bg-[#0B0F14]'
                  )}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-bold uppercase tracking-widest text-[#C5D0D8]">
                      {p.label}
                      {canMintNow ? (
                        <span className="ml-2 text-[#00FF9C]">· Your mint</span>
                      ) : activeTag ? (
                        <span className="ml-2 text-[#00FF9C]">· {activeTag}</span>
                      ) : !active && hasUserAllocation ? (
                        <span className="ml-2 text-[#9BA8B4]">· Your allocation</span>
                      ) : p.minted_in_phase > 0 ? (
                        <span className="ml-2 text-[#00FF9C]">· Minted</span>
                      ) : null}
                    </span>
                    <span
                      className={
                        connected && p.reserved_mints > 0
                          ? eligible && active
                            ? 'text-[#00FF9C]'
                            : 'text-[#9BA8B4]'
                          : connected && p.minted_in_phase > 0
                            ? 'text-[#00FF9C]'
                            : 'text-[#5C6773]'
                      }
                    >
                      {phaseHeaderRight(p, connected)}
                    </span>
                  </div>
                  <p className="mt-1 text-[#5C6773]">
                    {formatPhasePriceSolOrFree(p.unit_lamports_estimate, {
                      paid: p.price_usdc != null && p.price_usdc > 0,
                    })}{' '}
                    ·{' '}
                    {p.phase === 'PUBLIC'
                      ? `shared pool ${p.phase_supply} (WL + public · presale & Gen1 excluded)`
                      : `cap ${p.phase_supply}`}
                  </p>

                  <PhaseSupplyBar
                    minted={p.phase_minted}
                    total={p.phase_supply}
                    remaining={p.phase_remaining}
                  />

                  {p.phase === 'PUBLIC' && (backstopRemaining > 0 || collectionRemaining != null) ? (
                    <p className="mt-1 text-[10px] leading-relaxed text-[#5C6773]">
                      {backstopRemaining > 0
                        ? `${backstopRemaining} presale & Gen1 spot${backstopRemaining === 1 ? '' : 's'} still reserved separately`
                        : null}
                      {backstopRemaining > 0 && collectionRemaining != null ? ' · ' : null}
                      {collectionRemaining != null ? `${collectionRemaining} total collection remaining` : null}
                    </p>
                  ) : null}

                  {/* Only show the WL countdown while WHITELIST is the primary gating phase. Once
                      the primary phase is PUBLIC, the WL leftover has already rolled into public, so
                      the countdown would be misleading — hide it (WL still officially closes at 48h
                      via the cron, after which only public remains). */}
                  {p.phase === 'WHITELIST' && p.window_ends_at && check.active_phase === 'WHITELIST' ? (
                    <PhaseWindowCountdown endsAt={p.window_ends_at} active={active} />
                  ) : null}

                  {connected && p.minted_in_phase > 0 ? (
                    <p className="mt-1 text-[#00FF9C]">
                      You minted {p.minted_in_phase} in this phase
                    </p>
                  ) : null}

                  {p.phase === 'AIRDROP' && p.gen1 ? (
                    <div className="mt-2 space-y-1 text-[#9BA8B4]">
                      <p>
                        Gen1 on this wallet: {p.gen1.is_holder ? `yes (${p.gen1.gen1_nft_count})` : 'no'}
                        {p.reserved_mints > 0
                          ? ` · ${p.reserved_mints} reserved (1 per Gen1 NFT on minting wallet)`
                          : p.gen1.is_holder
                            ? ' · none left to mint'
                            : ''}
                      </p>
                      {(p.gen1.cluster_gen1_nft_count ?? 0) > p.gen1.gen1_nft_count ? (
                        <p className="text-[#5C6773]">
                          Linked cluster total: {p.gen1.cluster_gen1_nft_count} Gen1 NFT
                          {(p.gen1.cluster_gen1_nft_count ?? 0) === 1 ? '' : 's'}
                        </p>
                      ) : null}
                      {p.gen1.gen1_on_linked_wallet ? (
                        <p className="text-[#FFD769]">{reasonLabel('gen1_on_linked_wallet')}</p>
                      ) : null}
                    </div>
                  ) : null}

                  {p.phase === 'PRESALE' && p.presale ? (
                    <p className="mt-2 text-[#9BA8B4]">
                      Paid participant: {p.presale.is_paid_participant ? 'yes' : 'no'} ·{' '}
                      {p.presale.purchased_available_mints ?? 0} paid spots left · {p.presale.purchased_mints} purchased
                      {p.presale.is_paid_participant &&
                      (p.presale.purchased_available_mints ?? 0) > 0 &&
                      active &&
                      eligible
                        ? ` · mint up to ${p.max_mintable} at once (1 per presale spot)`
                        : ''}
                      {p.presale.gifted_mints > 0 ? ` · ${p.presale.gifted_mints} gifted` : ''}
                    </p>
                  ) : null}

                  {p.phase === 'PRESALE_OVERAGE' && p.presale ? (
                    <p className="mt-2 text-[#9BA8B4]">
                      Overshoot list + {p.presale.available_mints} credit(s) on this wallet
                    </p>
                  ) : null}

                  {p.phase === 'WHITELIST' && p.wl ? (
                    <div className="mt-2 space-y-1 text-[#9BA8B4]">
                      <p>
                        WL on this wallet: {p.wl.allowed_mints} spot{p.wl.allowed_mints === 1 ? '' : 's'} assigned ·{' '}
                        {p.wl.available_mints} left
                        {p.wl.admin_allocated ? ' · admin allocation' : ''}
                        {p.wl.available_mints > 0 && active
                          ? ` · mint up to ${p.max_mintable} at once`
                          : wlClosed
                            ? ' · WL closed — rolled into Public'
                            : p.reserved_mints > 0
                              ? ` · ${p.reserved_mints} reserved for WL`
                              : ''}
                        {p.wl.community ? ` · ${p.wl.community}` : ''}
                        {p.wl.discord_whitelist && !p.wl.admin_allocated ? ' · Discord WL (spots pending)' : ''}
                      </p>
                      {!wlClosed ? (
                        <p className="text-[#5C6773]">
                          FCFS when WL opens — shared {p.phase_supply} cap; mint order matters once the phase is live.
                        </p>
                      ) : null}
                      {(p.wl.cluster_available_mints ?? 0) > p.wl.available_mints ? (
                        <p className="text-[#5C6773]">
                          Linked cluster WL available: {p.wl.cluster_available_mints}
                        </p>
                      ) : null}
                      {p.wl.wl_on_linked_wallet ? (
                        <p className="text-[#FFD769]">{reasonLabel('wl_on_linked_wallet')}</p>
                      ) : null}
                    </div>
                  ) : null}

                  {p.phase_note && connected ? (
                    <p className="mt-2 text-[#9BA8B4]">{p.phase_note}</p>
                  ) : null}
                  {p.reason && connected ? <p className="mt-2 text-[#FFD769]">{reasonLabel(p.reason)}</p> : null}
                </li>
              )
            })}
          </ul>
        ) : null}

        {check && connected && allocatedPhases.length > 0 && (showAll || hiddenCount > 0) ? (
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="min-h-[44px] w-full touch-manipulation border border-[#1A222B] bg-[#0B0F14] px-3 font-mono text-[10px] uppercase tracking-widest text-[#5C6773] hover:text-[#9BA8B4]"
          >
            {showAll
              ? 'Show only my phases'
              : `Show all phases${hiddenCount > 0 ? ` (+${hiddenCount} not eligible)` : ''}`}
          </button>
        ) : null}

        {!check && loading ? (
          <p className="font-mono text-sm text-[#9BA8B4]">Loading allocation checker…</p>
        ) : null}
      </div>
    </MintCheckShell>
  )
}
