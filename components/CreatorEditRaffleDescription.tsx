'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { descriptionContainsBlockedLinks } from '@/lib/raffle-description-links'
import { Edit, Loader2 } from 'lucide-react'

const DESCRIPTION_MAX_CHARS = 5000

type Props = {
  raffleId: string
  description: string | null
  /** Admin wallets may include links; non-admins cannot. */
  allowLinks: boolean
  onSaved?: (description: string | null) => void
}

function clearEditDescriptionQuery() {
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  if (!url.searchParams.has('editDescription')) return
  url.searchParams.delete('editDescription')
  const next = `${url.pathname}${url.search}${url.hash}`
  window.history.replaceState(window.history.state, '', next)
}

/**
 * Creator/admin description editor (mobile-friendly dialog).
 * Open via button or `?editDescription=1` from My Raffles.
 */
export function CreatorEditRaffleDescription({
  raffleId,
  description,
  allowLinks,
  onSaved,
}: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(description ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const openEditor = useCallback(() => {
    setDraft(description ?? '')
    setError(null)
    setOpen(true)
  }, [description])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    if (params.get('editDescription') === '1') {
      openEditor()
    }
  }, [openEditor])

  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    if (!next) {
      setError(null)
      clearEditDescriptionQuery()
    }
  }

  const handleSave = async () => {
    setError(null)
    const trimmed = draft.trim()
    if (!allowLinks && descriptionContainsBlockedLinks(trimmed)) {
      setError(
        'Descriptions cannot include links or web addresses. Remove URLs, typed domains (like example.com), IPs, Discord/Telegram invites, and markdown-style links.'
      )
      return
    }
    if (trimmed.length > DESCRIPTION_MAX_CHARS) {
      setError(`Description must be at most ${DESCRIPTION_MAX_CHARS} characters`)
      return
    }

    setSaving(true)
    try {
      const res = await fetch(`/api/raffles/${raffleId}/description`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ description: trimmed.length > 0 ? trimmed : null }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(
          typeof data?.error === 'string'
            ? data.error
            : 'Could not save. Sign in with the creator or an admin wallet, then try again.'
        )
      }
      const next =
        data && typeof data.description === 'string'
          ? data.description
          : trimmed.length > 0
            ? trimmed
            : null
      onSaved?.(next)
      setOpen(false)
      clearEditDescriptionQuery()
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save description')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={openEditor}
        className="touch-manipulation min-h-[44px] mt-2"
      >
        <Edit className="mr-2 h-4 w-4 shrink-0" aria-hidden />
        Edit description
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-lg max-h-[min(90dvh,36rem)] overflow-y-auto touch-manipulation">
          <DialogHeader>
            <DialogTitle>Edit description</DialogTitle>
            <DialogDescription>
              Update the raffle copy buyers see. Price, tickets, and prize stay unchanged.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2 py-2">
            <Label htmlFor="creator-edit-description">Description</Label>
            {!allowLinks && (
              <p className="text-xs text-muted-foreground">
                No links or web addresses (URLs, domains, IPs, Discord/Telegram invites).
              </p>
            )}
            <textarea
              id="creator-edit-description"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={8}
              maxLength={DESCRIPTION_MAX_CHARS}
              disabled={saving}
              className="flex min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 touch-manipulation"
              placeholder="Describe your raffle…"
            />
            <p className="text-xs text-muted-foreground text-right">
              {draft.trim().length}/{DESCRIPTION_MAX_CHARS}
            </p>
            {error && (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            )}
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="ghost"
              onClick={() => handleOpenChange(false)}
              disabled={saving}
              className="touch-manipulation min-h-[44px]"
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving}
              className="touch-manipulation min-h-[44px]"
            >
              {saving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                  Saving…
                </>
              ) : (
                'Save description'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
