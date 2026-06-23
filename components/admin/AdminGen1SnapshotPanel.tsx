'use client'

import { useCallback, useEffect, useState } from 'react'
import { Check, Copy, Loader2, RefreshCw } from 'lucide-react'

import { DeployButton } from '@/components/owl-center/DeployButton'
import { cn } from '@/lib/utils'

type Summary = {
  wallets: number
  total_nfts: number
  max_nfts_per_wallet: number
  last_updated_at: string | null
}

type RunResult = {
  ok?: boolean
  mode?: string
  replace?: boolean
  holders?: number
  assets_scanned?: number
  parsed?: number
  upserted?: number
  failed?: Array<{ wallet: string; error: string }>
  summary?: Summary
  error?: string
}

type Props = {
  connected: boolean
  className?: string
}

const API = '/api/admin/owl-center/gen2/gen1-snapshot'
const ROOT_API = '/api/owl-center/gen2/wl-proof?phase=AIRDROP'

/**
 * Admin panel to (re)build the frozen Gen1 holder snapshot used as the Gen2 AIRDROP
 * allowlist (merkle root + proofs). Chain scan pulls live holders via Helius DAS; CSV
 * lets you paste wallets / `wallet,count` rows. Run wallet-switch mappings first.
 */
export function AdminGen1SnapshotPanel({ connected, className }: Props) {
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loadingSummary, setLoadingSummary] = useState(false)
  const [replace, setReplace] = useState(true)
  const [csv, setCsv] = useState('')
  const [running, setRunning] = useState<null | 'chain' | 'csv'>(null)
  const [result, setResult] = useState<RunResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [merkleRoot, setMerkleRoot] = useState<{ root: string; count: number } | null>(null)
  const [rootLoading, setRootLoading] = useState(false)
  const [rootError, setRootError] = useState<string | null>(null)
  const [copiedKey, setCopiedKey] = useState<string | null>(null)

  const loadSummary = useCallback(async () => {
    if (!connected) return
    setLoadingSummary(true)
    try {
      const res = await fetch(API, { credentials: 'include', cache: 'no-store' })
      const j = (await res.json().catch(() => ({}))) as Summary & { error?: string }
      if (!res.ok) throw new Error(j.error || 'load_failed')
      setSummary({
        wallets: j.wallets ?? 0,
        total_nfts: j.total_nfts ?? 0,
        max_nfts_per_wallet: j.max_nfts_per_wallet ?? 0,
        last_updated_at: j.last_updated_at ?? null,
      })
    } catch {
      setSummary(null)
    } finally {
      setLoadingSummary(false)
    }
  }, [connected])

  useEffect(() => {
    void loadSummary()
  }, [loadSummary])

  const fetchMerkleRoot = useCallback(async () => {
    setRootLoading(true)
    setRootError(null)
    setCopiedKey(null)
    try {
      const res = await fetch(ROOT_API, { cache: 'no-store' })
      const j = (await res.json().catch(() => ({}))) as { merkle_root?: string; count?: number; error?: string }
      if (!res.ok) throw new Error(j.error || 'merkle_root_failed')
      if (!j.merkle_root) throw new Error('No merkle root returned')
      setMerkleRoot({ root: j.merkle_root, count: j.count ?? 0 })
    } catch (e) {
      setMerkleRoot(null)
      setRootError(e instanceof Error ? e.message : 'merkle_root_failed')
    } finally {
      setRootLoading(false)
    }
  }, [])

  const copy = useCallback(async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedKey(key)
      window.setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 2000)
    } catch {
      setRootError('Clipboard blocked — copy manually.')
    }
  }, [])

  const run = useCallback(
    async (mode: 'chain' | 'csv') => {
      setRunning(mode)
      setError(null)
      setResult(null)
      try {
        const body: Record<string, unknown> = { mode, replace }
        if (mode === 'csv') body.text = csv
        const res = await fetch(API, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        const j = (await res.json().catch(() => ({}))) as RunResult
        if (!res.ok) throw new Error(j.error || 'snapshot_failed')
        setResult(j)
        setMerkleRoot(null)
        setRootError(null)
        if (j.summary) setSummary(j.summary)
        else void loadSummary()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'snapshot_failed')
      } finally {
        setRunning(null)
      }
    },
    [replace, csv, loadSummary]
  )

  return (
    <div className={cn('space-y-4', className)}>
      <p className="text-xs leading-relaxed text-[#9BA8B4]">
        Builds the frozen <strong className="text-[#EAFBF4]">Gen1 holder snapshot</strong> — the allowlist behind the
        Candy Machine <code className="text-[11px] text-[#00FF9C]">gen1</code> guard group (AIRDROP phase merkle root +
        proofs). Add any <strong className="text-[#EAFBF4]">wallet-switch mappings first</strong>; the scan substitutes
        source → mint wallets automatically. After re-taking, regenerate the merkle root and run{' '}
        <code className="text-[11px]">sugar guard update</code> if it&apos;s already frozen on-chain.
      </p>

      <div className="grid gap-2 border border-[#1A222B] bg-[#0B0F14] p-3 font-mono text-[11px] text-[#C5D0D8] sm:grid-cols-2">
        <span>
          Wallets: <span className="text-[#EAFBF4]">{summary ? summary.wallets : '—'}</span>
        </span>
        <span>
          Total Gen1 NFTs: <span className="text-[#EAFBF4]">{summary ? summary.total_nfts : '—'}</span>
        </span>
        <span>
          Max per wallet (min mintLimit):{' '}
          <span className="text-[#FFD769]">{summary ? summary.max_nfts_per_wallet : '—'}</span>
        </span>
        <span>
          Last updated:{' '}
          <span className="text-[#9BA8B4]">
            {summary?.last_updated_at ? new Date(summary.last_updated_at).toLocaleString() : '—'}
          </span>
        </span>
      </div>

      <label className="flex items-center gap-2 font-mono text-[11px] text-[#9BA8B4]">
        <input
          type="checkbox"
          checked={replace}
          onChange={(e) => setReplace(e.target.checked)}
          className="h-4 w-4 touch-manipulation"
        />
        Replace (wipe existing snapshot first — use for a clean pre-launch snapshot)
      </label>

      <div className="flex flex-wrap gap-3">
        <DeployButton type="button" onClick={() => void run('chain')} disabled={!connected || running !== null}>
          {running === 'chain' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Run snapshot (chain scan)
        </DeployButton>
        <DeployButton
          type="button"
          variant="ghost"
          onClick={() => void loadSummary()}
          disabled={!connected || loadingSummary}
        >
          {loadingSummary ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          Refresh summary
        </DeployButton>
      </div>

      <div className="border-t border-[#1A222B] pt-4">
        <label className="grid gap-1 font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">
          CSV / wallet list (optional — one wallet per line, or <code className="text-[10px]">wallet,count</code>)
          <textarea
            value={csv}
            onChange={(e) => setCsv(e.target.value)}
            rows={4}
            placeholder={'FQvw…g8Nq,2\nFb2u…vhLN'}
            className="border border-[#1A222B] bg-[#0F1419] px-3 py-2 font-mono text-xs touch-manipulation"
            spellCheck={false}
          />
        </label>
        <DeployButton
          type="button"
          className="mt-3"
          onClick={() => void run('csv')}
          disabled={!connected || running !== null || !csv.trim()}
        >
          {running === 'csv' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Run snapshot (CSV upload)
        </DeployButton>
      </div>

      {error ? (
        <p className="font-mono text-xs text-[#FF9C9C]" role="status">
          {error}
        </p>
      ) : null}

      {result?.ok ? (
        <div className="border border-[#00FF9C]/25 bg-[#00FF9C]/5 p-3 font-mono text-[11px] leading-relaxed text-[#C5D0D8]">
          <p className="text-[#00FF9C]">
            Snapshot updated ({result.mode}
            {result.replace ? ', replaced' : ''}).
          </p>
          <p>
            {result.mode === 'chain'
              ? `Holders: ${result.holders ?? 0} · assets scanned: ${result.assets_scanned ?? 0}`
              : `Parsed rows: ${result.parsed ?? 0}`}{' '}
            · upserted: {result.upserted ?? 0}
            {result.failed && result.failed.length ? ` · failed: ${result.failed.length}` : ''}
          </p>
          {result.failed && result.failed.length ? (
            <ul className="mt-2 max-h-32 space-y-1 overflow-y-auto text-[#FFD769]">
              {result.failed.slice(0, 20).map((f) => (
                <li key={f.wallet}>
                  {f.wallet.slice(0, 8)}… — {f.error}
                </li>
              ))}
            </ul>
          ) : null}
          <p className="mt-2 text-[#FFD769]">
            Next: regenerate the AIRDROP merkle root below and run <code>sugar guard update</code> so the on-chain{' '}
            <code>gen1</code> guard matches this snapshot.
          </p>
        </div>
      ) : null}

      <div className="border-t border-[#1A222B] pt-4">
        <p className="mb-2 font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">
          AIRDROP merkle root (gen1 guard group)
        </p>
        <p className="mb-3 text-xs leading-relaxed text-[#9BA8B4]">
          Canonical root computed from the current snapshot. Copy it into your candy guard config and run{' '}
          <code className="text-[11px]">sugar guard update</code> to push it on-chain — the server does not write the
          guard for you. Re-fetch after every snapshot change.
        </p>
        <DeployButton type="button" variant="ghost" onClick={() => void fetchMerkleRoot()} disabled={rootLoading}>
          {rootLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          Get merkle root
        </DeployButton>

        {rootError ? (
          <p className="mt-2 font-mono text-xs text-[#FF9C9C]" role="status">
            {rootError}
          </p>
        ) : null}

        {merkleRoot ? (
          <div className="mt-3 space-y-3">
            <div className="border border-[#1A222B] bg-[#0B0F14] p-3">
              <p className="font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">
                Root (base58) · {merkleRoot.count} wallet{merkleRoot.count === 1 ? '' : 's'}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <code className="break-all font-mono text-[11px] text-[#00FF9C]">{merkleRoot.root}</code>
                <CopyButton
                  copied={copiedKey === 'root'}
                  onClick={() => void copy('root', merkleRoot.root)}
                  label="Copy merkle root"
                />
              </div>
            </div>

            <div className="border border-[#1A222B] bg-[#0B0F14] p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">
                  config.json — gen1 group allowList
                </p>
                <CopyButton
                  copied={copiedKey === 'snippet'}
                  onClick={() => void copy('snippet', gen1AllowListSnippet(merkleRoot.root))}
                  label="Copy config snippet"
                />
              </div>
              <pre className="mt-2 overflow-x-auto whitespace-pre font-mono text-[11px] leading-relaxed text-[#C5D0D8]">
                {gen1AllowListSnippet(merkleRoot.root)}
              </pre>
            </div>

            <div className="border border-[#1A222B] bg-[#0B0F14] p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">
                  Then run (from your Sugar folder)
                </p>
                <CopyButton
                  copied={copiedKey === 'cmd'}
                  onClick={() => void copy('cmd', SUGAR_GUARD_COMMANDS)}
                  label="Copy commands"
                />
              </div>
              <pre className="mt-2 overflow-x-auto whitespace-pre font-mono text-[11px] leading-relaxed text-[#C5D0D8]">
                {SUGAR_GUARD_COMMANDS}
              </pre>
              <p className="mt-2 text-[11px] leading-relaxed text-[#FFD769]">
                Set the same <code>merkleRoot</code> on the <code>gen1</code> group in your local{' '}
                <code>config.json</code>, then run the commands above. <code>sugar guard show</code> verifies the new
                root is live. (The site can&apos;t edit your local config or sign the guard — your Sugar keypair owns it.)
              </p>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}

function gen1AllowListSnippet(root: string): string {
  return ['"allowList": {', `  "merkleRoot": "${root}"`, '}'].join('\n')
}

const SUGAR_GUARD_COMMANDS = ['sugar guard update', 'sugar guard show'].join('\n')

function CopyButton({ copied, onClick, label }: { copied: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex min-h-[36px] shrink-0 touch-manipulation items-center gap-1 border border-[#1A222B] px-3 text-[10px] uppercase tracking-widest text-[#9BA8B4] hover:border-[#00FF9C]/35 hover:text-[#E8EEF2]"
      aria-label={label}
    >
      {copied ? <Check className="h-3.5 w-3.5 text-[#00FF9C]" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  )
}
