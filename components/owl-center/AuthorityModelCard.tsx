'use client'

import type { OwlCenterLaunchPublic } from '@/lib/owl-center/types'

type Props = {
  launch: Pick<
    OwlCenterLaunchPublic,
    | 'mint_standard'
    | 'creator_wallet'
    | 'onchain_update_authority'
    | 'platform_update_delegate'
    | 'collection_mint'
  >
  /** Optional live on-chain UA when fetched. */
  onchainUpdateAuthority?: string | null
  compact?: boolean
}

function shortPk(pk: string | null | undefined): string {
  const s = pk?.trim() || ''
  if (s.length < 10) return s || '—'
  return `${s.slice(0, 4)}…${s.slice(-4)}`
}

/**
 * Plain-language Core authority model for creators (submit + manage).
 */
export function AuthorityModelCard({ launch, onchainUpdateAuthority, compact = false }: Props) {
  if (launch.mint_standard !== 'core') {
    return (
      <div className="rounded-lg border border-[#2A3540] bg-[#0B1218] p-4 text-sm text-[#9AA6B2]">
        <p className="font-medium text-[#EAFBF4]">Update authority</p>
        <p className="mt-1">
          Token Metadata collections keep Owltopia as update authority in v1. Contact support for marketplace
          verify — do not expect Orbis “verify as UA” with your creator wallet on this standard.
        </p>
      </div>
    )
  }

  const creator = launch.creator_wallet?.trim() || null
  const ua = (onchainUpdateAuthority || launch.onchain_update_authority || '').trim() || null
  const creatorOwns = Boolean(creator && ua && creator === ua)

  return (
    <div className="rounded-lg border border-[#2A3540] bg-[#0B1218] p-4 text-sm text-[#9AA6B2]">
      <p className="font-medium text-[#EAFBF4]">Who controls this Core collection?</p>
      {!compact ? (
        <p className="mt-1">
          Your creator wallet owns update authority (Orbis / marketplace verify). Owltopia keeps an UpdateDelegate so
          reveal, metadata refresh, and thaw still work. Freeze thaw is signed by Owltopia when freeze was enabled.
        </p>
      ) : null}
      <ul className="mt-3 space-y-1.5 font-mono text-xs text-[#C5D0DA]">
        <li>
          Creator wallet (root UA): <span className="text-[#EAFBF4]">{shortPk(creator)}</span>
        </li>
        <li>
          On-chain update authority:{' '}
          <span className={creatorOwns ? 'text-emerald-300' : 'text-amber-200'}>{shortPk(ua) || 'not set yet'}</span>
          {creatorOwns ? ' · you own it' : ua ? ' · claim or wait for handoff' : ''}
        </li>
        <li>
          Platform UpdateDelegate:{' '}
          <span className="text-[#EAFBF4]">{shortPk(launch.platform_update_delegate) || 'set at deploy'}</span>
        </li>
      </ul>
      <p className="mt-3 text-xs text-[#7A8794]">
        Use a wallet you will keep (hardware / multisig recommended). Solscan may show “Update Authority: N/A” for Mpl
        Core — trust this panel.
      </p>
    </div>
  )
}
