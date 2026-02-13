'use client'

import { useState, useEffect, useCallback } from 'react'
import { useWallet } from '@solana/wallet-adapter-react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { WalletConnectButton } from '@/components/WalletConnectButton'
import { getCachedAdmin, setCachedAdmin } from '@/lib/admin-check-cache'
import { Megaphone, Plus, Pencil, Trash2, Loader2, ArrowLeft } from 'lucide-react'

interface Announcement {
  id: string
  title: string
  body: string | null
  show_on_hero: boolean
  show_on_raffles: boolean
  mark_as_new: boolean
  active: boolean
  sort_order: number
  created_at: string
  updated_at: string
}

export default function AdminAnnouncementsPage() {
  const router = useRouter()
  const { publicKey, connected } = useWallet()
  const wallet = publicKey?.toBase58() ?? ''
  const cachedTrue = typeof window !== 'undefined' && wallet && getCachedAdmin(wallet) === true
  const [isAdmin, setIsAdmin] = useState<boolean | null>(() => (cachedTrue ? true : null))
  const [loading, setLoading] = useState(() => !cachedTrue)
  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [loadingList, setLoadingList] = useState(true)
  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [form, setForm] = useState({
    title: '',
    body: '',
    show_on_hero: true,
    show_on_raffles: true,
    mark_as_new: false,
    active: true,
    sort_order: 0,
  })
  const [editForm, setEditForm] = useState({
    title: '',
    body: '',
    show_on_hero: true,
    show_on_raffles: true,
    mark_as_new: false,
    active: true,
    sort_order: 0,
  })

  useEffect(() => {
    if (!connected || !publicKey) {
      setIsAdmin(false)
      setLoading(false)
      return
    }
    const addr = publicKey.toBase58()
    if (getCachedAdmin(addr) === true) {
      setIsAdmin(true)
      setLoading(false)
      return
    }
    setLoading(true)
    let cancelled = false
    fetch(`/api/admin/check?wallet=${addr}`)
      .then((res) => (cancelled ? undefined : res.ok ? res.json() : undefined))
      .then((data) => {
        if (cancelled) return
        const admin = data?.isAdmin === true
        setCachedAdmin(addr, admin)
        setIsAdmin(admin)
      })
      .catch(() => {
        if (!cancelled) setIsAdmin(false)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [connected, publicKey])

  const fetchAnnouncements = useCallback(async () => {
    if (!wallet) return
    setLoadingList(true)
    try {
      const res = await fetch('/api/admin/announcements', {
        headers: { authorization: `Bearer ${wallet}` },
      })
      if (res.ok) {
        const data = await res.json()
        setAnnouncements(Array.isArray(data) ? data : [])
      }
    } catch (e) {
      console.error(e)
    } finally {
      setLoadingList(false)
    }
  }, [wallet])

  useEffect(() => {
    if (isAdmin && wallet) fetchAnnouncements()
  }, [isAdmin, wallet, fetchAnnouncements])

  const openEdit = (a: Announcement) => {
    setEditingId(a.id)
    setEditForm({
      title: a.title,
      body: a.body ?? '',
      show_on_hero: a.show_on_hero,
      show_on_raffles: a.show_on_raffles,
      mark_as_new: a.mark_as_new ?? false,
      active: a.active,
      sort_order: a.sort_order,
    })
  }

  const closeEdit = () => {
    setEditingId(null)
  }

  const handleCreate = async () => {
    if (!wallet || !form.title.trim()) return
    setCreateError(null)
    setSaving(true)
    try {
      const res = await fetch('/api/admin/announcements', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          authorization: `Bearer ${wallet}`,
        },
        body: JSON.stringify({
          title: form.title.trim(),
          body: form.body.trim() || null,
          show_on_hero: form.show_on_hero,
          show_on_raffles: form.show_on_raffles,
          mark_as_new: form.mark_as_new,
          active: form.active,
          sort_order: form.sort_order,
        }),
      })
      if (res.ok) {
        await fetchAnnouncements()
        setForm({ title: '', body: '', show_on_hero: true, show_on_raffles: true, mark_as_new: false, active: true, sort_order: 0 })
      } else {
        const data = await res.json().catch(() => ({}))
        setCreateError(typeof data?.error === 'string' ? data.error : res.statusText || 'Failed to create')
      }
    } finally {
      setSaving(false)
    }
  }

  const handleUpdate = async () => {
    if (!wallet || !editingId) return
    setSaving(true)
    try {
      const res = await fetch(`/api/admin/announcements/${editingId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          authorization: `Bearer ${wallet}`,
        },
        body: JSON.stringify({
          title: editForm.title.trim(),
          body: editForm.body.trim() || null,
          show_on_hero: editForm.show_on_hero,
          show_on_raffles: editForm.show_on_raffles,
          mark_as_new: editForm.mark_as_new,
          active: editForm.active,
          sort_order: editForm.sort_order,
        }),
      })
      if (res.ok) {
        await fetchAnnouncements()
        closeEdit()
      }
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!wallet) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/admin/announcements/${id}`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${wallet}` },
      })
      if (res.ok) {
        setDeleteConfirmId(null)
        await fetchAnnouncements()
      }
    } finally {
      setDeleting(false)
    }
  }

  if (loading) {
    return (
      <div className="container mx-auto py-8 px-4">
        <div className="max-w-4xl mx-auto">
          <Card>
            <CardContent className="pt-6">
              <p className="text-center text-muted-foreground">Checking admin status...</p>
            </CardContent>
          </Card>
        </div>
      </div>
    )
  }

  if (!connected) {
    return (
      <div className="container mx-auto py-8 px-4">
        <div className="max-w-4xl mx-auto">
          <Card>
            <CardHeader>
              <CardTitle>Owl Vision – Announcements</CardTitle>
              <CardDescription>Connect your wallet to manage announcements</CardDescription>
            </CardHeader>
            <CardContent className="flex justify-center">
              <WalletConnectButton />
            </CardContent>
          </Card>
        </div>
      </div>
    )
  }

  if (!isAdmin) {
    return (
      <div className="container mx-auto py-8 px-4">
        <div className="max-w-4xl mx-auto">
          <Card>
            <CardHeader>
              <CardTitle>Access Denied</CardTitle>
              <CardDescription>Only admins can manage announcements.</CardDescription>
            </CardHeader>
            <CardContent>
              <Button onClick={() => router.push('/admin')} variant="outline">
                Back to Owl Vision
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    )
  }

  return (
    <div className="container mx-auto py-8 px-4">
      <div className="max-w-4xl mx-auto">
        <div className="mb-6 flex items-center gap-4">
          <Link
            href="/admin"
            aria-label="Back to Owl Vision"
            className="inline-flex h-10 w-10 items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-2">
              <Megaphone className="h-8 w-8" />
              Announcements
            </h1>
            <p className="text-muted-foreground mt-1">
              These show on the landing (hero) and raffles page in the spots you chose.
            </p>
          </div>
        </div>

        <Card className="mb-8">
          <CardHeader>
            <CardTitle>Add announcement</CardTitle>
            <CardDescription>Title and body support markdown (**bold**, *italic*, [links](url)). Choose where it appears.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="new-title">Title</Label>
              <Input
                id="new-title"
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="e.g. New raffle every Friday"
              />
            </div>
            <div>
              <Label htmlFor="new-body">Body (optional)</Label>
              <p className="text-xs text-muted-foreground mb-1">
                Markdown supported: **bold**, *italic*, [link text](url)
              </p>
              <textarea
                id="new-body"
                className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                value={form.body}
                onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
                placeholder="Short description or link..."
              />
            </div>
            <div className="flex flex-wrap gap-6">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.show_on_hero}
                  onChange={(e) => setForm((f) => ({ ...f, show_on_hero: e.target.checked }))}
                  className="rounded border-input"
                />
                <span className="text-sm">Show on landing (hero)</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.show_on_raffles}
                  onChange={(e) => setForm((f) => ({ ...f, show_on_raffles: e.target.checked }))}
                  className="rounded border-input"
                />
                <span className="text-sm">Show on raffles page &amp; Announcements tab</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.mark_as_new}
                  onChange={(e) => setForm((f) => ({ ...f, mark_as_new: e.target.checked }))}
                  className="rounded border-input"
                />
                <span className="text-sm">Mark as new (show notification icon on tab)</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.active}
                  onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))}
                  className="rounded border-input"
                />
                <span className="text-sm">Active</span>
              </label>
            </div>
            {createError && (
              <p className="text-sm text-destructive mb-2">{createError}</p>
            )}
            <Button onClick={handleCreate} disabled={!form.title.trim() || saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              <span className="ml-2">Add announcement</span>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>All announcements</CardTitle>
            <CardDescription>Edit or delete. Inactive announcements are hidden from the site.</CardDescription>
          </CardHeader>
          <CardContent>
            {loadingList ? (
              <p className="text-center text-muted-foreground py-6">Loading...</p>
            ) : announcements.length === 0 ? (
              <p className="text-center text-muted-foreground py-6">No announcements yet. Add one above.</p>
            ) : (
              <ul className="space-y-4">
                {announcements.map((a) => (
                  <li
                    key={a.id}
                    className="flex flex-wrap items-start justify-between gap-4 rounded-lg border p-4 bg-card"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{a.title}</p>
                      {a.body && <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{a.body}</p>}
                      <div className="flex flex-wrap gap-2 mt-2">
                        {a.show_on_hero && (
                          <span className="text-xs px-2 py-0.5 rounded bg-primary/20 text-primary">Landing</span>
                        )}
                        {a.show_on_raffles && (
                          <span className="text-xs px-2 py-0.5 rounded bg-primary/20 text-primary">Raffles</span>
                        )}
                        {a.mark_as_new && (
                          <span className="text-xs px-2 py-0.5 rounded bg-amber-500/20 text-amber-600 dark:text-amber-400">New</span>
                        )}
                        {!a.active && (
                          <span className="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground">Inactive</span>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <Button variant="outline" size="sm" onClick={() => openEdit(a)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() => setDeleteConfirmId(a.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Edit dialog */}
      <Dialog open={!!editingId} onOpenChange={(open) => !open && closeEdit()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit announcement</DialogTitle>
            <DialogDescription>Update title, body, and where it appears.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label>Title</Label>
              <Input
                value={editForm.title}
                onChange={(e) => setEditForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="Title"
              />
            </div>
            <div>
              <Label>Body (optional)</Label>
              <p className="text-xs text-muted-foreground mb-1">
                Markdown: **bold**, *italic*, [link](url)
              </p>
              <textarea
                className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                value={editForm.body}
                onChange={(e) => setEditForm((f) => ({ ...f, body: e.target.value }))}
                placeholder="Body"
              />
            </div>
            <div className="flex flex-wrap gap-6">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={editForm.show_on_hero}
                  onChange={(e) => setEditForm((f) => ({ ...f, show_on_hero: e.target.checked }))}
                  className="rounded border-input"
                />
                <span className="text-sm">Show on landing</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={editForm.show_on_raffles}
                  onChange={(e) => setEditForm((f) => ({ ...f, show_on_raffles: e.target.checked }))}
                  className="rounded border-input"
                />
                <span className="text-sm">Show on raffles page &amp; Announcements tab</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={editForm.mark_as_new}
                  onChange={(e) => setEditForm((f) => ({ ...f, mark_as_new: e.target.checked }))}
                  className="rounded border-input"
                />
                <span className="text-sm">Mark as new (show notification icon on tab)</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={editForm.active}
                  onChange={(e) => setEditForm((f) => ({ ...f, active: e.target.checked }))}
                  className="rounded border-input"
                />
                <span className="text-sm">Active</span>
              </label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeEdit}>
              Cancel
            </Button>
            <Button onClick={handleUpdate} disabled={!editForm.title.trim() || saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <Dialog open={!!deleteConfirmId} onOpenChange={(open) => !open && setDeleteConfirmId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete announcement?</DialogTitle>
            <DialogDescription>This cannot be undone.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirmId(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteConfirmId && handleDelete(deleteConfirmId)}
              disabled={deleting}
            >
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
