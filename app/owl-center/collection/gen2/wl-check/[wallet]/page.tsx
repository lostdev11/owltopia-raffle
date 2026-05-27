import Link from 'next/link'

import { Gen2WlShareActions } from '@/components/owl-center/Gen2WlShareActions'
import { buildGen2WlCheckShareSnapshot } from '@/lib/owl-center/gen2-wl-check-share'
import { PLATFORM_NAME } from '@/lib/site-config'

export const dynamic = 'force-dynamic'

export default async function Gen2WlCheckSharePage({
  params,
}: {
  params: Promise<{ wallet: string }>
}) {
  const { wallet: walletParam } = await params
  const walletRaw = typeof walletParam === 'string' ? decodeURIComponent(walletParam.trim()) : ''
  const snapshot = await buildGen2WlCheckShareSnapshot(walletRaw)

  const statusColor =
    snapshot.variant === 'eligible_active' || snapshot.variant === 'eligible_assigned'
      ? 'text-[#00FF9C]'
      : snapshot.variant === 'pending_allocation'
        ? 'text-[#FFD769]'
        : snapshot.variant === 'used_up'
          ? 'text-[#9BA8B4]'
          : 'text-[#FF9C9C]'

  return (
    <main className="mx-auto flex min-h-[70dvh] max-w-lg flex-col justify-center gap-6 px-4 py-10 pb-[max(2.5rem,env(safe-area-inset-bottom))]">
      <p className="font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">gen2_wl_checker.share</p>
      <div className="space-y-3 border border-[#1A222B] bg-[#0B0F14]/90 p-5">
        <h1 className={`font-mono text-xl font-bold uppercase tracking-wide ${statusColor}`}>
          {snapshot.page.headline}
        </h1>
        <p className="font-mono text-sm leading-relaxed text-[#9BA8B4]">{snapshot.page.subline}</p>
      </div>

      {snapshot.wallet ? (
        <Gen2WlShareActions wallet={snapshot.wallet} snapshotVariant={snapshot.variant} />
      ) : null}

      <Link
        href="/owl-center/collection/gen2"
        className="inline-flex min-h-[44px] touch-manipulation items-center justify-center rounded-md border border-[#00FF9C]/40 bg-[#00FF9C]/10 px-4 font-mono text-xs uppercase tracking-widest text-[#00FF9C] hover:bg-[#00FF9C]/15"
      >
        Open Gen2 mint center
      </Link>

      <p className="text-center font-mono text-[10px] text-[#5C6773]">{PLATFORM_NAME}</p>
    </main>
  )
}
