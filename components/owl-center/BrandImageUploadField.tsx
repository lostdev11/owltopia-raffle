'use client'

import { useRef, useState } from 'react'
import { ImagePlus, Loader2 } from 'lucide-react'

import { readApiJsonResponse } from '@/lib/fetch-api-json'

type Props = {
  label: string
  value: string
  onChange: (url: string) => void
  hint?: string
}

export function BrandImageUploadField({ label, value, onChange, hint }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function onFile(file: File) {
    setBusy(true)
    setErr(null)
    try {
      const form = new FormData()
      form.append('image', file)
      const res = await fetch('/api/owl-center/brand-image', {
        method: 'POST',
        credentials: 'include',
        body: form,
      })
      const j = await readApiJsonResponse<{ url?: string; error?: string }>(res)
      if (!res.ok || !j.url) throw new Error(j.error || 'upload_failed')
      onChange(j.url)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'upload_failed')
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <div className="grid gap-2">
      <span className="font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">{label}</span>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        {value ? (
          <div className="relative h-20 w-20 shrink-0 overflow-hidden border border-[#1A222B] bg-[#0B0F12]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={value} alt="" className="h-full w-full object-cover" />
          </div>
        ) : (
          <div className="flex h-20 w-20 shrink-0 items-center justify-center border border-dashed border-[#1A222B] bg-[#0B0F12]/80 text-[#5C6773]">
            <ImagePlus className="h-5 w-5" aria-hidden />
          </div>
        )}
        <div className="grid min-w-0 flex-1 gap-2">
          <div className="flex flex-wrap gap-2">
            <label className="inline-flex min-h-[44px] touch-manipulation cursor-pointer items-center justify-center gap-2 border border-[#00FF9C]/40 bg-[#00FF9C]/10 px-4 text-xs font-bold uppercase tracking-wide text-[#E8FEF4] has-[:disabled]:pointer-events-none has-[:disabled]:opacity-40">
              <input
                ref={inputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif,image/avif,image/heic"
                className="sr-only"
                disabled={busy}
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) void onFile(f)
                }}
              />
              {busy ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  Uploading…
                </>
              ) : (
                <>
                  <ImagePlus className="h-4 w-4" aria-hidden />
                  Upload image
                </>
              )}
            </label>
            {value ? (
              <button
                type="button"
                className="min-h-[44px] touch-manipulation px-3 font-mono text-[10px] uppercase tracking-widest text-[#7D8A93] hover:text-[#C5D0D8]"
                onClick={() => onChange('')}
              >
                Clear
              </button>
            ) : null}
          </div>
          <input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            type="url"
            placeholder="Or paste HTTPS / Arweave URL"
            className="border border-[#1A222B] bg-[#0F1419] px-3 py-2 text-sm text-[#F4FBF8]"
          />
          {hint ? <p className="font-mono text-[10px] text-[#5C6773]">{hint}</p> : null}
          {err ? <p className="font-mono text-[10px] text-[#FF9C9C]">{err}</p> : null}
        </div>
      </div>
    </div>
  )
}
