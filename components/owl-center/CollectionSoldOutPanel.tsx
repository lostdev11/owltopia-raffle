'use client'

import Link from 'next/link'

import { CommandCard } from '@/components/owl-center/CommandCard'
import { DeployButton } from '@/components/owl-center/DeployButton'
import { TradingButtons } from '@/components/owl-center/TradingButtons'
import { orbisListCollectionUrl } from '@/lib/owl-center/marketplace-urls'
import type { OwlCenterLaunchPublic } from '@/lib/owl-center/types'

export function CollectionSoldOutPanel({
  slug,
  launch,
  mintCount,
  hashListReady,
  orbisUrl,
  magicEdenUrl,
  tensorUrl,
  tradingActive,
}: {
  slug: string
  launch: OwlCenterLaunchPublic
  mintCount: number
  hashListReady: boolean
  orbisUrl?: string | null
  magicEdenUrl: string | null
  tensorUrl: string | null
  tradingActive: boolean
}) {
  const hashListHref = `/api/owl-center/collections/${encodeURIComponent(slug)}/hash-list`
  const mintDetailsHref = `/owl-center/my-launches/${launch.id}/mint-details#launch-ops`
  const orbisListHref = orbisListCollectionUrl()

  return (
    <CommandCard label="SOLD OUT // marketplace">
      <p className="text-sm leading-relaxed text-[#C5D0D8]">
        All {launch.total_supply} pieces minted. List on{' '}
        <strong className="font-normal text-[#EAFBF4]">Orbis</strong> first, then optionally Magic Eden and Tensor.
        Your hash list is ready when you need it for ME.
      </p>

      <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm text-[#9BA8B4]">
        <li>
          Copy your collection mint and submit via{' '}
          <a href={orbisListHref} target="_blank" rel="noreferrer" className="text-[#00FF9C] underline">
            Orbis List Your Collection
          </a>
          .
        </li>
        <li>
          (Optional) Download or copy the hash list ({mintCount} mint{mintCount === 1 ? '' : 's'}) and submit it in the{' '}
          <a
            href="https://magiceden.io/creators"
            target="_blank"
            rel="noreferrer"
            className="text-[#00FF9C] underline"
          >
            Magic Eden creator hub
          </a>
          .
        </li>
        <li>(Optional) Verify the collection on Tensor creator tools (collection mint).</li>
        <li>
          In{' '}
          <Link href={mintDetailsHref} className="text-[#00FF9C] underline">
            Mint details
          </Link>
          , paste your live Orbis (and ME / Tensor) URLs, then activate trading links.
        </li>
      </ol>

      <div className="mt-6 flex flex-wrap gap-3">
        <a
          href={orbisListHref}
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-[44px] touch-manipulation items-center justify-center border border-[#00FF9C]/40 bg-[#00FF9C]/10 px-6 font-bold uppercase tracking-wide text-[#E8FDF4] hover:bg-[#00FF9C]/18"
        >
          Open Orbis list
        </a>
        {hashListReady ? (
          <a
            href={hashListHref}
            download={`${slug}-hash-list.txt`}
            className="inline-flex min-h-[44px] touch-manipulation items-center justify-center border border-[#1A222B] px-6 font-semibold uppercase tracking-wide text-[#9BA8B4] hover:border-[#00FF9C]/35"
          >
            Download hash list
          </a>
        ) : (
          <DeployButton type="button" disabled>
            Preparing hash list…
          </DeployButton>
        )}
        <Link
          href={mintDetailsHref}
          className="inline-flex min-h-[44px] touch-manipulation items-center justify-center border border-[#00FF9C]/40 px-6 font-bold uppercase tracking-wide text-[#00FF9C] hover:bg-[#00FF9C]/10"
        >
          Finish listing setup
        </Link>
        {orbisUrl ? (
          <a
            href={orbisUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-[44px] items-center border border-[#1A222B] px-4 text-sm font-semibold text-[#9BA8B4] hover:border-[#00FF9C]/35"
          >
            Orbis collection
          </a>
        ) : null}
        {magicEdenUrl ? (
          <a
            href={magicEdenUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-[44px] items-center border border-[#1A222B] px-4 text-sm font-semibold text-[#9BA8B4] hover:border-[#00FF9C]/35"
          >
            Magic Eden collection
          </a>
        ) : null}
      </div>

      {tradingActive ? (
        <div className="mt-6 border-t border-[#1A222B] pt-6">
          <p className="mb-3 font-mono text-[10px] uppercase tracking-widest text-[#00C97A]">Trading live</p>
          <TradingButtons
            orbisUrl={orbisUrl ?? launch.orbis_url}
            magicEdenUrl={magicEdenUrl ?? launch.magic_eden_url}
            tensorUrl={tensorUrl ?? launch.tensor_url}
          />
        </div>
      ) : null}
    </CommandCard>
  )
}
