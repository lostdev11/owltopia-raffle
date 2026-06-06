'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, RefreshCw, Upload } from 'lucide-react'

import { DeployButton } from '@/components/owl-center/DeployButton'
import { Gen2WlCommunitySelect, gen2WlCommunityLabel } from '@/components/admin/Gen2WlCommunitySelect'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'

type WlRow = {
  wallet: string
  allowed_mints: number
  used_mints: number
  community: string | null
}

type Props = {
  connected: boolean
  onSuccess?: () => void
  className?: string
}

export function AdminWlCommunityManager({ connected, onSuccess, className }: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [tab, setTab] = useState<'add' | 'view'>('add')
  const [community, setCommunity] = useState('')
  const [text, setText] = useState('')
  const [defaultAllowed, setDefaultAllowed] = useState(1)
  const [uploading, setUploading] = useState(false)
  const [resultMsg, setResultMsg] = useState<string | null>(null)
  const [resultErr, setResultErr] = useState(false)
  const [failures, setFailures] = useState<Array<{ wallet: string; error: string }>>([])

  const [viewCommunity, setViewCommunity] = useState('')
  const [viewLoading, setViewLoading] = useState(false)
  const [viewErr, setViewErr] = useState<string | null>(null)
  const [viewRows, setViewRows] = useState<WlRow[]>([])
  const [viewTotals, setViewTotals] = useState<{ wallet_count: number; total_allowed: number; total_used: number } | null>(
    null
  )

  const loadCommunityWallets = useCallback(async (slug: string) => {
    if (!slug) {
      setViewRows([])
      setViewTotals(null)
      setViewErr(null)
      return
    }
    setViewLoading(true)
    setViewErr(null)
    try {
      const res = await fetch(
        `/api/admin/owl-center/gen2/wl-allocations?community=${encodeURIComponent(slug)}&limit=500`,
        { credentials: 'include', cache: 'no-store' }
      )
      const data = (await res.json().catch(() => ({}))) as {
        error?: string
        rows?: WlRow[]
        wallet_count?: number
        total_allowed?: number
        total_used?: number
      }
      if (!res.ok) throw new Error(data.error || 'Failed to load wallets')
      setViewRows(data.rows ?? [])
      setViewTotals({
        wallet_count: data.wallet_count ?? data.rows?.length ?? 0,
        total_allowed: data.total_allowed ?? 0,
        total_used: data.total_used ?? 0,
      })
    } catch (e) {
      setViewRows([])
      setViewTotals(null)
      setViewErr(e instanceof Error ? e.message : 'Failed to load wallets')
    } finally {
      setViewLoading(false)
    }
  }, [])

  useEffect(() => {
    if (tab === 'view' && viewCommunity) {
      void loadCommunityWallets(viewCommunity)
    }
  }, [tab, viewCommunity, loadCommunityWallets])

  const onFile = useCallback((file: File | null) => {
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const v = typeof reader.result === 'string' ? reader.result : ''
      setText(v)
      setResultMsg(null)
      setFailures([])
    }
    reader.readAsText(file)
  }, [])

  const submit = useCallback(async () => {
    if (!community.trim()) {
      setResultMsg('Choose a community before uploading.')
      setResultErr(true)
      return
    }

    setUploading(true)
    setResultMsg(null)
    setFailures([])
    setResultErr(false)
    try {
      const res = await fetch('/api/admin/owl-center/gen2/wl-allocations/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          text,
          default_allowed_mints: defaultAllowed,
          community: community.trim(),
        }),
      })
      const data = (await res.json().catch(() => ({}))) as {
        error?: string
        upserted?: number
        parsed?: number
        skipped_duplicates?: number
        parse_errors?: string[]
        failed?: Array<{ wallet: string; error: string }>
      }
      if (!res.ok) {
        throw new Error(data.error || 'Upload failed')
      }

      const failed = data.failed ?? []
      setFailures(failed)
      const parseNote =
        data.parse_errors?.length ? ` · ${data.parse_errors.length} parse warning(s)` : ''
      const dupNote = data.skipped_duplicates ? ` · ${data.skipped_duplicates} duplicate lines skipped` : ''
      setResultMsg(
        `Added ${data.upserted ?? 0} / ${data.parsed ?? 0} wallets to ${gen2WlCommunityLabel(community)}${dupNote}${parseNote}${
          failed.length ? ` · ${failed.length} failed` : ''
        }`
      )
      setResultErr(failed.length > 0)
      if ((data.upserted ?? 0) > 0) {
        onSuccess?.()
        if (viewCommunity === community) {
          void loadCommunityWallets(community)
        }
        setText('')
      }
    } catch (e) {
      setResultMsg(e instanceof Error ? e.message : 'Upload failed')
      setResultErr(true)
    } finally {
      setUploading(false)
    }
  }, [text, defaultAllowed, community, onSuccess, viewCommunity, loadCommunityWallets])

  return (
    <div className={cn('space-y-4', className)}>
      <Tabs value={tab} onValueChange={(v) => setTab(v as 'add' | 'view')}>
        <TabsList className="h-auto w-full flex-wrap gap-1 border border-[#1A222B] bg-[#0B0F14] p-1">
          <TabsTrigger
            value="add"
            className="min-h-[44px] flex-1 touch-manipulation font-mono text-[10px] uppercase tracking-widest data-[state=active]:bg-[#00FF9C]/15 data-[state=active]:text-[#00FF9C]"
          >
            Add wallets
          </TabsTrigger>
          <TabsTrigger
            value="view"
            className="min-h-[44px] flex-1 touch-manipulation font-mono text-[10px] uppercase tracking-widest data-[state=active]:bg-[#00FF9C]/15 data-[state=active]:text-[#00FF9C]"
          >
            View by community
          </TabsTrigger>
        </TabsList>

        <TabsContent value="add" className="mt-4 space-y-3">
          <label className="grid gap-1 font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">
            Community
            <Gen2WlCommunitySelect value={community} onChange={setCommunity} placeholder="Select community…" />
          </label>

          <p className="text-xs leading-relaxed text-[#9BA8B4]">
            Best: download the <strong className="text-[#EAFBF4]">.csv</strong> from{' '}
            <a
              href="https://atlas3.io/creator/project/owltopia/wallet-collection"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#00FF9C] underline underline-offset-2"
            >
              Atlas3 wallet collection
            </a>{' '}
            and use <strong className="text-[#EAFBF4]">CSV file</strong> below (columns: Role Name, Wallet Address,
            Discord…). Pick <strong className="text-[#EAFBF4]">Discord GEN2 WL (Atlas3)</strong>. Duplicate wallets are
            merged; Discord username is saved as a note.
          </p>

          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={'7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuGui9Ly\n8yF3…'}
            rows={6}
            className="w-full border border-[#1A222B] bg-[#0F1419] px-3 py-2 font-mono text-xs text-[#F4FBF8] touch-manipulation"
            spellCheck={false}
          />

          <div className="flex flex-wrap items-end gap-3">
            <label className="grid gap-1 font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">
              Slots / wallet
              <input
                type="number"
                min={0}
                max={50}
                value={defaultAllowed}
                onChange={(e) => setDefaultAllowed(Number(e.target.value) || 1)}
                className="w-20 border border-[#1A222B] bg-[#0F1419] px-2 py-2 font-mono text-sm"
              />
            </label>

            <input
              ref={fileRef}
              type="file"
              accept=".csv,.txt,.tsv,text/csv,text/plain"
              className="sr-only"
              onChange={(e) => onFile(e.target.files?.[0] ?? null)}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="inline-flex min-h-[44px] touch-manipulation items-center gap-2 border border-[#00FF9C]/35 bg-[#00FF9C]/10 px-4 font-mono text-[10px] uppercase tracking-widest text-[#00FF9C] hover:border-[#00FF9C]/55"
            >
              <Upload className="h-4 w-4" aria-hidden />
              Atlas3 CSV
            </button>

            <DeployButton
              type="button"
              disabled={!connected || !community.trim() || !text.trim() || uploading}
              onClick={() => void submit()}
            >
              {uploading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Uploading…
                </>
              ) : (
                'Add to community'
              )}
            </DeployButton>
          </div>

          {resultMsg ? (
            <p className={cn('font-mono text-xs', resultErr ? 'text-[#FFD769]' : 'text-[#00FF9C]')} role="status">
              {resultMsg}
            </p>
          ) : null}

          {failures.length > 0 ? (
            <ul className="max-h-32 overflow-y-auto border border-[#FF9C9C]/30 bg-[#FF9C9C]/5 p-2 font-mono text-[10px] text-[#FFD6D6]">
              {failures.slice(0, 20).map((f) => (
                <li key={f.wallet}>
                  {f.wallet.slice(0, 8)}… {f.error}
                </li>
              ))}
              {failures.length > 20 ? <li>…and {failures.length - 20} more</li> : null}
            </ul>
          ) : null}
        </TabsContent>

        <TabsContent value="view" className="mt-4 space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <label className="grid min-w-[200px] flex-1 gap-1 font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">
              Community
              <Gen2WlCommunitySelect
                value={viewCommunity}
                onChange={setViewCommunity}
                placeholder="Select community to inspect…"
                includeUnassigned
              />
            </label>
            <button
              type="button"
              disabled={!viewCommunity || viewLoading}
              onClick={() => void loadCommunityWallets(viewCommunity)}
              className="inline-flex min-h-[44px] touch-manipulation items-center gap-2 border border-[#1A222B] px-4 font-mono text-[10px] uppercase tracking-widest text-[#9BA8B4] hover:border-[#00FF9C]/35 disabled:opacity-50"
            >
              {viewLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <RefreshCw className="h-4 w-4" aria-hidden />
              )}
              Refresh
            </button>
          </div>

          {!viewCommunity ? (
            <p className="text-xs text-[#5C6773]">Pick a community to see wallets already on the WL list.</p>
          ) : viewLoading ? (
            <p className="flex items-center gap-2 text-xs text-[#9BA8B4]">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Loading {gen2WlCommunityLabel(viewCommunity)} wallets…
            </p>
          ) : viewErr ? (
            <p className="text-xs text-[#FFD769]">{viewErr}</p>
          ) : viewTotals ? (
            <>
              <p className="font-mono text-xs text-[#C5D0D8]">
                {gen2WlCommunityLabel(viewCommunity)} · {viewTotals.wallet_count} wallets · {viewTotals.total_allowed}{' '}
                allowed · {viewTotals.total_used} used
              </p>
              {viewRows.length === 0 ? (
                <p className="text-xs text-[#5C6773]">No wallets tagged to this community yet.</p>
              ) : (
                <ul className="max-h-64 overflow-y-auto border border-[#1A222B] bg-[#0B0F14] p-2 font-mono text-[10px] text-[#9BA8B4]">
                  {viewRows.map((r) => (
                    <li key={r.wallet} className="border-b border-[#1A222B]/60 py-1.5 last:border-0">
                      <span className="text-[#EAFBF4]">{r.wallet}</span>
                      <span className="ml-2 text-[#5C6773]">
                        {r.allowed_mints} slot{r.allowed_mints === 1 ? '' : 's'}
                        {r.used_mints > 0 ? ` · ${r.used_mints} used` : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : null}
        </TabsContent>
      </Tabs>
    </div>
  )
}
