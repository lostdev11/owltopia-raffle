'use client'

import { Suspense } from 'react'
import { Loader2 } from 'lucide-react'
import { DashboardNestingClient } from '@/components/nesting/DashboardNestingClient'

function NestingFallback() {
  return (
    <main className="container mx-auto px-4 py-10 max-w-4xl flex justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-hidden />
    </main>
  )
}

export default function DashboardNestingPage() {
  return (
    <Suspense fallback={<NestingFallback />}>
      <DashboardNestingClient />
    </Suspense>
  )
}
