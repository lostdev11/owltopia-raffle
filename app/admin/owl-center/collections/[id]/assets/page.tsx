'use client'

import { useParams } from 'next/navigation'

import { CollectionAssetsAdminClient } from '@/components/owl-center/CollectionAssetsAdminClient'

export default function AdminOwlCenterCollectionAssetsPage() {
  const params = useParams()
  const id = typeof params?.id === 'string' ? params.id : ''

  if (!id) {
    return (
      <main className="min-h-screen bg-[#0F1419] px-4 pb-[max(2.5rem,env(safe-area-inset-bottom))] pt-[max(2rem,env(safe-area-inset-top))] text-[#E8EEF2] sm:py-10">
        <p className="font-mono text-sm text-[#FF9C9C]">Missing collection id</p>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-[#0F1419] px-4 pb-[max(2.5rem,env(safe-area-inset-bottom))] pt-[max(2rem,env(safe-area-inset-top))] text-[#E8EEF2] sm:py-10">
      <div className="mx-auto max-w-4xl">
        <CollectionAssetsAdminClient launchId={id} />
      </div>
    </main>
  )
}
