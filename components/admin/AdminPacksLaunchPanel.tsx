'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Loader2, Trash2 } from 'lucide-react'

type PackAccessMode = 'public' | 'restricted'

type LaunchState = {
  accessMode: PackAccessMode
  killSwitch: boolean
  effectivePublic: boolean
}

type TestWallet = {
  wallet_address: string
  created_at: string
  created_by_wallet: string | null
  note: string | null
}

type Props = {
  busy: boolean
  onBusy: (busy: boolean) => void
  onError: (message: string | null) => void
}

export function AdminPacksLaunchPanel({ busy, onBusy, onError }: Props) {
  const [launch, setLaunch] = useState<LaunchState | null>(null)
  const [wallets, setWallets] = useState<TestWallet[]>([])
  const [loading, setLoading] = useState(true)
  const [walletInput, setWalletInput] = useState('')
  const [noteInput, setNoteInput] = useState('')

  const load = useCallback(async () => {
    onError(null)
    try {
      const [launchRes, walletsRes] = await Promise.all([
        fetch('/api/admin/packs/launch', { credentials: 'include' }),
        fetch('/api/admin/packs/test-wallets', { credentials: 'include' }),
      ])
      const launchJson = await launchRes.json()
      const walletsJson = await walletsRes.json()
      if (!launchRes.ok) throw new Error(launchJson.error || 'Failed to load launch settings')
      if (!walletsRes.ok) throw new Error(walletsJson.error || 'Failed to load test wallets')
      setLaunch({
        accessMode: launchJson.accessMode === 'public' ? 'public' : 'restricted',
        killSwitch: Boolean(launchJson.killSwitch),
        effectivePublic: Boolean(launchJson.effectivePublic),
      })
      setWallets(Array.isArray(walletsJson.wallets) ? walletsJson.wallets : [])
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Failed to load launch settings')
    } finally {
      setLoading(false)
    }
  }, [onError])

  useEffect(() => {
    void load()
  }, [load])

  async function setMode(access_mode: PackAccessMode) {
    onBusy(true)
    onError(null)
    try {
      const res = await fetch('/api/admin/packs/launch', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ access_mode }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to update launch mode')
      setLaunch({
        accessMode: json.accessMode === 'public' ? 'public' : 'restricted',
        killSwitch: Boolean(json.killSwitch),
        effectivePublic: Boolean(json.effectivePublic),
      })
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Failed to update launch mode')
    } finally {
      onBusy(false)
    }
  }

  async function addWallet() {
    onBusy(true)
    onError(null)
    try {
      const res = await fetch('/api/admin/packs/test-wallets', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          wallet: walletInput.trim(),
          note: noteInput.trim() || null,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to add wallet')
      setWallets(Array.isArray(json.wallets) ? json.wallets : [])
      setWalletInput('')
      setNoteInput('')
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Failed to add wallet')
    } finally {
      onBusy(false)
    }
  }

  async function removeWallet(wallet: string) {
    onBusy(true)
    onError(null)
    try {
      const res = await fetch(
        `/api/admin/packs/test-wallets?wallet=${encodeURIComponent(wallet)}`,
        { method: 'DELETE', credentials: 'include' }
      )
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to remove wallet')
      setWallets(Array.isArray(json.wallets) ? json.wallets : [])
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Failed to remove wallet')
    } finally {
      onBusy(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-lg border p-4 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading launch settings…
      </div>
    )
  }

  const mode = launch?.accessMode ?? 'restricted'

  return (
    <div className="space-y-4 rounded-lg border p-4">
      <div>
        <h2 className="text-base font-semibold">Launch mode</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Who can open <span className="font-mono">/packs</span> and buy (when packs are turned
          on). Change anytime — no redeploy.
        </p>
      </div>

      {launch?.killSwitch ? (
        <p className="rounded-md border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-xs text-amber-100">
          Env kill switch is on (<span className="font-mono">PACKS_PUBLIC=false</span>). Only
          admins can access Packs until you clear that and redeploy. DB launch mode is ignored
          while the kill switch is active.
        </p>
      ) : null}

      <div className="flex flex-col gap-2 sm:flex-row">
        <Button
          type="button"
          size="sm"
          className="min-h-[44px] touch-manipulation"
          disabled={busy || mode === 'restricted'}
          variant={mode === 'restricted' ? 'default' : 'outline'}
          onClick={() => void setMode('restricted')}
        >
          Restricted live
        </Button>
        <Button
          type="button"
          size="sm"
          className="min-h-[44px] touch-manipulation"
          disabled={busy || mode === 'public'}
          variant={mode === 'public' ? 'default' : 'outline'}
          onClick={() => void setMode('public')}
        >
          Public live
        </Button>
      </div>

      <p className="text-sm">
        Current:{' '}
        <strong>{mode === 'public' ? 'Public live' : 'Restricted live'}</strong>
        {mode === 'restricted'
          ? ' — admins + test wallets below'
          : ' — everyone can use /packs'}
      </p>

      <div className="border-t pt-4">
        <h3 className="text-sm font-semibold">Test wallets</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          These wallets can use Packs on production while launch mode is Restricted. Clear the
          list after you switch to Public live.
        </p>

        <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]">
          <div className="space-y-2">
            <Label htmlFor="pack-test-wallet">Wallet address</Label>
            <Input
              id="pack-test-wallet"
              value={walletInput}
              onChange={(e) => setWalletInput(e.target.value)}
              placeholder="Solana wallet…"
              className="min-h-[44px] font-mono text-xs touch-manipulation"
            />
            <Label htmlFor="pack-test-note">Note (optional)</Label>
            <Input
              id="pack-test-note"
              value={noteInput}
              onChange={(e) => setNoteInput(e.target.value)}
              placeholder="e.g. QA wallet"
              className="min-h-[44px] touch-manipulation"
            />
          </div>
          <div className="flex items-end">
            <Button
              type="button"
              className="min-h-[44px] w-full touch-manipulation sm:w-auto"
              disabled={busy || !walletInput.trim()}
              onClick={() => void addWallet()}
            >
              Add
            </Button>
          </div>
        </div>

        {wallets.length === 0 ? (
          <p className="mt-3 text-xs text-muted-foreground">No test wallets yet.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {wallets.map((w) => (
              <li
                key={w.wallet_address}
                className="flex items-start justify-between gap-2 rounded-md border px-3 py-2 text-xs"
              >
                <div className="min-w-0">
                  <p className="break-all font-mono">{w.wallet_address}</p>
                  {w.note ? <p className="mt-0.5 text-muted-foreground">{w.note}</p> : null}
                </div>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-9 w-9 shrink-0 touch-manipulation"
                  disabled={busy}
                  aria-label={`Remove ${w.wallet_address}`}
                  onClick={() => void removeWallet(w.wallet_address)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
