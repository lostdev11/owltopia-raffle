import Link from 'next/link'

import type { OwlCenterLaunchPublic } from '@/lib/owl-center/types'

import { HubCardCoverImage } from '@/components/owl-center/HubCardCoverImage'
import { LaunchMintDetails } from '@/components/owl-center/LaunchMintDetails'
import { PhaseBadge } from '@/components/owl-center/PhaseBadge'
import { StatusBadge } from '@/components/owl-center/StatusBadge'
import {
  owlCenterBtnDisabled,
  owlCenterBtnGhost,
  owlCenterBtnPrimary,
} from '@/components/owl-center/owl-center-cta-styles'

function hrefForLaunch(slug: string): string {
  return `/owl-center/collection/${slug}`
}

function ctaLabel(launch: OwlCenterLaunchPublic, presaleSoldOut: boolean): string {
  if (launch.active_phase === 'TRADING_ACTIVE') return 'Trade Now'
  if (launch.active_phase === 'SOLD_OUT') return 'View Collection'
  if (launch.active_phase === 'PRESALE') {
    return presaleSoldOut && launch.slug === 'gen2' ? 'Presale sold out' : 'Enter Presale'
  }
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

function isPresaleCtaDisabled(launch: OwlCenterLaunchPublic, presaleSoldOut: boolean): boolean {
  return launch.slug === 'gen2' && launch.active_phase === 'PRESALE' && presaleSoldOut
}

export function CollectionCard({
  launch,
  presaleSoldOut = false,
}: {
  launch: OwlCenterLaunchPublic
  presaleSoldOut?: boolean
}) {
  const href = ctaHref(launch)
  const internal = href.startsWith('/')
  const presaleDisabled = isPresaleCtaDisabled(launch, presaleSoldOut)
  const label = ctaLabel(launch, presaleSoldOut)

  return (
    <article className="flex flex-col border border-[#1A222B] bg-[#10161C]/85">
      <div className="relative aspect-[4/3] border-b border-[#1A222B] bg-[#0F1419]">
        <HubCardCoverImage imageUrl={launch.image_url} />
        <span className="absolute left-2 top-2 rounded-none border border-[#00FF9C]/30 bg-[#0F1419]/90 px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-widest text-[#00FF9C]">
          Solana
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={launch.status} />
          <PhaseBadge
            phase={launch.active_phase}
            pulse={launch.active_phase === 'PRESALE' && !presaleSoldOut}
            presaleSoldOut={launch.slug === 'gen2' ? presaleSoldOut : false}
          />
        </div>
        <div>
          <h3 className="font-display text-xl text-[#F4FBF8]">{launch.name}</h3>
          <p className="mt-1 font-mono text-xs text-[#5C6773]">
            {launch.creator_wallet ? `Creator ${launch.creator_wallet.slice(0, 4)}…` : 'Owltopia'}
          </p>
        </div>
        <LaunchMintDetails launch={launch} />
        <div className="mt-auto flex flex-wrap gap-2 pt-2">
          {presaleDisabled ? (
            <span
              className={`${owlCenterBtnDisabled} w-full sm:w-auto`}
              aria-disabled="true"
              title="All presale spots have been claimed"
            >
              {label}
            </span>
          ) : internal ? (
            <Link href={href} className={`${owlCenterBtnPrimary} w-full sm:w-auto`}>
              {label}
            </Link>
          ) : (
            <a href={href} target="_blank" rel="noreferrer" className={`${owlCenterBtnPrimary} w-full sm:w-auto`}>
              {label}
            </a>
          )}
          <Link href={hrefForLaunch(launch.slug)} className={`${owlCenterBtnGhost} w-full sm:w-auto`}>
            Hub
          </Link>
        </div>
      </div>
    </article>
  )
}
