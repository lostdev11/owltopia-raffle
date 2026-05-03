import Image from 'next/image'
import Link from 'next/link'

import type { OwlCenterLaunchPublic } from '@/lib/owl-center/types'

import { PhaseBadge } from '@/components/owl-center/PhaseBadge'
import { StatusBadge } from '@/components/owl-center/StatusBadge'
import { SupplyProgress } from '@/components/owl-center/SupplyProgress'

const btnPrimary =
  'inline-flex min-h-[44px] touch-manipulation items-center justify-center border border-[#00FF9C]/40 bg-[#00FF9C]/10 px-6 font-bold uppercase tracking-wide text-[#E8FDF4] shadow-[0_0_24px_rgba(0,255,156,0.18)] hover:bg-[#00FF9C]/18'
const btnGhost =
  'inline-flex min-h-[44px] touch-manipulation items-center justify-center border border-[#1A222B] px-6 font-semibold uppercase tracking-wide text-[#9BA8B4] hover:border-[#00FF9C]/35 hover:text-[#E8EEF2]'

function hrefForLaunch(slug: string): string {
  return `/owl-center/collection/${slug}`
}

function ctaLabel(launch: OwlCenterLaunchPublic): string {
  if (launch.active_phase === 'TRADING_ACTIVE') return 'Trade Now'
  if (launch.active_phase === 'SOLD_OUT') return 'View Collection'
  if (launch.active_phase === 'PRESALE') return 'Enter Presale'
  if (launch.active_phase === 'WHITELIST' || launch.active_phase === 'PUBLIC' || launch.active_phase === 'AIRDROP') {
    return 'Mint Now'
  }
  return 'View Collection'
}

function ctaHref(launch: OwlCenterLaunchPublic): string {
  if (launch.active_phase === 'TRADING_ACTIVE')
    return launch.magic_eden_url || launch.tensor_url || hrefForLaunch(launch.slug)
  if (launch.slug === 'gen2' && launch.active_phase === 'PRESALE') return '/gen2-presale'
  return hrefForLaunch(launch.slug)
}

function mintPriceLabel(launch: OwlCenterLaunchPublic): string {
  switch (launch.active_phase) {
    case 'PRESALE':
      return `${launch.presale_price_usdc ?? 20} USDC-notional (SOL)`
    case 'WHITELIST':
      return `${launch.wl_price_usdc ?? 30} USDC-notional (SOL)`
    case 'PUBLIC':
      return `${launch.public_price_usdc ?? 40} USDC-notional (SOL)`
    default:
      return '—'
  }
}

export function CollectionCard({ launch }: { launch: OwlCenterLaunchPublic }) {
  const img =
    launch.image_url?.startsWith('http://') || launch.image_url?.startsWith('https://')
      ? launch.image_url
      : launch.image_url?.startsWith('/')
        ? launch.image_url
        : '/images/gen2-logo-mark.png'
  const internal = ctaHref(launch).startsWith('/')

  return (
    <article className="flex flex-col border border-[#1A222B] bg-[#10161C]/85">
      <div className="relative aspect-[4/3] border-b border-[#1A222B] bg-[#0F1419]">
        {img.startsWith('http') ? (
          // eslint-disable-next-line @next/next/no-img-element -- remote creator URLs not in next/image domains
          <img src={img} alt="" className="absolute inset-0 m-auto max-h-full max-w-full object-contain p-6" />
        ) : (
          <Image src={img} alt="" fill className="object-contain p-6" sizes="(max-width:768px) 100vw, 360px" />
        )}
        <span className="absolute left-2 top-2 rounded-none border border-[#00FF9C]/30 bg-[#0F1419]/90 px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-widest text-[#00FF9C]">
          Solana
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={launch.status} />
          <PhaseBadge phase={launch.active_phase} pulse={launch.active_phase === 'PRESALE'} />
        </div>
        <div>
          <h3 className="font-display text-xl text-[#F4FBF8]">{launch.name}</h3>
          <p className="mt-1 font-mono text-xs text-[#5C6773]">
            {launch.creator_wallet ? `Creator ${launch.creator_wallet.slice(0, 4)}…` : 'Owltopia'}
          </p>
        </div>
        <SupplyProgress minted={launch.minted_count} total={launch.total_supply} />
        <p className="font-mono text-xs text-[#9BA8B4]">
          Mint price: <span className="text-[#00FF9C]">{mintPriceLabel(launch)}</span>
        </p>
        <div className="mt-auto flex flex-wrap gap-2 pt-2">
          {internal ? (
            <Link href={ctaHref(launch)} className={`${btnPrimary} w-full sm:w-auto`}>
              {ctaLabel(launch)}
            </Link>
          ) : (
            <a href={ctaHref(launch)} target="_blank" rel="noreferrer" className={`${btnPrimary} w-full sm:w-auto`}>
              {ctaLabel(launch)}
            </a>
          )}
          <Link href={hrefForLaunch(launch.slug)} className={`${btnGhost} w-full sm:w-auto`}>
            Hub
          </Link>
        </div>
      </div>
    </article>
  )
}
