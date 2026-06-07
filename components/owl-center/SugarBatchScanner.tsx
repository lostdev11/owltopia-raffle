'use client'

import { useCallback, useRef, useState } from 'react'
import { FileArchive, Files, Loader2, Upload } from 'lucide-react'

import { CommandCard } from '@/components/owl-center/CommandCard'
import { calculateReadinessScore } from '@/lib/owl-center/asset-validation'
import {
  scanSugarBatchFromFiles,
  scanSugarBatchFromZip,
  type SugarBatchScanResult,
} from '@/lib/owl-center/scan-sugar-batch'
import { cn } from '@/lib/utils'

type Props = {
  expectedSupply?: number
  onApply: (result: SugarBatchScanResult) => void
}

const pickBtnClass =
  'inline-flex min-h-[44px] touch-manipulation cursor-pointer items-center justify-center gap-2 px-6 font-bold uppercase tracking-wide transition border border-[#00FF9C]/40 bg-[#00FF9C]/10 text-[#E8FEF4] shadow-[0_0_24px_rgba(0,255,156,0.18)] hover:bg-[#00FF9C]/18 has-[:disabled]:pointer-events-none has-[:disabled]:opacity-40'

const pickBtnGhostClass =
  'inline-flex min-h-[44px] touch-manipulation cursor-pointer items-center justify-center gap-2 px-6 font-bold uppercase tracking-wide transition border border-[#1A222B] bg-transparent text-[#9BA8B4] hover:border-[#00FF9C]/35 hover:text-[#E8EEF2] has-[:disabled]:pointer-events-none has-[:disabled]:opacity-40'

export function SugarBatchScanner({ expectedSupply, onApply }: Props) {
  const resultRef = useRef<HTMLDivElement>(null)
  const [scanning, setScanning] = useState(false)
  const [result, setResult] = useState<SugarBatchScanResult | null>(null)
  const [statusMsg, setStatusMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [lastPickedNames, setLastPickedNames] = useState<string[]>([])

  const runScan = useCallback(
    async (fn: () => Promise<SugarBatchScanResult>, startLabel: string, pickedNames: string[]) => {
      setScanning(true)
      setErr(null)
      setResult(null)
      setLastPickedNames(pickedNames)
      setStatusMsg(startLabel)
      try {
        const r = await fn()
        setResult(r)
        if (r.ok) {
          setStatusMsg(
            `Scan complete — ${r.imageCount} png, ${r.metadataCount} json, supply ${r.inferredSupply}. Scroll down and click Apply.`
          )
        } else if (r.filesReceived === 0) {
          setErr('No files were read. Try Scan ZIP or pick files again.')
          setStatusMsg(null)
        } else {
          setStatusMsg(
            `Read ${r.filesReceived} file(s) but found ${r.imageCount} png / ${r.metadataCount} json. Names must be exactly 0.png, 0.json, 1.png, …`
          )
        }
        requestAnimationFrame(() => {
          resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
        })
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'scan_failed')
        setStatusMsg(null)
      } finally {
        setScanning(false)
      }
    },
    []
  )

  const onZipFile = useCallback(
    (file: File) => {
      if (!file.name.toLowerCase().endsWith('.zip')) {
        setErr('Please choose a .zip file (Generator export or zipped assets folder).')
        return
      }
      void runScan(() => scanSugarBatchFromZip(file, { expectedSupply }), `Reading ${file.name} locally…`, [file.name])
    },
    [expectedSupply, runScan]
  )

  const onZipChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const input = e.target
      const file = input.files?.[0] ?? null
      window.setTimeout(() => {
        input.value = ''
      }, 0)
      if (!file) return
      onZipFile(file)
    },
    [onZipFile]
  )

  const onFilesChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const input = e.target
      const list = Array.from(input.files ?? [])
      window.setTimeout(() => {
        input.value = ''
      }, 0)

      if (list.length === 0) return

      const names = list.map((f) => f.name)
      void runScan(
        () => scanSugarBatchFromFiles(list, { expectedSupply }),
        `Reading ${list.length} file(s) locally…`,
        names
      )
    },
    [expectedSupply, runScan]
  )

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setDragOver(false)
      const file = e.dataTransfer.files?.[0]
      if (!file) return
      onZipFile(file)
    },
    [onZipFile]
  )

  const score = result ? calculateReadinessScore(result.checklist) : 0

  return (
    <CommandCard label="auto_scan.sys · Sugar batch">
      <p className="text-sm text-[#9BA8B4]">
        Local scan only — files never upload to our servers. In File Explorer open <strong className="font-normal text-[#E8EEF2]">assets</strong>,{' '}
        <strong className="font-normal text-[#E8EEF2]">Ctrl+A</strong>, then tap{' '}
        <strong className="font-normal text-[#E8EEF2]">Select all files</strong>. Expect names like{' '}
        <strong className="font-normal text-[#E8EEF2]">0.png</strong> and <strong className="font-normal text-[#E8EEF2]">0.json</strong>.
      </p>

      <div
        className={cn(
          'mt-4 flex min-h-[88px] touch-manipulation flex-col items-center justify-center gap-2 border border-dashed px-4 py-6 text-center transition-colors',
          dragOver ? 'border-[#00FF9C]/50 bg-[#00FF9C]/8' : 'border-[#1A222B] bg-[#0B0F12]/80'
        )}
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
      >
        <Upload className="h-5 w-5 text-[#5C6773]" aria-hidden />
        <p className="font-mono text-[11px] text-[#9BA8B4]">Drop Sugar ZIP here</p>
      </div>

      <div className="mt-4 flex flex-wrap gap-3">
        <label className={cn(pickBtnClass, scanning && 'pointer-events-none opacity-40')}>
          <input
            type="file"
            className="sr-only"
            multiple
            disabled={scanning}
            onChange={onFilesChange}
          />
          {scanning ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Files className="h-4 w-4" aria-hidden />}
          Select all files
        </label>

        <label className={cn(pickBtnGhostClass, scanning && 'pointer-events-none opacity-40')}>
          <input
            type="file"
            className="sr-only"
            disabled={scanning}
            onChange={onZipChange}
          />
          <FileArchive className="h-4 w-4" aria-hidden />
          Scan ZIP
        </label>
      </div>

      <p className="mt-3 rounded border border-[#FFD769]/25 bg-[#FFD769]/8 px-3 py-2 font-mono text-[11px] text-[#FFD769]">
        Windows tip: open files from a <strong className="font-normal text-[#F4FBF8]">real extracted folder</strong> — picking
        inside a .zip in Explorer often returns 0 files. Extract first, or use <strong className="font-normal text-[#F4FBF8]">Scan ZIP</strong> / drop ZIP below.
      </p>

      {expectedSupply != null && expectedSupply > 0 ? (
        <p className="mt-2 font-mono text-[10px] text-[#5C6773]">
          Launch supply for comparison: {expectedSupply}
        </p>
      ) : null}

      {statusMsg ? (
        <p className="mt-3 rounded border border-[#00FF9C]/25 bg-[#00FF9C]/8 px-3 py-2 text-sm text-[#C5D0D8]">
          {statusMsg}
        </p>
      ) : null}

      {lastPickedNames.length > 0 ? (
        <p className="mt-2 font-mono text-[10px] text-[#5C6773]">
          Last pick ({lastPickedNames.length}): {lastPickedNames.slice(0, 8).join(', ')}
          {lastPickedNames.length > 8 ? '…' : ''}
        </p>
      ) : null}

      {err ? (
        <p className="mt-3 rounded border border-[#FF9C9C]/30 bg-[#FF9C9C]/10 px-3 py-2 text-sm text-[#FF9C9C]">
          {err}
        </p>
      ) : null}

      {result ? (
        <div
          ref={resultRef}
          className="mt-4 space-y-3 border border-[#1A222B] bg-[#0F1419] p-4 font-mono text-xs text-[#9BA8B4]"
        >
          <p className={result.ok ? 'text-[#00FF9C]' : 'text-[#FFD769]'}>
            {result.ok ? 'Scan OK' : 'Scan found issues'} · {result.filesReceived} file(s) · {result.imageCount} png ·{' '}
            {result.metadataCount} json · supply {result.inferredSupply} · checklist {score}%
          </p>
          {result.samplePaths.length ? (
            <p className="text-[10px] text-[#5C6773]">
              Paths: {result.samplePaths.join(', ')}
              {result.filesReceived > result.samplePaths.length ? '…' : ''}
            </p>
          ) : null}
          {result.samples.length ? (
            <ul className="space-y-1 text-[#C5D0D8]">
              {result.samples.map((s) => (
                <li key={s.index}>
                  #{s.index}: {s.name ?? '—'} · {s.attributeCount} traits · image {s.image ?? '—'}
                </li>
              ))}
            </ul>
          ) : null}
          {result.errors.map((line) => (
            <p key={line} className="text-[#FF9C9C]">
              {line}
            </p>
          ))}
          {result.warnings.map((line) => (
            <p key={line} className="text-[#FFD769]">
              {line}
            </p>
          ))}
          <button
            type="button"
            className={pickBtnClass}
            onClick={() => onApply(result)}
          >
            Apply counts + checklist to form
          </button>
          <p className="text-[10px] text-[#5C6773]">
            Then click <span className="text-[#9BA8B4]">Save asset package</span> below.
          </p>
        </div>
      ) : null}
    </CommandCard>
  )
}
