'use client'

import { useCallback, useRef, useState } from 'react'
import { Loader2, Upload } from 'lucide-react'

import { DeployButton } from '@/components/owl-center/DeployButton'
import { GEN2_WL_COLLAB_COMMUNITIES } from '@/lib/owl-center/phase-display'
import { cn } from '@/lib/utils'

type UploadKind = 'wl' | 'overage'

type Props = {
  kind: UploadKind
  connected: boolean
  onSuccess?: () => void
  className?: string
}

const ENDPOINTS: Record<UploadKind, string> = {
  wl: '/api/admin/owl-center/gen2/wl-allocations/bulk',
  overage: '/api/admin/owl-center/gen2/presale-overage/bulk',
}

export function AdminWalletBulkUpload({ kind, connected, onSuccess, className }: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [text, setText] = useState('')
  const [defaultAllowed, setDefaultAllowed] = useState(1)
  const [community, setCommunity] = useState('')
  const [uploading, setUploading] = useState(false)
  const [resultMsg, setResultMsg] = useState<string | null>(null)
  const [resultErr, setResultErr] = useState(false)
  const [failures, setFailures] = useState<Array<{ wallet: string; error: string }>>([])

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
    setUploading(true)
    setResultMsg(null)
    setFailures([])
    setResultErr(false)
    try {
      const body: Record<string, unknown> = {
        text,
        default_allowed_mints: defaultAllowed,
      }
      if (kind === 'wl' && community.trim()) {
        body.community = community.trim()
      }

      const res = await fetch(ENDPOINTS[kind], {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
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
        `Uploaded ${data.upserted ?? 0} / ${data.parsed ?? 0} wallets${dupNote}${parseNote}${
          failed.length ? ` · ${failed.length} failed` : ''
        }`
      )
      setResultErr(failed.length > 0)
      if ((data.upserted ?? 0) > 0) onSuccess?.()
    } catch (e) {
      setResultMsg(e instanceof Error ? e.message : 'Upload failed')
      setResultErr(true)
    } finally {
      setUploading(false)
    }
  }, [text, defaultAllowed, community, kind, onSuccess])

  const title = kind === 'wl' ? 'Upload WL wallets' : 'Upload Presale+13 wallets'
  const hint =
    kind === 'wl'
      ? 'One wallet per line, or CSV: wallet, allowed_mints, community. Example: 7xKXtg…abcd, 2, pandarianz'
      : 'One wallet per line, or wallet, allowed_mints. Max 50 per upload. For spots 658–670 (paid presale buyers).'

  return (
    <div className={cn('space-y-3', className)}>
      <p className="text-xs leading-relaxed text-[#9BA8B4]">{hint}</p>

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
            max={kind === 'overage' ? 5 : 50}
            value={defaultAllowed}
            onChange={(e) => setDefaultAllowed(Number(e.target.value) || 1)}
            className="w-20 border border-[#1A222B] bg-[#0F1419] px-2 py-2 font-mono text-sm"
          />
        </label>

        {kind === 'wl' ? (
          <label className="grid min-w-[140px] flex-1 gap-1 font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">
            Default community (optional)
            <input
              list="wl-communities"
              value={community}
              onChange={(e) => setCommunity(e.target.value)}
              placeholder="pandarianz"
              className="border border-[#1A222B] bg-[#0F1419] px-2 py-2 font-mono text-sm"
            />
            <datalist id="wl-communities">
              {GEN2_WL_COLLAB_COMMUNITIES.map((c) => (
                <option key={c.slug} value={c.slug}>
                  {c.label}
                </option>
              ))}
            </datalist>
          </label>
        ) : null}

        <input
          ref={fileRef}
          type="file"
          accept=".csv,.txt,text/plain"
          className="sr-only"
          onChange={(e) => onFile(e.target.files?.[0] ?? null)}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="inline-flex min-h-[44px] touch-manipulation items-center gap-2 border border-[#1A222B] px-4 font-mono text-[10px] uppercase tracking-widest text-[#9BA8B4] hover:border-[#00FF9C]/35"
        >
          <Upload className="h-4 w-4" aria-hidden />
          CSV file
        </button>

        <DeployButton
          type="button"
          disabled={!connected || !text.trim() || uploading}
          onClick={() => void submit()}
        >
          {uploading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Uploading…
            </>
          ) : (
            title
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
    </div>
  )
}
