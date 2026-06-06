import Link from 'next/link'

import { getOwlCenterLaunchBySlugAdmin } from '@/lib/db/owl-center-launch'

export default async function AdminOwlCenterMarketplacesHubPage() {
  const gen2 = await getOwlCenterLaunchBySlugAdmin('gen2')

  return (
    <main className="min-h-screen bg-[#0F1419] px-4 py-10 text-[#E8EEF2]">
      <div className="mx-auto max-w-2xl space-y-6">
        <h1 className="font-display text-3xl text-[#F4FBF8]">Marketplace readiness</h1>
        <p className="text-sm text-[#9BA8B4]">
          Track Magic Eden and Tensor indexing from the collection assets console — no automated listings in V1.
        </p>
        {gen2 ? (
          <Link
            href={`/admin/owl-center/collections/${gen2.id}/assets`}
            className="inline-flex min-h-[44px] items-center border border-[#00FF9C]/35 px-5 font-mono text-sm uppercase tracking-wide text-[#00FF9C] hover:bg-[#00FF9C]/10"
          >
            Owltopia Gen2 — assets & marketplaces
          </Link>
        ) : (
          <p className="font-mono text-sm text-[#FF9C9C]">Gen2 launch row missing.</p>
        )}
        <Link href="/admin/owl-center" className="block font-mono text-xs text-[#5C6773] hover:text-[#00FF9C]">
          ← Launchpad hub
        </Link>
      </div>
    </main>
  )
}
