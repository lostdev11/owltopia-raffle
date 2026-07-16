'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import { ImagePlus, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  PARTNER_PRO_STANDARD_MONTHLY_USD,
  PARTNER_PRO_SETUP_USD,
  PARTNER_PRO_GRANDFATHER_MONTHLY_USD,
} from '@/lib/config/partner-program-pricing'

type TierOption = {
  id: '$0_partner' | 'partner_pro' | 'white_label'
  label: string
}

const TIERS: TierOption[] = [
  { id: '$0_partner', label: '$0 Partner (2% fee + Discord support)' },
  {
    id: 'partner_pro',
    label: `Partner Pro ($${PARTNER_PRO_SETUP_USD} setup + $${PARTNER_PRO_STANDARD_MONTHLY_USD}/mo)`,
  },
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
    logo_url: '',
  })
  const logoInputRef = useRef<HTMLInputElement>(null)
  const [logoUploading, setLogoUploading] = useState(false)
  const [logoError, setLogoError] = useState<string | null>(null)

  const uploadLogo = async (file: File) => {
    setLogoUploading(true)
    setLogoError(null)
    try {
      const data = new FormData()
      data.append('image', file)
      const res = await fetch('/api/partner-program/logo', { method: 'POST', body: data })
      const json = (await res.json().catch(() => ({}))) as { url?: string; error?: string }
      if (!res.ok || !json.url) {
        setLogoError(typeof json.error === 'string' ? json.error : 'Could not upload logo.')
        return
      }
      setForm((s) => ({ ...s, logo_url: json.url as string }))
    } catch {
      setLogoError('Could not upload logo.')
    } finally {
      setLogoUploading(false)
      if (logoInputRef.current) logoInputRef.current.value = ''
    }
  }

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
        logo_url: '',
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
          {form.interested_tier === 'partner_pro' ? (
            <p className="text-xs leading-relaxed text-muted-foreground">
              Partner Pro can add your project&apos;s SPL mint as a <strong className="text-foreground/90">ticket</strong>{' '}
              payment option on <strong className="text-foreground/90">your</strong> raffles only (allowlisted creator
              wallet; not shown to other hosts). Mention the mint, symbol, and decimals in Notes if you want that scoped in
              onboarding.{' '}
              <strong className="text-foreground/90">Pricing:</strong> new Partner Pro is $
              {PARTNER_PRO_STANDARD_MONTHLY_USD}/mo after the one-time $
              {PARTNER_PRO_SETUP_USD} setup; partners already on the program (including $0 Partner upgrades) typically
              keep $
              {PARTNER_PRO_GRANDFATHER_MONTHLY_USD}/mo — we confirm in onboarding. Details on the{' '}
              <Link href="/partner-program" className="font-medium text-primary underline-offset-2 hover:underline">
                partner program
              </Link>{' '}
              page.
            </p>
          ) : null}
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="partner-logo">Community logo (optional)</Label>
          <div className="flex items-start gap-3">
            {form.logo_url ? (
              <div className="h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-border/70 bg-muted">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={form.logo_url} alt="Community logo preview" className="h-full w-full object-contain" />
              </div>
            ) : (
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg border border-dashed border-border/70 bg-muted/50 text-muted-foreground">
                <ImagePlus className="h-5 w-5" aria-hidden />
              </div>
            )}
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <label className="inline-flex min-h-[44px] cursor-pointer touch-manipulation items-center justify-center gap-2 rounded-md border border-input bg-background px-4 text-sm font-medium hover:bg-accent has-[:disabled]:pointer-events-none has-[:disabled]:opacity-50">
                  <input
                    ref={logoInputRef}
                    id="partner-logo"
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif,image/avif,image/heic"
                    className="sr-only"
                    disabled={logoUploading}
                    onChange={(e) => {
                      const f = e.target.files?.[0]
                      if (f) void uploadLogo(f)
                    }}
                  />
                  {logoUploading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                      Uploading…
                    </>
                  ) : (
                    <>
                      <ImagePlus className="h-4 w-4" aria-hidden />
                      Upload logo
                    </>
                  )}
                </label>
                {form.logo_url ? (
                  <button
                    type="button"
                    className="min-h-[44px] touch-manipulation px-2 text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => setForm((s) => ({ ...s, logo_url: '' }))}
                  >
                    Remove
                  </button>
                ) : null}
              </div>
              <p className="text-xs text-muted-foreground">
                Square PNG/JPG/WebP up to 5MB. If approved, this is the logo we feature in the Partner Spotlight.
              </p>
              {logoError ? <p className="text-xs text-destructive">{logoError}</p> : null}
            </div>
          </div>
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
      <Button
        type="submit"
        disabled={loading || logoUploading}
        className="mt-4 min-h-[44px] w-full touch-manipulation sm:w-auto"
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Submit partner application'}
      </Button>
    </form>
  )
}
