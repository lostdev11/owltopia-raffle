'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useWallet } from '@solana/wallet-adapter-react'
import {
  ArrowLeft,
  Bot,
  Clock,
  Loader2,
  MessageSquare,
  Pencil,
  Plus,
  Send,
  Trash2,
} from 'lucide-react'

import { WalletConnectButton } from '@/components/WalletConnectButton'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { getCachedAdmin, setCachedAdmin } from '@/lib/admin-check-cache'
import {
  computeNextRecurringRunUtc,
  formatDateTimeInTimezone,
  getDefaultBrowserTimezone,
  ISO_WEEKDAY_LABELS,
} from '@/lib/discord-broadcast/timezone'
import type {
  DiscordBroadcastScheduleWithTemplate,
  DiscordBroadcastSendLog,
  DiscordBroadcastTemplate,
} from '@/lib/db/discord-broadcast'

const textareaClass =
  'flex min-h-[88px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50'

function formatScheduleSummary(
  schedule: DiscordBroadcastScheduleWithTemplate,
  viewerTz: string
): string {
  if (schedule.schedule_type === 'once' && schedule.once_at) {
    const inScheduleTz = formatDateTimeInTimezone(schedule.once_at, schedule.timezone, {
      includeTimezoneLabel: true,
    })
    const inViewerTz = formatDateTimeInTimezone(schedule.once_at, viewerTz)
    return `Once: ${inScheduleTz} · Your time: ${inViewerTz}`
  }

  if (schedule.local_hour != null && schedule.local_minute != null) {
    const pad = (n: number) => String(n).padStart(2, '0')
    const timeLabel = `${pad(schedule.local_hour)}:${pad(schedule.local_minute)}`
    const days =
      schedule.days_of_week
        ?.map((d) => ISO_WEEKDAY_LABELS.find((x) => x.value === d)?.label ?? String(d))
        .join(', ') ?? 'Every day'
    const next = computeNextRecurringRunUtc(
      {
        timezone: schedule.timezone,
        local_hour: schedule.local_hour,
        local_minute: schedule.local_minute,
        days_of_week: schedule.days_of_week,
      },
      new Date()
    )
    const nextLine = next
      ? `Next: ${formatDateTimeInTimezone(next, viewerTz)} (your time)`
      : 'Next: —'
    return `Daily at ${timeLabel} (${schedule.timezone}) · ${days} · ${nextLine}`
  }

  return schedule.schedule_type
}

export default function AdminDiscordBroadcastPage() {
  const router = useRouter()
  const { publicKey, connected } = useWallet()
  const wallet = publicKey?.toBase58() ?? ''
  const cachedTrue = typeof window !== 'undefined' && wallet && getCachedAdmin(wallet) === true
  const [isAdmin, setIsAdmin] = useState<boolean | null>(() => (cachedTrue ? true : null))
  const [loading, setLoading] = useState(() => !cachedTrue)
  const [viewerTz, setViewerTz] = useState('UTC')

  const [configured, setConfigured] = useState(false)
  const [templates, setTemplates] = useState<DiscordBroadcastTemplate[]>([])
  const [schedules, setSchedules] = useState<DiscordBroadcastScheduleWithTemplate[]>([])
  const [logs, setLogs] = useState<DiscordBroadcastSendLog[]>([])
  const [loadingData, setLoadingData] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [templateForm, setTemplateForm] = useState({ name: '', body: '' })
  const [editingTemplate, setEditingTemplate] = useState<DiscordBroadcastTemplate | null>(null)
  const [editTemplateForm, setEditTemplateForm] = useState({ name: '', body: '' })

  const [scheduleForm, setScheduleForm] = useState({
    template_id: '',
    label: '',
    post_to_public: true,
    post_to_holder: false,
    schedule_type: 'recurring' as 'once' | 'recurring',
    timezone: '',
    once_date: '',
    once_time: '09:00',
    recurring_time: '09:00',
    days_of_week: [1, 2, 3, 4, 5, 6, 7] as number[],
    posts_per_day: 1,
    active: true,
    snooze_until_date: '',
    snooze_until_time: '',
  })

  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewBody, setPreviewBody] = useState('')
  const [previewTemplateId, setPreviewTemplateId] = useState<string | null>(null)
  const [previewPublic, setPreviewPublic] = useState(true)
  const [previewHolder, setPreviewHolder] = useState(false)
  const [sending, setSending] = useState(false)

  useEffect(() => {
    setViewerTz(getDefaultBrowserTimezone())
    setScheduleForm((f) => (f.timezone ? f : { ...f, timezone: getDefaultBrowserTimezone() }))
  }, [])

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
        setCachedAdmin(addr, admin, admin && data?.role ? data.role : null)
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

  const fetchData = useCallback(async () => {
    if (!wallet) return
    setLoadingData(true)
    try {
      const res = await fetch('/api/admin/discord-broadcast', {
        headers: { authorization: `Bearer ${wallet}` },
      })
      if (res.ok) {
        const data = await res.json()
        setConfigured(Boolean(data.configured))
        setTemplates(Array.isArray(data.templates) ? data.templates : [])
        setSchedules(Array.isArray(data.schedules) ? data.schedules : [])
        setLogs(Array.isArray(data.logs) ? data.logs : [])
      }
    } catch (e) {
      console.error(e)
    } finally {
      setLoadingData(false)
    }
  }, [wallet])

  useEffect(() => {
    if (isAdmin && wallet) void fetchData()
  }, [isAdmin, wallet, fetchData])

  const templateOptions = useMemo(
    () => templates.map((t) => ({ id: t.id, name: t.name })),
    [templates]
  )

  const authHeaders = useMemo(
    () => ({
      'Content-Type': 'application/json',
      authorization: `Bearer ${wallet}`,
    }),
    [wallet]
  )

  const handleCreateTemplate = async () => {
    if (!wallet || !templateForm.name.trim() || !templateForm.body.trim()) return
    setError(null)
    setSaving(true)
    try {
      const res = await fetch('/api/admin/discord-broadcast/templates', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          name: templateForm.name.trim(),
          body: templateForm.body.trim(),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof data.error === 'string' ? data.error : 'Failed to save template')
        return
      }
      setTemplateForm({ name: '', body: '' })
      await fetchData()
    } finally {
      setSaving(false)
    }
  }

  const handleUpdateTemplate = async () => {
    if (!wallet || !editingTemplate) return
    setSaving(true)
    try {
      const res = await fetch(`/api/admin/discord-broadcast/templates/${editingTemplate.id}`, {
        method: 'PATCH',
        headers: authHeaders,
        body: JSON.stringify({
          name: editTemplateForm.name.trim(),
          body: editTemplateForm.body.trim(),
        }),
      })
      if (res.ok) {
        setEditingTemplate(null)
        await fetchData()
      }
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteTemplate = async (id: string) => {
    if (!wallet || !confirm('Delete this template? Linked schedules will also be removed.')) return
    await fetch(`/api/admin/discord-broadcast/templates/${id}`, {
      method: 'DELETE',
      headers: authHeaders,
    })
    await fetchData()
  }

  const toggleScheduleDay = (day: number) => {
    setScheduleForm((f) => {
      const has = f.days_of_week.includes(day)
      const days = has ? f.days_of_week.filter((d) => d !== day) : [...f.days_of_week, day].sort()
      return { ...f, days_of_week: days }
    })
  }

  const handleCreateSchedule = async () => {
    if (!wallet || !scheduleForm.template_id) {
      setError('Pick a template for the schedule.')
      return
    }
    setError(null)
    setSaving(true)
    try {
      const payload: Record<string, unknown> = {
        template_id: scheduleForm.template_id,
        label: scheduleForm.label.trim(),
        post_to_public: scheduleForm.post_to_public,
        post_to_holder: scheduleForm.post_to_holder,
        schedule_type: scheduleForm.schedule_type,
        timezone: scheduleForm.timezone || viewerTz,
        posts_per_day: scheduleForm.posts_per_day,
        active: scheduleForm.active,
        days_of_week: scheduleForm.days_of_week,
      }
      if (scheduleForm.schedule_type === 'once') {
        payload.once_date = scheduleForm.once_date
        payload.once_time = scheduleForm.once_time
      } else {
        payload.recurring_time = scheduleForm.recurring_time
      }
      if (scheduleForm.snooze_until_date) {
        payload.snooze_until_date = scheduleForm.snooze_until_date
        payload.snooze_until_time = scheduleForm.snooze_until_time || '23:59'
      }

      const res = await fetch('/api/admin/discord-broadcast/schedules', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify(payload),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof data.error === 'string' ? data.error : 'Failed to create schedule')
        return
      }
      setScheduleForm((f) => ({
        ...f,
        label: '',
        snooze_until_date: '',
        snooze_until_time: '',
      }))
      await fetchData()
    } finally {
      setSaving(false)
    }
  }

  const handleToggleScheduleActive = async (schedule: DiscordBroadcastScheduleWithTemplate) => {
    if (!wallet) return
    await fetch(`/api/admin/discord-broadcast/schedules/${schedule.id}`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({ active: !schedule.active }),
    })
    await fetchData()
  }

  const handleClearSnooze = async (scheduleId: string) => {
    if (!wallet) return
    await fetch(`/api/admin/discord-broadcast/schedules/${scheduleId}`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({ clear_snooze: true }),
    })
    await fetchData()
  }

  const handleDeleteSchedule = async (id: string) => {
    if (!wallet || !confirm('Delete this schedule?')) return
    await fetch(`/api/admin/discord-broadcast/schedules/${id}`, {
      method: 'DELETE',
      headers: authHeaders,
    })
    await fetchData()
  }

  const openPostPreview = (template: DiscordBroadcastTemplate, holder: boolean) => {
    setPreviewTemplateId(template.id)
    setPreviewBody(template.body)
    setPreviewPublic(true)
    setPreviewHolder(holder)
    setPreviewOpen(true)
  }

  const handleConfirmSend = async () => {
    if (!wallet) return
    setSending(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/discord-broadcast/send', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          template_id: previewTemplateId,
          body: previewBody,
          post_to_public: previewPublic,
          post_to_holder: previewHolder,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof data.error === 'string' ? data.error : 'Send failed')
        return
      }
      setPreviewOpen(false)
      await fetchData()
    } finally {
      setSending(false)
    }
  }

  if (loading) {
    return (
      <div className="container mx-auto py-8 px-4">
        <p className="text-center text-muted-foreground">Checking admin status…</p>
      </div>
    )
  }

  if (!connected) {
    return (
      <div className="container mx-auto py-8 px-4">
        <Card className="max-w-lg mx-auto">
          <CardHeader>
            <CardTitle>Discord broadcast</CardTitle>
            <CardDescription>Connect your wallet to manage bot posts.</CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center">
            <WalletConnectButton />
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!isAdmin) {
    return (
      <div className="container mx-auto py-8 px-4">
        <Card className="max-w-lg mx-auto">
          <CardHeader>
            <CardTitle>Access denied</CardTitle>
            <CardDescription>Only admins can manage Discord broadcasts.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" onClick={() => router.push('/admin')}>
              Back to Owl Vision
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="container mx-auto py-8 px-4 pb-24">
      <div className="max-w-4xl mx-auto">
        <div className="mb-6 flex items-start gap-4">
          <Link
            href="/admin"
            aria-label="Back to Owl Vision"
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md hover:bg-accent"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold flex items-center gap-2">
              <Bot className="h-7 w-7" />
              Discord broadcast
            </h1>
            <p className="text-muted-foreground mt-1 text-sm sm:text-base">
              Templates and schedules for Owltopia Bot in public and holder chat. Times are shown in{' '}
              <strong>{viewerTz}</strong> on your device; schedules store your chosen timezone.
            </p>
          </div>
        </div>

        {!configured && (
          <Card className="mb-6 border-amber-500/40 bg-amber-500/5">
            <CardContent className="pt-6 text-sm">
              Set <code className="text-xs">DISCORD_BOT_TOKEN</code>,{' '}
              <code className="text-xs">DISCORD_CHANNEL_PUBLIC</code>, and/or{' '}
              <code className="text-xs">DISCORD_CHANNEL_HOLDER</code> on the server before posting.
            </CardContent>
          </Card>
        )}

        {error && (
          <p className="mb-4 text-sm text-destructive" role="alert">
            {error}
          </p>
        )}

        <Card className="mb-8">
          <CardHeader>
            <CardTitle>Add message template</CardTitle>
            <CardDescription>
              Saved copy for Discord. Supports **bold**, *italic*, and [links](url). No @mentions — posts
              blend into chat.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="tpl-name">Template name</Label>
              <Input
                id="tpl-name"
                value={templateForm.name}
                onChange={(e) => setTemplateForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Daily mint check-in"
              />
            </div>
            <div>
              <Label htmlFor="tpl-body">Message</Label>
              <textarea
                id="tpl-body"
                className={textareaClass}
                value={templateForm.body}
                onChange={(e) => setTemplateForm((f) => ({ ...f, body: e.target.value }))}
                placeholder="What Owltopia Bot should say in Discord…"
                maxLength={2000}
              />
              <p className="text-xs text-muted-foreground mt-1">{templateForm.body.length}/2000</p>
            </div>
            <Button
              onClick={() => void handleCreateTemplate()}
              disabled={saving || !templateForm.name.trim() || !templateForm.body.trim()}
              className="w-full sm:w-auto min-h-[44px]"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
              Save template
            </Button>
          </CardContent>
        </Card>

        <Card className="mb-8">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5" />
              Add schedule
            </CardTitle>
            <CardDescription>
              One-time or recurring posts. Snooze pauses until the date you pick (in your timezone below).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="sched-template">Template</Label>
              <select
                id="sched-template"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={scheduleForm.template_id}
                onChange={(e) => setScheduleForm((f) => ({ ...f, template_id: e.target.value }))}
              >
                <option value="">Select template…</option>
                {templateOptions.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="sched-label">Schedule label (optional)</Label>
              <Input
                id="sched-label"
                value={scheduleForm.label}
                onChange={(e) => setScheduleForm((f) => ({ ...f, label: e.target.value }))}
                placeholder="e.g. Weekday morning public"
              />
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-lg border p-3">
              <Label htmlFor="sched-public">Public chat</Label>
              <Switch
                id="sched-public"
                ariaLabel="Post to public chat"
                checked={scheduleForm.post_to_public}
                onCheckedChange={(v) => setScheduleForm((f) => ({ ...f, post_to_public: v }))}
              />
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-lg border p-3">
              <Label htmlFor="sched-holder">Holder chat</Label>
              <Switch
                id="sched-holder"
                ariaLabel="Post to holder chat"
                checked={scheduleForm.post_to_holder}
                onCheckedChange={(v) => setScheduleForm((f) => ({ ...f, post_to_holder: v }))}
              />
            </div>
            <div>
              <Label>Schedule type</Label>
              <div className="flex gap-2 mt-2">
                <Button
                  type="button"
                  variant={scheduleForm.schedule_type === 'recurring' ? 'default' : 'outline'}
                  className="min-h-[44px] flex-1"
                  onClick={() => setScheduleForm((f) => ({ ...f, schedule_type: 'recurring' }))}
                >
                  Recurring
                </Button>
                <Button
                  type="button"
                  variant={scheduleForm.schedule_type === 'once' ? 'default' : 'outline'}
                  className="min-h-[44px] flex-1"
                  onClick={() => setScheduleForm((f) => ({ ...f, schedule_type: 'once' }))}
                >
                  One-time
                </Button>
              </div>
            </div>
            <div>
              <Label htmlFor="sched-tz">Timezone for this schedule</Label>
              <Input
                id="sched-tz"
                value={scheduleForm.timezone}
                onChange={(e) => setScheduleForm((f) => ({ ...f, timezone: e.target.value }))}
                placeholder={viewerTz}
              />
              <p className="text-xs text-muted-foreground mt-1">
                Defaults to your device timezone ({viewerTz}). Other admins see converted times in their
                timezone.
              </p>
            </div>
            {scheduleForm.schedule_type === 'once' ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="once-date">Date</Label>
                  <Input
                    id="once-date"
                    type="date"
                    value={scheduleForm.once_date}
                    onChange={(e) => setScheduleForm((f) => ({ ...f, once_date: e.target.value }))}
                  />
                </div>
                <div>
                  <Label htmlFor="once-time">Time</Label>
                  <Input
                    id="once-time"
                    type="time"
                    value={scheduleForm.once_time}
                    onChange={(e) => setScheduleForm((f) => ({ ...f, once_time: e.target.value }))}
                  />
                </div>
              </div>
            ) : (
              <>
                <div>
                  <Label htmlFor="rec-time">Time of day</Label>
                  <Input
                    id="rec-time"
                    type="time"
                    value={scheduleForm.recurring_time}
                    onChange={(e) => setScheduleForm((f) => ({ ...f, recurring_time: e.target.value }))}
                  />
                </div>
                <div>
                  <Label>Days</Label>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {ISO_WEEKDAY_LABELS.map((d) => (
                      <Button
                        key={d.value}
                        type="button"
                        size="sm"
                        variant={scheduleForm.days_of_week.includes(d.value) ? 'default' : 'outline'}
                        className="min-h-[44px] min-w-[44px]"
                        onClick={() => toggleScheduleDay(d.value)}
                      >
                        {d.label}
                      </Button>
                    ))}
                  </div>
                </div>
                <div>
                  <Label htmlFor="posts-per-day">Max posts per day</Label>
                  <Input
                    id="posts-per-day"
                    type="number"
                    min={1}
                    max={10}
                    value={scheduleForm.posts_per_day}
                    onChange={(e) =>
                      setScheduleForm((f) => ({
                        ...f,
                        posts_per_day: Math.min(10, Math.max(1, Number(e.target.value) || 1)),
                      }))
                    }
                  />
                </div>
              </>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="snooze-date">Snooze until (optional)</Label>
                <Input
                  id="snooze-date"
                  type="date"
                  value={scheduleForm.snooze_until_date}
                  onChange={(e) => setScheduleForm((f) => ({ ...f, snooze_until_date: e.target.value }))}
                />
              </div>
              <div>
                <Label htmlFor="snooze-time">Snooze time</Label>
                <Input
                  id="snooze-time"
                  type="time"
                  value={scheduleForm.snooze_until_time}
                  onChange={(e) => setScheduleForm((f) => ({ ...f, snooze_until_time: e.target.value }))}
                />
              </div>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-lg border p-3">
              <Label htmlFor="sched-active">Active</Label>
              <Switch
                id="sched-active"
                ariaLabel="Schedule active"
                checked={scheduleForm.active}
                onCheckedChange={(v) => setScheduleForm((f) => ({ ...f, active: v }))}
              />
            </div>
            <Button
              onClick={() => void handleCreateSchedule()}
              disabled={saving || !scheduleForm.template_id}
              className="w-full sm:w-auto min-h-[44px]"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
              Add schedule
            </Button>
          </CardContent>
        </Card>

        {loadingData ? (
          <p className="text-muted-foreground text-center py-8">Loading…</p>
        ) : (
          <>
            <section className="mb-8">
              <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
                <MessageSquare className="h-5 w-5" />
                Templates ({templates.length})
              </h2>
              {templates.length === 0 ? (
                <p className="text-sm text-muted-foreground">No templates yet.</p>
              ) : (
                <ul className="space-y-3">
                  {templates.map((t) => (
                    <li key={t.id} className="rounded-lg border p-4 space-y-2">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <p className="font-medium">{t.name}</p>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            className="min-h-[44px]"
                            onClick={() => openPostPreview(t, false)}
                          >
                            <Send className="h-3.5 w-3.5 mr-1" />
                            Post now
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="min-h-[44px]"
                            onClick={() => {
                              setEditingTemplate(t)
                              setEditTemplateForm({ name: t.name, body: t.body })
                            }}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="min-h-[44px] text-destructive"
                            onClick={() => void handleDeleteTemplate(t.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                      <pre className="text-sm whitespace-pre-wrap text-muted-foreground font-sans">{t.body}</pre>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="mb-8">
              <h2 className="text-lg font-semibold mb-3">Schedules ({schedules.length})</h2>
              {schedules.length === 0 ? (
                <p className="text-sm text-muted-foreground">No schedules yet.</p>
              ) : (
                <ul className="space-y-3">
                  {schedules.map((s) => (
                    <li key={s.id} className="rounded-lg border p-4 space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-medium">{s.label || s.template?.name || 'Schedule'}</p>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            className="min-h-[44px]"
                            onClick={() => void handleToggleScheduleActive(s)}
                          >
                            {s.active ? 'Pause' : 'Resume'}
                          </Button>
                          {s.snooze_until && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="min-h-[44px]"
                              onClick={() => void handleClearSnooze(s.id)}
                            >
                              Clear snooze
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            className="min-h-[44px] text-destructive"
                            onClick={() => void handleDeleteSchedule(s.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                      <p className="text-sm text-muted-foreground">{formatScheduleSummary(s, viewerTz)}</p>
                      <p className="text-xs text-muted-foreground">
                        {s.post_to_public ? 'Public' : ''}
                        {s.post_to_public && s.post_to_holder ? ' · ' : ''}
                        {s.post_to_holder ? 'Holder' : ''}
                        {s.snooze_until
                          ? ` · Snoozed until ${formatDateTimeInTimezone(s.snooze_until, viewerTz)}`
                          : ''}
                        {s.once_completed ? ' · Completed' : ''}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section>
              <h2 className="text-lg font-semibold mb-3">Recent sends</h2>
              {logs.length === 0 ? (
                <p className="text-sm text-muted-foreground">No sends logged yet.</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {logs.slice(0, 15).map((log) => (
                    <li key={log.id} className="rounded border px-3 py-2">
                      <span
                        className={
                          log.status === 'sent'
                            ? 'text-green-600'
                            : log.status === 'partial'
                              ? 'text-amber-600'
                              : 'text-destructive'
                        }
                      >
                        {log.status}
                      </span>
                      {' · '}
                      {log.triggered_by} · {formatDateTimeInTimezone(log.created_at, viewerTz)}
                      {log.error_message ? ` — ${log.error_message}` : ''}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </div>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Preview & send</DialogTitle>
            <DialogDescription>
              This posts as Owltopia Bot with no @mentions. Confirm before sending.
            </DialogDescription>
          </DialogHeader>
          <textarea
            className={textareaClass}
            value={previewBody}
            onChange={(e) => setPreviewBody(e.target.value)}
            maxLength={2000}
          />
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <Label htmlFor="preview-public">Public chat</Label>
              <Switch
                id="preview-public"
                ariaLabel="Send to public chat"
                checked={previewPublic}
                onCheckedChange={setPreviewPublic}
              />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="preview-holder">Holder chat</Label>
              <Switch
                id="preview-holder"
                ariaLabel="Send to holder chat"
                checked={previewHolder}
                onCheckedChange={setPreviewHolder}
              />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setPreviewOpen(false)} className="min-h-[44px]">
              Cancel
            </Button>
            <Button
              onClick={() => void handleConfirmSend()}
              disabled={sending || !previewBody.trim() || (!previewPublic && !previewHolder)}
              className="min-h-[44px]"
            >
              {sending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Send to Discord
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editingTemplate} onOpenChange={(open) => !open && setEditingTemplate(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit template</DialogTitle>
          </DialogHeader>
          <Input
            value={editTemplateForm.name}
            onChange={(e) => setEditTemplateForm((f) => ({ ...f, name: e.target.value }))}
          />
          <textarea
            className={textareaClass}
            value={editTemplateForm.body}
            onChange={(e) => setEditTemplateForm((f) => ({ ...f, body: e.target.value }))}
            maxLength={2000}
          />
          <DialogFooter>
            <Button onClick={() => void handleUpdateTemplate()} disabled={saving} className="min-h-[44px]">
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
