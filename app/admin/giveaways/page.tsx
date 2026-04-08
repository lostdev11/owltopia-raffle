'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

export default function AdminGiveawaysPage() {
  const router = useRouter()

  useEffect(() => {
    router.replace('/admin/community-giveaways')
  }, [router])

  return (
    <div className="container mx-auto py-8 px-4">
      <Card className="max-w-lg mx-auto">
        <CardHeader>
          <CardTitle>Giveaways</CardTitle>
          <CardDescription>Redirecting to Community pool giveaways.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild className="touch-manipulation min-h-[44px] w-full">
            <Link href="/admin/community-giveaways">Go to Community pool giveaways</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
