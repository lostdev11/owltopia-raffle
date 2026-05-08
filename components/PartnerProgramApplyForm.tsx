'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type TierOption = {
  id: '$0_partner' | 'partner_pro' | 'white_label'
  label: string
}

const TIERS: TierOption[] = [
  { id: '$0_partner', label: '$0 Partner (2% fee + Discord support)' },
  { id: 'partner_pro', label: 'Partner Pro ($100 setup + $20/mo)' },
  { id: 'white_label', label: 'White-label (custom quote)' },
]

export function PartnerProgramApplyForm() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState(false)
  const [form, setForm] = useState({
    project_name: '',
    contact_name: '',
    contact_handle: '',
    wallet_address: '',
    interested_tier: '$0_partner',
    details: '',
  })

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setOk(false)
    setLoading(true)
    try {
      const res = await fetch('/api/partner-program/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const json = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        setError(typeof json.error === 'string' ? json.error : 'Could not submit application.')
        return
      }
      setOk(true)
      setForm({
        project_name: '',
        contact_name: '',
        contact_handle: '',
        wallet_address: '',
        interested_tier: '$0_partner',
        details: '',
      })
    } catch {
      setError('Could not submit application.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={submit} className="not-prose rounded-lg border border-border/70 bg-background/70 p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="partner-project-name">Project name</Label>
          <Input
            id="partner-project-name"
            value={form.project_name}
            onChange={(e) => setForm((s) => ({ ...s, project_name: e.target.value }))}
            required
            maxLength={120}
            className="min-h-[44px] touch-manipulation"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="partner-contact-name">Contact name (optional)</Label>
          <Input
            id="partner-contact-name"
            value={form.contact_name}
            onChange={(e) => setForm((s) => ({ ...s, contact_name: e.target.value }))}
            maxLength={120}
            className="min-h-[44px] touch-manipulation"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="partner-contact-handle">Discord/Telegram handle</Label>
          <Input
            id="partner-contact-handle"
            value={form.contact_handle}
            onChange={(e) => setForm((s) => ({ ...s, contact_handle: e.target.value }))}
            required
            maxLength={120}
            className="min-h-[44px] touch-manipulation"
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="partner-wallet">Creator wallet</Label>
          <Input
            id="partner-wallet"
            value={form.wallet_address}
            onChange={(e) => setForm((s) => ({ ...s, wallet_address: e.target.value }))}
            required
            className="min-h-[44px] touch-manipulation font-mono text-xs sm:text-sm"
            autoComplete="off"
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="partner-tier">Interested tier</Label>
          <select
            id="partner-tier"
            value={form.interested_tier}
            onChange={(e) => setForm((s) => ({ ...s, interested_tier: e.target.value }))}
            className="flex min-h-[44px] w-full touch-manipulation rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            {TIERS.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="partner-details">Notes (optional)</Label>
          <textarea
            id="partner-details"
            value={form.details}
            onChange={(e) => setForm((s) => ({ ...s, details: e.target.value }))}
            maxLength={2000}
            className="min-h-[90px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            placeholder="Community size, timeline, custom asks..."
          />
        </div>
      </div>
      {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}
      {ok ? <p className="mt-3 text-sm text-green-400">Application received. We will follow up in Discord.</p> : null}
      <Button type="submit" disabled={loading} className="mt-4 min-h-[44px] w-full touch-manipulation sm:w-auto">
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Submit partner application'}
      </Button>
    </form>
  )
}
