'use client'

import { useCallback, useEffect, useState } from 'react'
import { useWallet } from '@solana/wallet-adapter-react'

import { CommandCard } from '@/components/owl-center/CommandCard'
import { DeployButton } from '@/components/owl-center/DeployButton'
import { GEN2_TEAM_GUARD_LABEL } from '@/lib/solana/gen2-guards'
import { mintGen2FromCandyMachine } from '@/lib/solana/gen2-mint'
import {
  isOwlCenterPlatformMintFeeEnabled,
} from '@/lib/owl-center/platform-mint-fee'
import type { OwlCenterLaunchPublic } from '@/lib/owl-center/types'
import { getGen2CandyMachineId, getGen2CollectionMint } from '@/lib/solana/network'

type StatusPayload = {
  enabled: boolean
  on_chain_team_group?: boolean
  team_wallets: string[]
  public_pool_remaining: number
  collection_remaining: number
  minted_count: number
  total_supply: number
}

export function AdminGen2BackstopMintPanel({
  launch,
  onChanged,
}: {
  launch: OwlCenterLaunchPublic
  onChanged?: () => void
}) {
  const { connected, publicKey, wallet } = useWallet()
  const adapter = wallet?.adapter

  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [minting, setMinting] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [data, setData] = useState<StatusPayload | null>(null)
  const [qty, setQty] = useState(1)

  const refresh = useCallback(async () => {
    setErr(null)
    try {
      const res = await fetch('/api/admin/owl-center/gen2/backstop-mint', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'status' }),
      })
      const json = (await res.json().catch(() => ({}))) as StatusPayload & { error?: string }
      if (!res.ok) {
        setErr(typeof json.error === 'string' ? json.error : 'Failed to load backstop status')
        return
      }
      setData(json)
    } catch {
      setErr('Failed to load backstop status')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const runAction = async (action: 'enable' | 'disable') => {
    setBusy(true)
    setErr(null)
    setMsg(null)
    try {
      const res = await fetch('/api/admin/owl-center/gen2/backstop-mint', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const json = (await res.json().catch(() => ({}))) as StatusPayload & {
        error?: string
        signature?: string
      }
      if (!res.ok) {
        setErr(typeof json.error === 'string' ? json.error : 'Request failed')
        return
      }
      setData((prev) => ({
        enabled: Boolean(json.enabled),
        on_chain_team_group: action === 'enable',
        team_wallets: json.team_wallets ?? prev?.team_wallets ?? [],
        public_pool_remaining: json.public_pool_remaining ?? prev?.public_pool_remaining ?? 0,
        collection_remaining: json.collection_remaining ?? prev?.collection_remaining ?? 0,
        minted_count: json.minted_count ?? prev?.minted_count ?? launch.minted_count,
        total_supply: json.total_supply ?? prev?.total_supply ?? launch.total_supply,
      }))
      setMsg(
        action === 'enable'
          ? `Team guard enabled${json.signature ? ` (${json.signature.slice(0, 10)}…)` : ''}`
          : 'Team guard disabled'
      )
      onChanged?.()
    } catch {
      setErr('Request failed')
    } finally {
      setBusy(false)
    }
  }

  const mintBackstop = async () => {
    if (!connected || !publicKey || !adapter) {
      setErr('Connect your admin wallet first')
      return
    }
    if (!data?.enabled) {
      setErr('Enable team backstop mint first')
      return
    }
    const n = Math.max(1, Math.min(25, Math.floor(qty), data.collection_remaining))
    setMinting(true)
    setErr(null)
    setMsg(null)
    try {
      const cm = getGen2CandyMachineId(launch)
      const col = getGen2CollectionMint(launch)
      if (!cm || !col) {
        setErr('Candy Machine / collection not configured')
        return
      }
      const result = await mintGen2FromCandyMachine({
        walletAdapter: adapter,
        candyMachineId: cm,
        collectionMint: col,
        quantity: n,
        phase: 'PUBLIC',
        launch,
        guardGroupOverride: GEN2_TEAM_GUARD_LABEL,
        allowListProofPhase: 'TEAM_BACKSTOP',
        collectPlatformMintFee: isOwlCenterPlatformMintFeeEnabled(),
      })
      if (!result.ok) {
        setErr(result.error)
        return
      }
      // Confirm: one tx may cover the whole batch, or one NFT per tx.
      if (result.txSignatures.length === 1) {
        const confirmRes = await fetch('/api/owl-center/gen2/confirm-mint', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            wallet: publicKey.toBase58(),
            txSignature: result.txSignatures[0],
            quantity: result.mintedNftMints.length || n,
            phase: 'PUBLIC',
            mintedNftMints: result.mintedNftMints,
          }),
        })
        const confirmJson = (await confirmRes.json().catch(() => ({}))) as { error?: string }
        if (!confirmRes.ok) {
          setErr(confirmJson.error || 'Confirm failed — check signature on Solscan')
          await refresh()
          onChanged?.()
          return
        }
      } else {
        for (let i = 0; i < result.txSignatures.length; i++) {
          const sig = result.txSignatures[i]!
          const mints =
            result.mintedNftMints.length === result.txSignatures.length
              ? [result.mintedNftMints[i]!]
              : result.mintedNftMints.slice(i, i + 1)
          const confirmRes = await fetch('/api/owl-center/gen2/confirm-mint', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              wallet: publicKey.toBase58(),
              txSignature: sig,
              quantity: Math.max(1, mints.length),
              phase: 'PUBLIC',
              mintedNftMints: mints,
            }),
          })
          const confirmJson = (await confirmRes.json().catch(() => ({}))) as { error?: string }
          if (!confirmRes.ok) {
            setErr(confirmJson.error || 'Confirm failed — check signature on Solscan')
            await refresh()
            onChanged?.()
            return
          }
        }
      }
      setMsg(`Minted ${result.mintedNftMints.length} leftover NFT(s)`)
      await refresh()
      onChanged?.()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setMinting(false)
    }
  }

  const publicDone = (data?.public_pool_remaining ?? 1) <= 0
  const remaining = data?.collection_remaining ?? Math.max(0, launch.total_supply - launch.minted_count)

  return (
    <CommandCard label="BACKSTOP_MINT · TEAM_LEFTOVER">
      <p className="mb-4 text-sm text-[#9BA8B4]">
        When the public pool hits zero, team mint <span className="text-[#00FF9C]">auto-enables</span> (on-chain{' '}
        <code className="text-[11px] text-[#00FF9C]">team</code> guard + allowlist). Mint remaining Gen1/presale
        reserved supply into wallets from <code className="text-[11px] text-[#5C6773]">GEN2_TEAM_MINT_WALLETS</code> /{' '}
        <code className="text-[11px] text-[#5C6773]">ADMIN_WALLETS</code> (plus your session wallet on manual enable).
        Free mint + freeze; still pays the ~$1 platform fee + rent.
      </p>

      {loading ? (
        <p className="font-mono text-xs text-[#5C6773]">Loading…</p>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-3 font-mono text-xs text-[#9BA8B4]">
            <span>
              public_pool:{' '}
              <span className={publicDone ? 'text-[#00FF9C]' : 'text-[#FFD769]'}>
                {data?.public_pool_remaining ?? '—'}
              </span>
            </span>
            <span>
              remaining: <span className="text-[#E8EEF2]">{remaining.toLocaleString()}</span>
            </span>
            <span>
              enabled:{' '}
              <span className={data?.enabled ? 'text-[#00FF9C]' : 'text-[#5C6773]'}>
                {data?.enabled ? 'yes' : 'no'}
              </span>
            </span>
          </div>

          {!publicDone ? (
            <p className="border border-[#FFD769]/35 bg-[#FFD769]/10 px-3 py-2 text-xs text-[#FFD769]">
              Public pool is not empty yet — backstop mint unlocks when public sells out.
            </p>
          ) : null}

          {data?.team_wallets?.length ? (
            <p className="font-mono text-[10px] text-[#5C6773] break-all">
              team wallets: {data.team_wallets.join(', ')}
            </p>
          ) : null}

          <div className="flex flex-wrap gap-3">
            <DeployButton
              type="button"
              disabled={busy || !publicDone || remaining <= 0 || Boolean(data?.enabled)}
              onClick={() => void runAction('enable')}
              className="min-h-[44px] touch-manipulation"
            >
              {data?.enabled ? 'Team mint on (auto)' : 'Enable team mint now'}
            </DeployButton>
            <DeployButton
              type="button"
              disabled={busy || !data?.enabled}
              onClick={() => void runAction('disable')}
              className="min-h-[44px] touch-manipulation border border-[#1A222B] bg-transparent text-[#9BA8B4]"
            >
              Disable team mint
            </DeployButton>
          </div>

          {data?.enabled && remaining > 0 ? (
            <div className="flex flex-wrap items-end gap-3 border-t border-[#1A222B] pt-4">
              <label className="grid gap-1 font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">
                Quantity (max 25)
                <input
                  type="number"
                  min={1}
                  max={Math.min(25, remaining)}
                  value={qty}
                  onChange={(e) => setQty(Number(e.target.value) || 1)}
                  className="w-24 border border-[#1A222B] bg-[#0F1419] px-3 py-2 font-mono text-sm text-[#E8EEF2]"
                />
              </label>
              <DeployButton
                type="button"
                disabled={minting || !connected}
                onClick={() => void mintBackstop()}
                className="min-h-[44px] touch-manipulation"
              >
                {minting ? 'Minting…' : 'Mint leftovers'}
              </DeployButton>
            </div>
          ) : null}
        </div>
      )}

      {msg ? <p className="mt-3 font-mono text-xs text-[#00FF9C]">{msg}</p> : null}
      {err ? <p className="mt-3 font-mono text-xs text-[#FF9C9C]">{err}</p> : null}
    </CommandCard>
  )
}
