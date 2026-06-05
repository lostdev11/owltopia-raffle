'use client'

import Link from 'next/link'

import { CommandCard } from '@/components/owl-center/CommandCard'
import { DeployButton } from '@/components/owl-center/DeployButton'
import { TradingButtons } from '@/components/owl-center/TradingButtons'
import type { OwlCenterLaunchPublic } from '@/lib/owl-center/types'

export function CollectionSoldOutPanel({
  slug,
  launch,
  mintCount,
  hashListReady,
  magicEdenUrl,
  tensorUrl,
  tradingActive,
}: {
  slug: string
  launch: OwlCenterLaunchPublic
  mintCount: number
  hashListReady: boolean
  magicEdenUrl: string | null
  tensorUrl: string | null
  tradingActive: boolean
}) {
  const hashListHref = `/api/owl-center/collections/${encodeURIComponent(slug)}/hash-list`

  return (
    <CommandCard label="SOLD OUT // marketplace">
      <p className="text-sm leading-relaxed text-[#C5D0D8]">
        All {launch.total_supply} pieces minted. Hash list is generated for{' '}
        <strong className="font-normal text-[#EAFBF4]">Magic Eden</strong> and{' '}
        <strong className="font-normal text-[#EAFBF4]">Tensor</strong> submission.
      </p>

      <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm text-[#9BA8B4]">
        <li>
          Download the hash list ({mintCount} mint{mintCount === 1 ? '' : 's'}) and upload it in the{' '}
          <a
            href="https://magiceden.io/creators"
            target="_blank"
            rel="noreferrer"
            className="text-[#00FF9C] underline"
          >
            Magic Eden creator hub
          </a>{' '}
          for this collection.
        </li>
        <li>Verify the collection on Tensor creator tools (collection mint).</li>
        <li>Admin marks ME + Tensor as listed and activates trading links.</li>
      </ol>

      <div className="mt-6 flex flex-wrap gap-3">
        {hashListReady ? (
          <a
            href={hashListHref}
            download={`${slug}-hash-list.txt`}
            className="inline-flex min-h-[44px] touch-manipulation items-center justify-center border border-[#00FF9C]/40 bg-[#00FF9C]/10 px-6 font-bold uppercase tracking-wide text-[#E8FDF4] hover:bg-[#00FF9C]/18"
          >
            Download hash list
          </a>
        ) : (
          <DeployButton type="button" disabled>
            Hash list pending…
          </DeployButton>
        )}
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
        <Link
          href="/admin/owl-center/demo"
          className="inline-flex min-h-[44px] items-center border border-[#1A222B] px-4 text-sm text-[#9BA8B4] hover:text-[#00FF9C]"
        >
          Admin: finalize listing
        </Link>
      </div>

      {tradingActive ? (
        <div className="mt-6 border-t border-[#1A222B] pt-6">
          <p className="mb-3 font-mono text-[10px] uppercase tracking-widest text-[#00C97A]">Trading live</p>
          <TradingButtons magicEdenUrl={magicEdenUrl ?? launch.magic_eden_url} tensorUrl={tensorUrl ?? launch.tensor_url} />
        </div>
      ) : null}
    </CommandCard>
  )
}
