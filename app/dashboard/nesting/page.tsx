import { Suspense } from 'react'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { DashboardNestingClient } from '@/components/nesting/DashboardNestingClient'
import { SESSION_COOKIE_NAME, parseSessionCookieValue } from '@/lib/auth-server'
import { getAdminRole } from '@/lib/db/admins'

export const dynamic = 'force-dynamic'

function NestingFallback() {
  return (
    <main className="container mx-auto px-4 py-10 max-w-4xl flex justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-hidden />
    </main>
  )
}

export default async function DashboardNestingPage() {
  const session = parseSessionCookieValue((await cookies()).get(SESSION_COOKIE_NAME)?.value)
  const role = session ? await getAdminRole(session.wallet) : null
  if (!role) {
    redirect('/')
  }

  return (
    <Suspense fallback={<NestingFallback />}>
      <DashboardNestingClient />
    </Suspense>
  )
}
