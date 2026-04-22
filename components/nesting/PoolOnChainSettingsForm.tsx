'use client'

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import type {
  StakingPoolRow,
  NestingAdapterMode,
  LockEnforcementSource,
} from '@/lib/db/staking-pools'

type Draft = {
  adapter_mode: NestingAdapterMode
  is_onchain_enabled: boolean
  requires_onchain_sync: boolean
  program_id: string
  program_pool_address: string
  vault_address: string
  stake_mint: string
  reward_mint: string
  lock_enforcement_source: LockEnforcementSource
}

function poolToDraft(pool: StakingPoolRow): Draft {
  return {
    adapter_mode: pool.adapter_mode ?? 'mock',
    is_onchain_enabled: pool.is_onchain_enabled ?? false,
    requires_onchain_sync: pool.requires_onchain_sync ?? false,
    program_id: pool.program_id ?? '',
    program_pool_address: pool.program_pool_address ?? '',
    vault_address: pool.vault_address ?? '',
    stake_mint: pool.stake_mint ?? '',
    reward_mint: pool.reward_mint ?? '',
    lock_enforcement_source: pool.lock_enforcement_source ?? 'database',
  }
}

type Props = {
  pool: StakingPoolRow
  isSaving: boolean
  onBusyChange: (busy: boolean) => void
  onSaveSuccess: () => void | Promise<void>
  onRemoteError?: (message: string) => void
}

export function PoolOnChainSettingsForm({
  pool,
  isSaving,
  onBusyChange,
  onSaveSuccess,
  onRemoteError,
}: Props) {
  const [draft, setDraft] = useState<Draft>(() => poolToDraft(pool))
  const [localError, setLocalError] = useState<string | null>(null)

  useEffect(() => {
    setDraft(poolToDraft(pool))
    setLocalError(null)
  }, [pool.id, pool.updated_at])

  const save = async () => {
    setLocalError(null)
    onBusyChange(true)
    try {
      const res = await fetch(`/api/admin/staking/pools/${pool.id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          adapter_mode: draft.adapter_mode,
          is_onchain_enabled: draft.is_onchain_enabled,
          requires_onchain_sync: draft.requires_onchain_sync,
          program_id: draft.program_id.trim() || null,
          program_pool_address: draft.program_pool_address.trim() || null,
          vault_address: draft.vault_address.trim() || null,
          stake_mint: draft.stake_mint.trim() || null,
          reward_mint: draft.reward_mint.trim() || null,
          lock_enforcement_source: draft.lock_enforcement_source,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        const msg = typeof json?.error === 'string' ? json.error : 'Save failed'
        setLocalError(msg)
        onRemoteError?.(msg)
        return
      }
      await onSaveSuccess()
    } finally {
      onBusyChange(false)
    }
  }

  return (
    <Card className="rounded-xl border-border/60 bg-card/50">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">Adapter & on-chain</CardTitle>
        <CardDescription className="text-xs">
          mock and solana_ready keep DB-backed stakes. onchain_enabled targets the program when wired (stakes may 501
          until then). No automatic RPC polling — users POST /api/me/staking/sync with a signature when needed.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {localError && (
          <p className="text-sm text-destructive" role="alert">
            {localError}
          </p>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor={`adapter-${pool.id}`}>Adapter mode</Label>
            <select
              id={`adapter-${pool.id}`}
              className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[44px]"
              value={draft.adapter_mode}
              onChange={(e) =>
                setDraft((d) => ({ ...d, adapter_mode: e.target.value as NestingAdapterMode }))
              }
            >
              <option value="mock">mock (DB)</option>
              <option value="solana_ready">solana_ready (DB until program)</option>
              <option value="onchain_enabled">onchain_enabled (program)</option>
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor={`lock-src-${pool.id}`}>Lock enforcement</Label>
            <select
              id={`lock-src-${pool.id}`}
              className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[44px]"
              value={draft.lock_enforcement_source}
              onChange={(e) =>
                setDraft((d) => ({
                  ...d,
                  lock_enforcement_source: e.target.value as LockEnforcementSource,
                }))
              }
            >
              <option value="database">database</option>
              <option value="onchain">onchain</option>
              <option value="hybrid">hybrid</option>
            </select>
          </div>
          <div className="flex items-center gap-3 sm:col-span-2">
            <Switch
              id={`onchain-${pool.id}`}
              ariaLabel={`On-chain enabled for pool ${pool.name}`}
              checked={draft.is_onchain_enabled}
              onCheckedChange={(v) => setDraft((d) => ({ ...d, is_onchain_enabled: v }))}
            />
            <Label htmlFor={`onchain-${pool.id}`}>On-chain enabled (metadata flag)</Label>
          </div>
          <div className="flex items-center gap-3 sm:col-span-2">
            <Switch
              id={`req-sync-${pool.id}`}
              ariaLabel={`Require on-chain sync for pool ${pool.name}`}
              checked={draft.requires_onchain_sync}
              onCheckedChange={(v) => setDraft((d) => ({ ...d, requires_onchain_sync: v }))}
            />
            <Label htmlFor={`req-sync-${pool.id}`}>Requires on-chain sync (user can POST /sync)</Label>
          </div>
          <div className="space-y-2">
            <Label htmlFor={`prog-${pool.id}`}>Program id (base58)</Label>
            <Input
              id={`prog-${pool.id}`}
              className="font-mono text-xs min-h-[44px]"
              value={draft.program_id}
              onChange={(e) => setDraft((d) => ({ ...d, program_id: e.target.value }))}
              placeholder="Optional"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`ppool-${pool.id}`}>Program pool address</Label>
            <Input
              id={`ppool-${pool.id}`}
              className="font-mono text-xs min-h-[44px]"
              value={draft.program_pool_address}
              onChange={(e) => setDraft((d) => ({ ...d, program_pool_address: e.target.value }))}
              placeholder="Optional"
            />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor={`vault-${pool.id}`}>Vault address</Label>
            <Input
              id={`vault-${pool.id}`}
              className="font-mono text-xs min-h-[44px]"
              value={draft.vault_address}
              onChange={(e) => setDraft((d) => ({ ...d, vault_address: e.target.value }))}
              placeholder="Optional"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`stake-mint-${pool.id}`}>Stake mint</Label>
            <Input
              id={`stake-mint-${pool.id}`}
              className="font-mono text-xs min-h-[44px]"
              value={draft.stake_mint}
              onChange={(e) => setDraft((d) => ({ ...d, stake_mint: e.target.value }))}
              placeholder="Optional (falls back to token mint)"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`rew-mint-${pool.id}`}>Reward mint</Label>
            <Input
              id={`rew-mint-${pool.id}`}
              className="font-mono text-xs min-h-[44px]"
              value={draft.reward_mint}
              onChange={(e) => setDraft((d) => ({ ...d, reward_mint: e.target.value }))}
              placeholder="Optional"
            />
          </div>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="min-h-[44px]"
          disabled={isSaving}
          onClick={() => void save()}
        >
          {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
          Save adapter settings
        </Button>
      </CardContent>
    </Card>
  )
}
