'use client'

import { useParams } from 'next/navigation'

import { CollectionAssetsAdminClient } from '@/components/owl-center/CollectionAssetsAdminClient'

export default function AdminOwlCenterCollectionAssetsPage() {
  const params = useParams()
  const id = typeof params?.id === 'string' ? params.id : ''

  if (!id) {
    return (
      <main className="min-h-screen bg-[#0F1419] px-4 py-10 text-[#E8EEF2]">
        <p className="font-mono text-sm text-[#FF9C9C]">Missing collection id</p>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-[#0F1419] px-4 py-10 text-[#E8EEF2]">
      <div className="mx-auto max-w-4xl">
        <CollectionAssetsAdminClient launchId={id} />
      </div>
    </main>
  )
}
