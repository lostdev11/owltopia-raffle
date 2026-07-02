'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, Trash2 } from 'lucide-react'

import { DeployButton } from '@/components/owl-center/DeployButton'
import { cn } from '@/lib/utils'

type Delegation = {
  source_wallet: string
  mint_wallet: string
  note: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

type Props = {
  connected: boolean
  className?: string
}

const API = '/api/admin/owl-center/gen2/presale-delegations'

function shortWallet(w: string): string {
  return w.length > 14 ? `${w.slice(0, 6)}…${w.slice(-6)}` : w
}

/**
 * Admin "switch wallet for mint" — map a presale credit holder's wallet (source) to a different
 * wallet (mint) so they can redeem presale spots from a safe wallet after compromise.
 */
export function AdminPresaleWalletSwitch({ connected, className }: Props) {
  const [delegations, setDelegations] = useState<Delegation[]>([])
  const [loading, setLoading] = useState(false)
  const [source, setSource] = useState('')
  const [mint, setMint] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [msgErr, setMsgErr] = useState(false)

  const load = useCallback(async () => {
    if (!connected) return
    setLoading(true)
    try {
      const res = await fetch(API, { credentials: 'include', cache: 'no-store' })
      const j = (await res.json().catch(() => ({}))) as { delegations?: Delegation[]; error?: string }
      if (!res.ok) throw new Error(j.error || 'load_failed')
      setDelegations(j.delegations ?? [])
    } catch {
      setDelegations([])
    } finally {
      setLoading(false)
    }
  }, [connected])

  useEffect(() => {
    void load()
  }, [load])

  const add = useCallback(async () => {
    setSaving(true)
    setMsg(null)
    setMsgErr(false)
    try {
      const res = await fetch(API, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source_wallet: source.trim(), mint_wallet: mint.trim(), note: note.trim() || null }),
      })
      const j = (await res.json().catch(() => ({}))) as {
        error?: string
        source_available_mints?: number
        warning?: string | null
      }
      if (!res.ok) throw new Error(j.error || 'save_failed')
      const count = j.source_available_mints ?? 0
      setMsg(
        j.warning
          ? j.warning
          : `Mapping saved — source has ${count} presale credit${count === 1 ? '' : 's'} available (mint wallet will redeem them). Update the presale merkle guard root after saving.`
      )
      setMsgErr(Boolean(j.warning))
      setSource('')
      setMint('')
      setNote('')
      await load()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'save_failed')
      setMsgErr(true)
    } finally {
      setSaving(false)
    }
  }, [source, mint, note, load])

  const remove = useCallback(
    async (sourceWallet: string) => {
      setMsg(null)
      setMsgErr(false)
      try {
        const res = await fetch(API, {
          method: 'DELETE',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ source_wallet: sourceWallet }),
        })
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        if (!res.ok) throw new Error(j.error || 'delete_failed')
        await load()
      } catch (e) {
        setMsg(e instanceof Error ? e.message : 'delete_failed')
        setMsgErr(true)
      }
    },
    [load]
  )

  return (
    <div className={cn('space-y-4', className)}>
      <p className="text-xs leading-relaxed text-[#9BA8B4]">
        Map a presale buyer&apos;s wallet (<strong className="text-[#EAFBF4]">source</strong>, holds paid credits) to a
        different <strong className="text-[#EAFBF4]">mint</strong> wallet. The mint wallet can then redeem presale spots
        from the safe wallet — purchase records stay on the source for audit. The source wallet is blocked from presale
        minting while delegated.
      </p>

      <div className="border border-[#FFD769]/30 bg-[#FFD769]/5 p-3 font-mono text-[11px] leading-relaxed text-[#FFD769]">
        After adding a mapping, refresh the on-chain presale allowlist merkle root (source → mint substitution changes
        the root). Run <code>scripts/inspect-gen2-allowlist.ts presale</code> for the new root, then{' '}
        <code>sugar guard update</code>.
      </div>

      <div className="grid gap-3">
        <label className="grid gap-1 font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">
          Source wallet (paid presale / compromised)
          <input
            value={source}
            onChange={(e) => setSource(e.target.value)}
            placeholder="CUxWSsDtDScrnU4mSsQ8wo9jd187jrjigG272HZrgKr2"
            className="border border-[#1A222B] bg-[#0F1419] px-3 py-2 font-mono text-sm touch-manipulation"
            spellCheck={false}
          />
        </label>
        <label className="grid gap-1 font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">
          Mint wallet (safe wallet)
          <input
            value={mint}
            onChange={(e) => setMint(e.target.value)}
            placeholder="HmcJ7ifDvZrZBsDdWXEEsFz7fVobDndDy4ommsh1ChwP"
            className="border border-[#1A222B] bg-[#0F1419] px-3 py-2 font-mono text-sm touch-manipulation"
            spellCheck={false}
          />
        </label>
        <label className="grid gap-1 font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">
          Note (optional)
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Mr. Shamrock — compromised wallet"
            className="border border-[#1A222B] bg-[#0F1419] px-3 py-2 font-mono text-sm touch-manipulation"
          />
        </label>
        <DeployButton
          type="button"
          onClick={() => void add()}
          disabled={!connected || !source.trim() || !mint.trim() || saving}
        >
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Add presale wallet switch
        </DeployButton>
      </div>

      {msg ? (
        <p className={cn('font-mono text-xs', msgErr ? 'text-[#FFD769]' : 'text-[#00FF9C]')} role="status">
          {msg}
        </p>
      ) : null}

      <div className="border-t border-[#1A222B] pt-4">
        <p className="mb-2 font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">
          Active mappings {loading ? '(loading…)' : `(${delegations.length})`}
        </p>
        {delegations.length === 0 ? (
          <p className="text-xs text-[#5C6773]">
            {connected ? 'No presale wallet switches configured.' : 'Sign in as admin to view mappings.'}
          </p>
        ) : (
          <ul className="space-y-2">
            {delegations.map((d) => (
              <li
                key={d.source_wallet}
                className="flex flex-wrap items-center justify-between gap-2 border border-[#1A222B] bg-[#0B0F14] p-2 font-mono text-[11px] text-[#C5D0D8]"
              >
                <span className="break-all">
                  <span className="text-[#9BA8B4]">{shortWallet(d.source_wallet)}</span>
                  <span className="px-2 text-[#00FF9C]">→</span>
                  <span className="text-[#EAFBF4]">{shortWallet(d.mint_wallet)}</span>
                  {d.note ? <span className="ml-2 text-[#5C6773]">· {d.note}</span> : null}
                </span>
                <button
                  type="button"
                  onClick={() => void remove(d.source_wallet)}
                  className="inline-flex min-h-[36px] touch-manipulation items-center gap-1 border border-[#FF9C9C]/30 px-3 text-[10px] uppercase tracking-widest text-[#FFD6D6] hover:border-[#FF9C9C]/60"
                  aria-label={`Remove mapping for ${d.source_wallet}`}
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
