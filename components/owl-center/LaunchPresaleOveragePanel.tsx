'use client'

import { useWallet } from '@solana/wallet-adapter-react'

import { AdminWalletBulkUpload } from '@/components/admin/AdminWalletBulkUpload'
import { CommandCard } from '@/components/owl-center/CommandCard'
import { launchHasPresaleProgram, launchShowsPresaleOverage } from '@/lib/owl-center/launch-presale'
import type { OwlCenterLaunchPublic } from '@/lib/owl-center/types'

export function LaunchPresaleOveragePanel({ launchId, launch }: { launchId: string; launch: OwlCenterLaunchPublic }) {
  const { connected } = useWallet()

  if (launch.slug === 'gen2') return null
  if (!launchHasPresaleProgram(launch)) {
    return (
      <CommandCard label="PRESALE_OVERAGE · LAUNCH">
        <p className="text-sm text-[#9BA8B4]">
          Presale overage (Presale+ phase) is disabled for this launch. Enable presale on submission or set{' '}
          <span className="text-[#E8EEF2]">presale_supply</span> on the launch row to configure overshoot mint spots.
        </p>
      </CommandCard>
    )
  }

  return (
    <CommandCard label="PRESALE_OVERAGE · LAUNCH">
      <p className="mb-4 text-sm leading-relaxed text-[#9BA8B4]">
        When presale credits exceed the <span className="text-[#E8EEF2]">presale_supply</span> cap, overshoot wallets mint
        during <span className="text-[#00FF9C]">PRESALE_OVERAGE</span>. Pool size:{' '}
        <span className="tabular-nums text-[#00FF9C]">{launch.presale_overage_supply}</span>
        {launchShowsPresaleOverage(launch) ? '' : ' (set presale_overage_supply > 0)'}.
      </p>
      <AdminWalletBulkUpload
        connected={connected}
        apiPath={`/api/admin/owl-center/collections/${launchId}/presale-overage/bulk`}
        description="One wallet per line (or CSV). Assign wallets that bought past the presale cap — they mint in Presale+ when that phase is live."
        submitLabel="Upload Presale+ overage wallets"
      />
    </CommandCard>
  )
}
