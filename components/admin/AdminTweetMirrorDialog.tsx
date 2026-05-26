'use client'

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { mirrorAdminTweetShareToDiscord } from '@/lib/client/raffle-share'

export type AdminTweetMirrorDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  raffleId: string
  raffleTitle: string
  onMirrored?: (result: { ok: boolean; error?: string }) => void
}

export function AdminTweetMirrorDialog({
  open,
  onOpenChange,
  raffleId,
  raffleTitle,
  onMirrored,
}: AdminTweetMirrorDialogProps) {
  const [tweetUrl, setTweetUrl] = useState('')
  const [posting, setPosting] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => {
    if (!open) return
    setTweetUrl('')
    setMessage(null)
    setPosting(false)
  }, [open, raffleId])

  const handlePost = async () => {
    const url = tweetUrl.trim()
    if (!url) {
      setMessage({ type: 'error', text: 'Paste the link to your tweet on @Owltopia_sol.' })
      return
    }
    setPosting(true)
    setMessage(null)
    try {
      const result = await mirrorAdminTweetShareToDiscord(raffleId, url)
      onMirrored?.(result)
      if (!result.ok) {
        setMessage({
          type: 'error',
          text:
            result.error ??
            'Could not post to Discord. Use the x.com/Owltopia_sol/status/… link after the tweet is live.',
        })
        return
      }
      setMessage({
        type: 'success',
        text: 'Posted to #x-post. Repeat for each raffle, then post one @raid ping in Discord (Daily X raid).',
      })
      window.setTimeout(() => onOpenChange(false), 1400)
    } finally {
      setPosting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Post tweet to Discord</DialogTitle>
          <DialogDescription className="text-left">
            <span className="font-medium text-foreground">{raffleTitle}</span>
          </DialogDescription>
        </DialogHeader>

        <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
          <li>
            <span className="text-foreground">Post on @Owltopia_sol</span> (X should be open already)
          </li>
          <li>
            On X, open your tweet → <span className="text-foreground">Share → Copy link</span>
          </li>
          <li>Paste that link below → we post the tweet preview to #x-post</li>
        </ol>

        <div className="space-y-2">
          <Label htmlFor="admin_tweet_mirror_url">Tweet link</Label>
          <Input
            id="admin_tweet_mirror_url"
            type="url"
            inputMode="url"
            autoComplete="off"
            placeholder="https://x.com/Owltopia_sol/status/…"
            value={tweetUrl}
            onChange={(e) => setTweetUrl(e.target.value)}
            className="min-h-[44px] touch-manipulation font-mono text-xs"
          />
          <p className="text-xs text-muted-foreground">
            Use the link from X — not owltopia.xyz. The tweet must be published first.
          </p>
        </div>

        {message && (
          <p
            role="status"
            className={
              message.type === 'success'
                ? 'text-sm text-emerald-600 dark:text-emerald-400'
                : 'text-sm text-destructive'
            }
          >
            {message.text}
          </p>
        )}

        <DialogFooter className="flex-col gap-2 sm:flex-col sm:space-x-0">
          <Button
            type="button"
            onClick={() => void handlePost()}
            disabled={posting}
            className="w-full min-h-[44px] touch-manipulation"
          >
            {posting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2 shrink-0" />
                Posting…
              </>
            ) : (
              'Post to Discord'
            )}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={posting}
            className="w-full min-h-[44px] touch-manipulation"
          >
            Skip for now
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
