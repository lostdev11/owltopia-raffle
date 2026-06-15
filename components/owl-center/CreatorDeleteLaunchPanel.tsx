'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { CommandCard } from '@/components/owl-center/CommandCard'
import { CommandCardSection } from '@/components/owl-center/CommandCardSection'
import { DeployButton } from '@/components/owl-center/DeployButton'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { creatorLaunchDeleteApiPath } from '@/lib/owl-center/creator-api-paths'

type Props = {
  launchId: string
  launchName: string
  /** When set, redirect here after successful delete (e.g. mint-details → list). */
  redirectAfterDelete?: string
  /** Called after successful delete (e.g. refresh My Launches list). */
  onDeleted?: () => void
  compact?: boolean
  /** Inline button row on list cards. */
  embedded?: boolean
}

export function CreatorDeleteLaunchPanel({
  launchId,
  launchName,
  redirectAfterDelete,
  onDeleted,
  compact = false,
  embedded = false,
}: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [confirmName, setConfirmName] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function handleDelete() {
    setBusy(true)
    setErr(null)
    try {
      const res = await fetch(creatorLaunchDeleteApiPath(launchId), {
        method: 'DELETE',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm_name: confirmName }),
      })
      const j = (await res.json()) as { error?: string }
      if (!res.ok) throw new Error(j.error || 'delete_failed')
      setOpen(false)
      setConfirmName('')
      onDeleted?.()
      if (redirectAfterDelete) {
        router.push(redirectAfterDelete)
      }
      router.refresh()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'delete_failed')
    } finally {
      setBusy(false)
    }
  }

  const canSubmit = confirmName.trim() === launchName.trim() && !busy

  if (compact) {
    return (
      <>
        <DeployButton
          type="button"
          variant="ghost"
          className="w-full border-red-500/25 text-red-200/90 hover:border-red-500/40 hover:bg-red-500/10 sm:w-auto"
          onClick={() => {
            setErr(null)
            setConfirmName('')
            setOpen(true)
          }}
        >
          Delete submission
        </DeployButton>

        <DeleteDialog
          open={open}
          onOpenChange={setOpen}
          launchName={launchName}
          confirmName={confirmName}
          onConfirmNameChange={setConfirmName}
          busy={busy}
          err={err}
          canSubmit={canSubmit}
          onDelete={() => void handleDelete()}
        />
      </>
    )
  }

  const deleteBody = (
    <>
      <p className="font-mono text-sm leading-relaxed text-[#9BA8B4]">
        Remove this collection before it goes public and before any mints. This permanently deletes your Owl Center
        submission and related prep data. Your Owl Generator project (if any) is not deleted.
      </p>
      <DeployButton
        type="button"
        className="mt-4 w-full border-red-500/40 bg-red-500/10 text-red-200 shadow-none hover:bg-red-500/18 sm:w-auto"
        onClick={() => {
          setErr(null)
          setConfirmName('')
          setOpen(true)
        }}
      >
        Delete collection
      </DeployButton>
    </>
  )

  if (embedded) {
    return (
      <>
        <CommandCardSection label="DELETE SUBMISSION">{deleteBody}</CommandCardSection>
        <DeleteDialog
          open={open}
          onOpenChange={setOpen}
          launchName={launchName}
          confirmName={confirmName}
          onConfirmNameChange={setConfirmName}
          busy={busy}
          err={err}
          canSubmit={canSubmit}
          onDelete={() => void handleDelete()}
        />
      </>
    )
  }

  return (
    <CommandCard label="DELETE SUBMISSION">
      <div className="space-y-4">{deleteBody}</div>

      <DeleteDialog
        open={open}
        onOpenChange={setOpen}
        launchName={launchName}
        confirmName={confirmName}
        onConfirmNameChange={setConfirmName}
        busy={busy}
        err={err}
        canSubmit={canSubmit}
        onDelete={() => void handleDelete()}
      />
    </CommandCard>
  )
}

function DeleteDialog({
  open,
  onOpenChange,
  launchName,
  confirmName,
  onConfirmNameChange,
  busy,
  err,
  canSubmit,
  onDelete,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  launchName: string
  confirmName: string
  onConfirmNameChange: (value: string) => void
  busy: boolean
  err: string | null
  canSubmit: boolean
  onDelete: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-[#1A222B] bg-[#0F1419] text-[#E8EEF2] sm:max-w-md [&>button]:text-[#9BA8B4] [&>button]:hover:text-[#E8EEF2]">
        <DialogHeader className="text-left">
          <DialogTitle className="text-lg text-[#E8EEF2]">Delete collection?</DialogTitle>
          <DialogDescription className="text-sm leading-relaxed text-[#9BA8B4]">
            This cannot be undone. Type{' '}
            <span className="font-mono text-[#E8EEF2]">{launchName}</span> to confirm.
          </DialogDescription>
        </DialogHeader>
        <label className="block space-y-2">
          <span className="font-mono text-xs uppercase tracking-wide text-[#5C6773]">Collection name</span>
          <input
            type="text"
            value={confirmName}
            onChange={(e) => onConfirmNameChange(e.target.value)}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            className="min-h-[44px] w-full touch-manipulation border border-[#1A222B] bg-[#0A0E12] px-3 font-mono text-sm text-[#E8EEF2] outline-none focus:border-red-500/40"
            placeholder={launchName}
          />
        </label>
        {err ? <p className="font-mono text-sm text-[#FF9C9C]">{err}</p> : null}
        <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-end">
          <DeployButton
            variant="ghost"
            className="w-full sm:w-auto"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </DeployButton>
          <DeployButton
            className="w-full border-red-500/40 bg-red-500/10 text-red-200 shadow-none hover:bg-red-500/18 sm:w-auto"
            disabled={!canSubmit}
            onClick={onDelete}
          >
            {busy ? 'Deleting…' : 'Delete permanently'}
          </DeployButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
