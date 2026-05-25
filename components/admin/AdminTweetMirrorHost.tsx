'use client'

import { useEffect, useState } from 'react'
import { AdminTweetMirrorDialog } from '@/components/admin/AdminTweetMirrorDialog'
import {
  setAdminTweetMirrorOpenHandler,
  type AdminTweetMirrorRequest,
} from '@/lib/client/admin-tweet-mirror-host'

/** App-wide host for the admin #x-post tweet mirror dialog (Share on raffle pages). */
export function AdminTweetMirrorHost() {
  const [request, setRequest] = useState<AdminTweetMirrorRequest | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    setAdminTweetMirrorOpenHandler((req) => {
      setRequest(req)
      setOpen(true)
    })
    return () => setAdminTweetMirrorOpenHandler(null)
  }, [])

  if (!request) return null

  return (
    <AdminTweetMirrorDialog
      open={open}
      onOpenChange={setOpen}
      raffleId={request.raffleId}
      raffleTitle={request.raffleTitle}
    />
  )
}
