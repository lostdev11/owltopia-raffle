'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'

export type RaffleShareCopyDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  shareText: string
  onCopied?: () => void
}

export function RaffleShareCopyDialog({
  open,
  onOpenChange,
  title,
  shareText,
  onCopied,
}: RaffleShareCopyDialogProps) {
  const [copied, setCopied] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!open) {
      setCopied(false)
      return
    }
    window.setTimeout(() => {
      textareaRef.current?.focus()
      textareaRef.current?.select()
    }, 0)
  }, [open, shareText])

  const handleCopy = useCallback(async () => {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(shareText)
        setCopied(true)
        onCopied?.()
        window.setTimeout(() => setCopied(false), 2000)
        return
      } catch {
        // Fall through to select-all for manual copy.
      }
    }
    textareaRef.current?.focus()
    textareaRef.current?.select()
  }, [shareText, onCopied])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Copy raffle link</DialogTitle>
          <DialogDescription className="text-left">
            Clipboard access was blocked. Copy the text below to share{' '}
            <span className="font-medium text-foreground">{title}</span>.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="raffle_share_copy_text" className="sr-only">
            Share text
          </Label>
          <textarea
            id="raffle_share_copy_text"
            ref={textareaRef}
            readOnly
            rows={5}
            value={shareText}
            className="flex min-h-[120px] w-full rounded-md border border-input bg-muted/50 px-3 py-2 text-sm font-mono ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            onFocus={(e) => e.currentTarget.select()}
          />
          <p className="text-xs text-muted-foreground">
            Tap the text to select all, or use Copy below.
          </p>
        </div>

        <DialogFooter className="gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="min-h-[44px] touch-manipulation w-full sm:w-auto"
          >
            Close
          </Button>
          <Button
            type="button"
            onClick={() => void handleCopy()}
            className="min-h-[44px] touch-manipulation w-full sm:w-auto"
          >
            {copied ? 'Copied!' : 'Copy'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
