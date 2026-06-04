'use client'

import { useCallback, useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Loader2, Download } from 'lucide-react'
import type { AdminReferralPerformancePayload } from '@/lib/db/admin-referral-performance'
import type { ReferralRewardSettingsRow } from '@/lib/db/referral-rewards'

type SettingsResponse = {
  settings: ReferralRewardSettingsRow
  env_kill_switch?: {
    attributionDisabled: boolean
    growthDisabled: boolean
  }
}

export function AdminReferralPerformanceSection() {
  const [data, setData] = useState<AdminReferralPerformancePayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [settings, setSettings] = useState<ReferralRewardSettingsRow | null>(null)
  const [settingsLoading, setSettingsLoading] = useState(true)
  const [settingsSaving, setSettingsSaving] = useState(false)
  const [envKillSwitch, setEnvKillSwitch] = useState<{ attributionDisabled: boolean; growthDisabled: boolean } | null>(
    null
  )
  const [settingsError, setSettingsError] = useState<string | null>(null)

  const loadPerformance = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/referral-performance', {
        credentials: 'include',
        cache: 'no-store',
      })
      if (res.ok) setData((await res.json()) as AdminReferralPerformancePayload)
    } finally {
      setLoading(false)
    }
  }, [])

  const loadSettings = useCallback(async () => {
    setSettingsLoading(true)
    setSettingsError(null)
    try {
      const res = await fetch('/api/admin/referral-reward-settings', {
        credentials: 'include',
        cache: 'no-store',
      })
      const json = (await res.json().catch(() => ({}))) as SettingsResponse & { error?: string }
      if (!res.ok) {
        setSettingsError(typeof json.error === 'string' ? json.error : 'Could not load referral settings')
        return
      }
      setSettings(json.settings)
      setEnvKillSwitch(json.env_kill_switch ?? null)
    } finally {
      setSettingsLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadPerformance()
    void loadSettings()
  }, [loadPerformance, loadSettings])

  const patchProgramEnabled = useCallback(async (next: boolean) => {
    setSettingsSaving(true)
    setSettingsError(null)
    try {
      const res = await fetch('/api/admin/referral-reward-settings', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ program_enabled: next }),
      })
      const json = (await res.json().catch(() => ({}))) as SettingsResponse & { error?: string }
      if (!res.ok) {
        setSettingsError(typeof json.error === 'string' ? json.error : 'Could not update referral program')
        return
      }
      setSettings(json.settings)
      setEnvKillSwitch(json.env_kill_switch ?? null)
    } finally {
      setSettingsSaving(false)
    }
  }, [])

  const envBlocked =
    envKillSwitch?.attributionDisabled === true || envKillSwitch?.growthDisabled === true
  const programEnabled = settings?.program_enabled !== false
  const effectivelyLive = programEnabled && !envBlocked

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Referral program</CardTitle>
          <CardDescription>
            Turn referral links, attribution, rewards, and dashboard referral UI on or off without redeploying. Env kill
            switches still override this toggle.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {envBlocked ? (
            <div className="rounded-lg border border-destructive/35 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <span className="font-medium">Env kill switch is on.</span>{' '}
              <span className="text-destructive/95">
                {envKillSwitch?.attributionDisabled ? 'REFERRAL_ATTRIBUTION_ENABLED=false' : null}
                {envKillSwitch?.attributionDisabled && envKillSwitch?.growthDisabled ? ' · ' : null}
                {envKillSwitch?.growthDisabled ? 'REFERRAL_GROWTH_PROGRAM_ENABLED=false' : null}
              </span>
            </div>
          ) : null}

          <div className="flex flex-col gap-3 touch-manipulation sm:flex-row sm:items-start sm:justify-between sm:gap-4">
            <div className="min-w-0 space-y-1">
              <p className="text-sm font-medium">
                {effectivelyLive
                  ? 'On — referrals active'
                  : envBlocked
                    ? 'Off — blocked by env'
                    : 'Off — paused by admin'}
              </p>
              {settings?.updated_at ? (
                <p className="text-xs text-muted-foreground">
                  Last changed {new Date(settings.updated_at).toLocaleString()}
                  {settings.updated_by_wallet ? ` · ${settings.updated_by_wallet.slice(0, 8)}…` : ''}
                </p>
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-3 min-h-[44px]">
              {settingsLoading || settingsSaving ? (
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden />
              ) : null}
              <Switch
                id="referral-program-enabled"
                ariaLabel="Turn referral program on or off"
                checked={programEnabled}
                disabled={settingsLoading || settingsSaving || settings == null}
                onCheckedChange={(v) => void patchProgramEnabled(v)}
              />
            </div>
          </div>

          {settingsError ? <p className="text-sm text-destructive">{settingsError}</p> : null}
        </CardContent>
      </Card>

      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground py-8">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading referral performance…
        </div>
      ) : !data ? null : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold">Referral Performance</h2>
            <Button type="button" variant="outline" size="sm" className="min-h-[44px] touch-manipulation" asChild>
              <a href="/api/admin/referral-performance?format=csv" download>
                <Download className="mr-2 h-4 w-4" />
                Export CSV
              </a>
            </Button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader className="pb-1">
                <CardDescription>Referral visits</CardDescription>
                <CardTitle className="text-2xl tabular-nums">{data.summary.referralVisits}</CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-1">
                <CardDescription>Referred purchases</CardDescription>
                <CardTitle className="text-2xl tabular-nums">{data.summary.referralTicketPurchases}</CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-1">
                <CardDescription>Free entries confirmed</CardDescription>
                <CardTitle className="text-2xl tabular-nums">{data.summary.freeEntriesConfirmed}</CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-1">
                <CardDescription>Referred revenue</CardDescription>
                <CardTitle className="text-2xl tabular-nums">{data.summary.referredRevenue.toFixed(2)}</CardTitle>
              </CardHeader>
            </Card>
          </div>

          <p className="text-xs text-muted-foreground">
            Visit → purchase:{' '}
            {data.summary.visitToPurchaseRate != null
              ? `${(data.summary.visitToPurchaseRate * 100).toFixed(1)}%`
              : '—'}{' '}
            · Visit → free entry:{' '}
            {data.summary.visitToFreeEntryRate != null
              ? `${(data.summary.visitToFreeEntryRate * 100).toFixed(1)}%`
              : '—'}
          </p>

          {data.topRaffles.length > 0 ? (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Top referral raffles</CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <table className="w-full min-w-[320px] text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted-foreground border-b">
                      <th className="pb-2">Raffle</th>
                      <th className="pb-2 tabular-nums">Visits</th>
                      <th className="pb-2 tabular-nums">Purchases</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.topRaffles.slice(0, 10).map((r) => (
                      <tr key={r.raffleId} className="border-b border-border/40 last:border-0">
                        <td className="py-2">{r.title || r.slug}</td>
                        <td className="py-2 tabular-nums">{r.visits}</td>
                        <td className="py-2 tabular-nums">{r.purchases}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          ) : null}
        </>
      )}
    </div>
  )
}
