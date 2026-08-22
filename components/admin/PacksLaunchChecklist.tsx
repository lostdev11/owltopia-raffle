'use client'

import { Check, Circle } from 'lucide-react'
import { packRtpPercentLabel } from '@/lib/packs/admin-copy'
import { PACK_TARGET_EV_SOL } from '@/lib/packs/config'
import { cn } from '@/lib/utils'

const LAUNCH_NFT_TARGET = 30

export type PacksLaunchChecklistProps = {
  vaultConfigured: boolean
  solBalance: number | null
  owlSolPrice: number | null
  availableNfts: number
  estimatedEvSol: number
  estimatedRtpBps: number
  paused: boolean
  vrfEnabled: boolean
}

type CheckItem = {
  id: string
  label: string
  detail?: string
  met: boolean
}

export function PacksLaunchChecklist(props: PacksLaunchChecklistProps) {
  const evOk = Math.abs(props.estimatedEvSol - PACK_TARGET_EV_SOL) <= 0.01
  const items: CheckItem[] = [
    {
      id: 'vault',
      label: 'Packs vault configured',
      detail: props.vaultConfigured ? undefined : 'Set PACKS_VAULT_SECRET_KEY + NEXT_PUBLIC_PACKS_VAULT_WALLET',
      met: props.vaultConfigured,
    },
    {
      id: 'sol',
      label: 'Vault has SOL for prizes / gas',
      detail:
        props.solBalance == null
          ? 'Balance unknown — refresh after funding'
          : props.solBalance > 0
            ? `${props.solBalance.toFixed(3)} SOL`
            : 'Fund the vault with SOL',
      met: props.solBalance != null && props.solBalance > 0,
    },
    {
      id: 'owl-price',
      label: 'OWL price in SOL set',
      detail: props.owlSolPrice != null ? `${props.owlSolPrice} SOL / OWL` : 'Save OWL price above',
      met: props.owlSolPrice != null && props.owlSolPrice > 0,
    },
    {
      id: 'nfts',
      label: `At least ${LAUNCH_NFT_TARGET} prize NFTs deposited`,
      detail: `${props.availableNfts} available`,
      met: props.availableNfts >= LAUNCH_NFT_TARGET,
    },
    {
      id: 'ev',
      label: `EV near ${PACK_TARGET_EV_SOL} SOL (80% RTP)`,
      detail: `~${props.estimatedEvSol.toFixed(4)} SOL · ${packRtpPercentLabel(props.estimatedRtpBps)} RTP`,
      met: evOk,
    },
    {
      id: 'preview',
      label: 'Opening preview tested',
      detail: 'Use Preview pack opening below (manual)',
      met: true, // soft check — always shown as reminder
    },
    {
      id: 'vrf',
      label: props.vrfEnabled
        ? 'Switchboard VRF enabled for opens'
        : 'VRF off (local commit–reveal)',
      detail: props.vrfEnabled
        ? 'PACK_VRF_ENABLED=true'
        : 'Set PACK_VRF_ENABLED=true for on-chain randomness',
      met: props.vrfEnabled,
    },
    {
      id: 'live',
      label: 'Packs buying is on',
      detail: props.paused ? 'Still paused — Turn packs on when ready' : 'Live for buyers',
      met: !props.paused,
    },
  ]

  const hardItems = items.filter((i) => i.id !== 'preview')
  const readyCount = hardItems.filter((i) => i.met).length

  return (
    <div className="rounded-lg border p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-medium">Launch checklist</h2>
        <p className="text-xs text-muted-foreground">
          {readyCount}/{hardItems.length} ready
        </p>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Complete these before turning packs on for the public.
      </p>
      <ul className="mt-3 space-y-2">
        {items.map((item) => (
          <li key={item.id} className="flex items-start gap-2 text-sm">
            {item.met ? (
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
            ) : (
              <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            )}
            <div className={cn(item.met ? 'text-muted-foreground' : 'text-foreground')}>
              <p>{item.label}</p>
              {item.detail ? (
                <p className="text-xs text-muted-foreground">{item.detail}</p>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
