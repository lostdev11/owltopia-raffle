'use client'

import { useCallback, useMemo, useState } from 'react'

import { CommandCard } from '@/components/owl-center/CommandCard'
import { getGen2CandyMachineId, getGen2CollectionMint, getSolanaRpcUrl, isDevnetMintEnabled } from '@/lib/solana/network'

type LaunchCm = Parameters<typeof getGen2CandyMachineId>[0]

export function Gen2DevnetMintChecklist({ launch }: { launch: LaunchCm | null }) {
  const [manual, setManual] = useState<Record<string, boolean>>({})

  const autoRows = useMemo(() => {
    const devOn = isDevnetMintEnabled()
    const rpc = getSolanaRpcUrl()
    const cm = getGen2CandyMachineId(launch ?? undefined)
    const col = getGen2CollectionMint(launch ?? undefined)
    return [
      { id: 'rpc', label: 'Devnet RPC configured', done: devOn && rpc.length > 0 },
      { id: 'cm', label: 'Devnet Candy Machine ID added', done: Boolean(cm?.trim()) },
      { id: 'collection', label: 'Devnet Collection Mint added', done: Boolean(col?.trim()) },
    ]
  }, [launch])

  const manualRows = useMemo(
    () => [
      { id: 'sol', label: 'Test wallet has devnet SOL' },
      { id: 'credits', label: 'Test wallet has presale credits' },
      { id: 'mint_tx', label: 'Mint transaction succeeds' },
      { id: 'confirm', label: 'Confirm route verifies tx' },
      { id: 'insert', label: 'Mint event inserted' },
      { id: 'used', label: 'used_mints increments' },
      { id: 'avail', label: 'available_mints decreases' },
      { id: 'explorer', label: 'Explorer link opens correctly' },
    ],
    []
  )

  const toggle = useCallback((id: string) => {
    setManual((m) => ({ ...m, [id]: !m[id] }))
  }, [])

  if (!isDevnetMintEnabled()) {
    return (
      <CommandCard label="gen2_devnet_checklist.sys">
        <p className="text-sm text-[#9BA8B4]">
          Enable <code className="text-[#00FF9C]">NEXT_PUBLIC_GEN2_USE_DEVNET_MINT=true</code> to show the devnet mint
          checklist.
        </p>
      </CommandCard>
    )
  }

  return (
    <CommandCard label="gen2_devnet_checklist.sys">
      <p className="mb-4 font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">Gen2 Devnet Mint Checklist</p>
      <ul className="space-y-2">
        {autoRows.map((it) => (
          <li key={it.id} className="flex items-center gap-3 text-sm">
            <span className="flex h-11 min-w-[44px] shrink-0 items-center justify-center font-mono text-[#00FF9C]" aria-hidden>
              {it.done ? '✓' : '○'}
            </span>
            <span className={it.done ? 'text-[#9BA8B4]' : 'text-[#FFD769]'}>{it.label}</span>
          </li>
        ))}
        {manualRows.map((it) => {
          const ok = !!manual[it.id]
          return (
            <li key={it.id} className="flex items-start gap-3 text-sm">
              <button
                type="button"
                onClick={() => toggle(it.id)}
                className="flex h-11 min-w-[44px] shrink-0 touch-manipulation items-center justify-center rounded border border-[#1A222B] px-2 font-mono text-xs text-[#00FF9C]"
                aria-pressed={ok}
              >
                {ok ? '✓' : '○'}
              </button>
              <span className={ok ? 'text-[#9BA8B4] line-through' : 'text-[#C5D0D8]'}>{it.label}</span>
            </li>
          )
        })}
      </ul>
      <p className="mt-4 text-xs text-[#5C6773]">Env-backed rows update from configuration; tap circles for manual verification steps.</p>
    </CommandCard>
  )
}
