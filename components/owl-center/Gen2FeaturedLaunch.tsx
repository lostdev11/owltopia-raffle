import Link from 'next/link'

import { PhaseBadge } from '@/components/owl-center/PhaseBadge'
import type { OwlCenterLaunchPublic } from '@/lib/owl-center/types'

const btnPrimary =
  'inline-flex min-h-[44px] touch-manipulation items-center justify-center border border-[#00FF9C]/40 bg-[#00FF9C]/10 px-6 font-bold uppercase tracking-wide text-[#E8FDF4] shadow-[0_0_24px_rgba(0,255,156,0.18)] hover:bg-[#00FF9C]/18'
const btnGhost =
  'inline-flex min-h-[44px] touch-manipulation items-center justify-center border border-[#1A222B] px-6 font-semibold uppercase tracking-wide text-[#9BA8B4] hover:border-[#00FF9C]/35 hover:text-[#E8EEF2]'

export function Gen2FeaturedLaunch({ launch }: { launch: OwlCenterLaunchPublic }) {
  return (
    <div className="border border-[#00FF9C]/35 bg-[#10161C]/95 p-6 shadow-[0_0_48px_rgba(0,255,156,0.08)] md:p-10">
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-mono text-[10px] font-bold uppercase tracking-[0.35em] text-[#00C97A]">Featured Launch</span>
        <PhaseBadge phase={launch.active_phase} pulse />
      </div>
      <h2 className="mt-4 font-display text-3xl text-[#F4FBF8] md:text-4xl">{launch.name}</h2>
      <p className="mt-2 max-w-2xl text-sm text-[#9BA8B4]">
        Powered by Owl Center — Solana-native launch infrastructure for presale credits, phased mint, and trading
        activation.
      </p>
      <ul className="mt-6 space-y-2 font-mono text-xs text-[#C5D0D8]">
        <li className="flex gap-2">
          <span className="text-[#00FF9C]">▸</span>
          Presale Live visibility across Owltopia — credits redeem on the Gen2 mint page during PRESALE phase.
        </li>
        <li className="flex gap-2">
          <span className="text-[#00FF9C]">▸</span>
          Total supply {launch.total_supply.toLocaleString()} · Breakdown: airdrop {launch.airdrop_supply}, presale{' '}
          {launch.presale_supply}, WL {launch.wl_supply}, public {launch.public_supply}.
        </li>
      </ul>
      <div className="mt-8 flex flex-wrap gap-3">
        <Link href="/gen2-presale" className={`${btnPrimary} min-w-[160px]`}>
          Enter Presale
        </Link>
        <Link href="/owl-center/collection/gen2" className={`${btnGhost} min-w-[200px]`}>
          View Gen2 Mint Page
        </Link>
      </div>
    </div>
  )
}
