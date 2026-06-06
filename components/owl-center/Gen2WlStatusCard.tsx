'use client'

import { useWallet } from '@solana/wallet-adapter-react'

import { CommandCard } from '@/components/owl-center/CommandCard'
import { Gen2WlShareButton } from '@/components/owl-center/Gen2WlShareButton'
import { formatPhasePriceSolOrFree } from '@/lib/owl-center/format-phase-price-sol'
import type { Gen2MintCheckPhasePreview, Gen2MintCheckResponse, OwlCenterPhase } from '@/lib/owl-center/types'
import { cn } from '@/lib/utils'

function scrollToSection(id: string) {
  const el = document.getElementById(id)
  if (!el) return
  el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  if (typeof history !== 'undefined' && history.replaceState) {
    history.replaceState(null, '', `#${id}`)
  }
}

function wlPhaseFromCheck(check: Gen2MintCheckResponse | null): Gen2MintCheckPhasePreview | null {
  return check?.phases.find((p) => p.phase === 'WHITELIST') ?? null
}

export function Gen2WlStatusCard({
  check,
  loading,
  activePhase,
  wlSupply,
  wlPriceLamports,
  onRefresh,
}: {
  check: Gen2MintCheckResponse | null
  loading: boolean
  activePhase: OwlCenterPhase
  wlSupply: number
  wlPriceLamports: string | null
  onRefresh: () => void
}) {
  const { connected } = useWallet()
  const wlPhase = wlPhaseFromCheck(check)
  const wl = wlPhase?.wl
  const wlLive = activePhase === 'WHITELIST'
  const canMintNow = connected && wlPhase?.is_active && wlPhase.is_eligible && wlPhase.max_mintable > 0
  const hasAllocation = connected && (wl?.admin_allocated === true || (wl?.allowed_mints ?? 0) > 0)
  const allSpotsUsed = hasAllocation && wl && wl.available_mints <= 0 && wl.allowed_mints > 0
  const discordPending = connected && wl?.discord_whitelist && !wl?.admin_allocated
  const onLinkedWallet = connected && wl?.wl_on_linked_wallet

  return (
    <CommandCard
      label="whitelist_status.sys"
      className={cn(wlLive && 'ring-1 ring-[#00FF9C]/35')}
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-mono text-[10px] font-bold uppercase tracking-[0.35em] text-[#5C6773]">
              Whitelist mint
            </p>
            <p className="mt-1 text-sm text-[#9BA8B4]">
              {wlSupply} spots total · {formatPhasePriceSolOrFree(wlPriceLamports)} · FCFS when WL opens
            </p>
          </div>
          {wlLive ? (
            <span className="shrink-0 border border-[#00FF9C]/45 bg-[#00FF9C]/12 px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-widest text-[#00FF9C]">
              Live now
            </span>
          ) : (
            <span className="shrink-0 border border-[#1A222B] bg-[#0F1419] px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-widest text-[#9BA8B4]">
              Upcoming
            </span>
          )}
        </div>

        {loading && connected ? (
          <p className="font-mono text-sm text-[#9BA8B4]">Checking your WL status…</p>
        ) : !connected ? (
          <div className="border border-[#1A222B] bg-[#0F1419] px-4 py-4">
            <p className="text-sm text-[#C5D0D8]">Connect your wallet to see assigned WL spots.</p>
            <p className="mt-2 text-xs text-[#5C6773]">
              Use the connect button in the site header. Spots appear here once an admin assigns your wallet.
            </p>
          </div>
        ) : hasAllocation && wl ? (
          allSpotsUsed ? (
            <div className="border border-[#1A222B] bg-[#0F1419] px-4 py-4">
              <p className="text-sm text-[#C5D0D8]">
                All {wl.allowed_mints} WL spot{wl.allowed_mints === 1 ? '' : 's'} minted on this wallet.
              </p>
              {wl.community ? (
                <p className="mt-2 text-xs text-[#5C6773]">Community: {wl.community}</p>
              ) : null}
            </div>
          ) : (
          <div
            className={cn(
              'grid gap-4 border px-4 py-4 sm:grid-cols-[1fr_auto]',
              canMintNow
                ? 'border-[#00FF9C]/50 bg-[#00FF9C]/10'
                : 'border-[#00FF9C]/30 bg-[#00FF9C]/5'
            )}
          >
            <div>
              <p className="font-display text-3xl tabular-nums text-[#F4FBF8] md:text-4xl">
                {wl.available_mints}
                <span className="ml-2 font-mono text-sm font-normal text-[#9BA8B4]">
                  / {wl.allowed_mints} spot{wl.allowed_mints === 1 ? '' : 's'} left
                </span>
              </p>
              <p className="mt-2 text-sm text-[#C5D0D8]">
                {wl.used_mints > 0 ? `${wl.used_mints} already minted · ` : ''}
                Admin-assigned WL allocation
                {wl.community ? (
                  <span className="text-[#5C6773]"> · {wl.community}</span>
                ) : null}
              </p>
              {canMintNow ? (
                <p className="mt-2 text-xs text-[#00FF9C]">
                  WL is live — mint up to {wlPhase!.max_mintable} at once (FCFS against the {wlSupply} cap).
                </p>
              ) : wlPhase?.phase_note ? (
                <p className="mt-2 text-xs text-[#9BA8B4]">{wlPhase.phase_note}</p>
              ) : null}
            </div>
            <div className="flex flex-col gap-2 sm:items-end">
              {canMintNow ? (
                <button
                  type="button"
                  onClick={() => scrollToSection('mint')}
                  className="min-h-[44px] touch-manipulation border border-[#00FF9C] bg-[#00FF9C]/15 px-4 font-mono text-[10px] font-bold uppercase tracking-widest text-[#00FF9C] hover:bg-[#00FF9C]/25"
                >
                  Mint now
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => scrollToSection('whitelist-detail')}
                className="min-h-[44px] touch-manipulation px-3 font-mono text-[10px] uppercase tracking-widest text-[#9BA8B4] underline-offset-4 hover:text-[#00FF9C] hover:underline"
              >
                Full WL details
              </button>
            </div>
          </div>
          )
        ) : discordPending ? (
          <div className="border border-[#FFD769]/40 bg-[#FFD769]/10 px-4 py-4">
            <p className="text-sm text-[#FFD769]">Discord WL verified — mint spots not assigned yet.</p>
            <p className="mt-2 text-xs text-[#9BA8B4]">
              An admin must upload your wallet before WL opens. Check back here after spots are assigned.
            </p>
          </div>
        ) : onLinkedWallet ? (
          <div className="border border-[#FFD769]/40 bg-[#FFD769]/10 px-4 py-4">
            <p className="text-sm text-[#FFD769]">Your WL spots are on a linked wallet.</p>
            <button
              type="button"
              onClick={() => scrollToSection('wallets')}
              className="mt-3 min-h-[44px] touch-manipulation font-mono text-[10px] font-bold uppercase tracking-widest text-[#00FF9C] underline-offset-4 hover:underline"
            >
              Go to linked wallets
            </button>
          </div>
        ) : (
          <div className="border border-[#1A222B] bg-[#0F1419] px-4 py-4">
            <p className="text-sm text-[#C5D0D8]">No WL mint spots on this wallet yet.</p>
            <p className="mt-2 text-xs text-[#5C6773]">
              WL spots are assigned by admins. Discord WL alone does not grant mint slots until uploaded.
            </p>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {connected && check?.wallet ? (
            <Gen2WlShareButton wallet={check.wallet} mintCheck={check} />
          ) : null}
          <button
            type="button"
            onClick={() => void onRefresh()}
            disabled={loading || !connected}
            className="min-h-[44px] touch-manipulation px-3 font-mono text-[10px] uppercase tracking-widest text-[#00FF9C] underline-offset-4 hover:underline disabled:opacity-50"
          >
            {loading ? 'Checking…' : 'Refresh WL status'}
          </button>
        </div>
      </div>
    </CommandCard>
  )
}
