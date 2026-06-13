'use client'

import { useEffect, useState } from 'react'
import { RaffleShareCopyDialog } from '@/components/RaffleShareCopyDialog'
import {
  setRaffleShareCopyOpenHandler,
  type RaffleShareCopyRequest,
} from '@/lib/client/raffle-share-copy-host'

/** App-wide host for the raffle share copy fallback dialog. */
export function RaffleShareCopyHost() {
  const [request, setRequest] = useState<RaffleShareCopyRequest | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    setRaffleShareCopyOpenHandler((req) => {
      setRequest(req)
      setOpen(true)
    })
    return () => setRaffleShareCopyOpenHandler(null)
  }, [])

  if (!request) return null

  return (
    <RaffleShareCopyDialog
      open={open}
      onOpenChange={setOpen}
      title={request.title}
      shareText={request.shareText}
      onCopied={request.onCopied}
    />
  )
}
