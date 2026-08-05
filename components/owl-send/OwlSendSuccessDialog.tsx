'use client'

import { CheckCircle2, ExternalLink } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { OwlSendSolscanTxUrl } from '@/lib/owl-send/explorer'

export type OwlSendSuccessItem = {
  /** Display name (NFT name / token symbol). */
  name: string
  image?: string | null
  /** Short recipient label, e.g. qg7p…RGA */
  recipientLabel?: string | null
}

export type OwlSendSuccessState = {
  title: string
  detail?: string
  signature: string
  /** NFTs / tokens included in this confirmed approval. */
  items?: OwlSendSuccessItem[]
} | null

type Props = {
  success: OwlSendSuccessState
  onClose: () => void
}

function shortenAddr(addr: string): string {
  if (addr.length <= 12) return addr
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`
}

/** Centered success popup after NFT/token send — lists what went out + Solscan link. */
export function OwlSendSuccessDialog({ success, onClose }: Props) {
  const open = Boolean(success?.signature)
  const href = success?.signature ? OwlSendSolscanTxUrl(success.signature) : '#'
  const items = success?.items ?? []

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <DialogContent className="border-emerald-500/30 bg-[#0c100e] sm:max-w-md">
        <DialogHeader className="space-y-3 text-left">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/20">
            <CheckCircle2 className="h-7 w-7 text-emerald-400" />
          </div>
          <DialogTitle className="text-xl text-emerald-100">
            {success?.title ?? 'Sent successfully'}
          </DialogTitle>
          {success?.detail ? (
            <DialogDescription className="text-sm text-muted-foreground">
              {success.detail}
            </DialogDescription>
          ) : (
            <DialogDescription className="sr-only">Transfer confirmed on Solana.</DialogDescription>
          )}
        </DialogHeader>

        {items.length > 0 ? (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">
              Sent ({items.length})
            </p>
            <ul className="max-h-56 space-y-1.5 overflow-y-auto rounded-lg border border-white/10 bg-black/40 p-2">
              {items.map((item, i) => (
                <li
                  key={`${item.name}-${item.recipientLabel ?? ''}-${i}`}
                  className="flex min-w-0 items-center gap-2 rounded-md px-1.5 py-1"
                >
                  {item.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={item.image}
                      alt=""
                      className="h-9 w-9 shrink-0 rounded-md object-cover"
                    />
                  ) : (
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-white/5 text-[10px] text-muted-foreground">
                      NFT
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-emerald-50">{item.name}</p>
                    {item.recipientLabel ? (
                      <p className="truncate font-mono text-[11px] text-muted-foreground">
                        → {item.recipientLabel}
                      </p>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {success?.signature ? (
          <div className="space-y-2 rounded-lg border border-white/10 bg-black/40 px-3 py-2.5">
            <p className="text-xs font-medium text-muted-foreground">Transaction</p>
            <p className="break-all font-mono text-[11px] text-emerald-100/80">{success.signature}</p>
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-[44px] items-center gap-2 text-sm font-semibold text-theme-prime underline-offset-2 hover:underline"
            >
              View on Solscan
              <ExternalLink className="h-4 w-4" aria-hidden />
            </a>
          </div>
        ) : null}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" className="w-full min-h-[48px] sm:w-auto" onClick={onClose}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Build success-dialog items from OwlSend NFT lines. */
export function owlSendSuccessItemsFromNftLines(
  lines: Array<{
    mint: string
    recipient: string
    name?: string | null
    image?: string | null
  }>,
  opts?: { showRecipient?: boolean }
): OwlSendSuccessItem[] {
  const showRecipient = opts?.showRecipient !== false
  return lines.map((l) => ({
    name: l.name?.trim() || shortenAddr(l.mint),
    image: l.image ?? null,
    recipientLabel: showRecipient && l.recipient ? shortenAddr(l.recipient) : null,
  }))
}
