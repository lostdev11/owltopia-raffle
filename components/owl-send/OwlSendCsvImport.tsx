'use client'

import { useId, useRef, useState } from 'react'
import { CheckCircle2, Download, FileUp, HelpCircle, Loader2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import {
  isLikelyCsvFile,
  lintOwlSendCsv,
  OWL_SEND_AIRDROP_CSV_FILENAME,
  OWL_SEND_AIRDROP_CSV_HREF,
  OWL_SEND_CSV_FORMAT_HINT_NFT,
  OWL_SEND_CSV_FORMAT_HINT_TOKEN,
  owlSendCsvEntriesToNftPaste,
  owlSendCsvEntriesToTokenPaste,
  type OwlSendCsvKind,
  type OwlSendCsvParseResult,
} from '@/lib/owl-send/csv-import'
import { OWL_SEND_MAX_SELECT } from '@/lib/owl-send/constants'

type Props = {
  kind: OwlSendCsvKind
  /** Reserved: admin-only production preview (styling kept neutral). */
  adminTest?: boolean
  disabled?: boolean
  onApply: (pasteText: string, result: OwlSendCsvParseResult) => void
  className?: string
}

/**
 * Simple CSV lint for OwlSend Scatter (upload → lint → fill recipients).
 * Intentionally lightweight: no upload to server, just format + wallet checks.
 */
export function OwlSendCsvImport({ kind, disabled, onApply, className }: Props) {
  const inputId = useId()
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [lint, setLint] = useState<OwlSendCsvParseResult | null>(null)
  const [fileLabel, setFileLabel] = useState<string | null>(null)

  const formatHint = kind === 'nft' ? OWL_SEND_CSV_FORMAT_HINT_NFT : OWL_SEND_CSV_FORMAT_HINT_TOKEN

  const clearLint = () => {
    setLint(null)
    setFileLabel(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  const applyResult = (result: OwlSendCsvParseResult) => {
    if (!result.ok || result.entries.length < 1) return
    const paste =
      kind === 'nft'
        ? owlSendCsvEntriesToNftPaste(result.entries)
        : owlSendCsvEntriesToTokenPaste(result.entries)
    onApply(paste, result)
    clearLint()
  }

  const lintFile = async (file: File) => {
    setLint(null)
    if (!isLikelyCsvFile(file)) {
      setLint({
        ok: false,
        error: 'Not a CSV — use airdrop.csv (or any .csv with a wallet column).',
        entries: [],
        rowErrors: [],
        warnings: [],
        walletColumnIndex: null,
        headers: null,
        truncated: false,
      })
      return
    }
    setBusy(true)
    setFileLabel(file.name)
    try {
      const text = await file.text()
      const result = lintOwlSendCsv({ raw: text, kind, maxEntries: OWL_SEND_MAX_SELECT })
      setLint(result)
      // Clean lint → apply immediately (simple path).
      if (result.ok && result.rowErrors.length === 0 && result.warnings.length === 0) {
        applyResult(result)
      }
    } catch {
      setLint({
        ok: false,
        error: 'Could not read that file. Save as UTF-8 CSV and try again.',
        entries: [],
        rowErrors: [],
        warnings: [],
        walletColumnIndex: null,
        headers: null,
        truncated: false,
      })
    } finally {
      setBusy(false)
    }
  }

  const cleanPass =
    lint?.ok === true && lint.rowErrors.length === 0 && lint.warnings.length === 0

  return (
    <div
      className={cn(
        'space-y-2 rounded-lg border border-white/10 bg-black/20 px-3 py-3',
        className
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Label htmlFor={inputId} className="text-sm font-medium text-white">
            CSV lint
          </Label>
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-white/5 hover:text-white touch-manipulation"
                  aria-label="CSV format help"
                >
                  <HelpCircle className="h-4 w-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent
                side="top"
                className="max-w-xs border-white/15 bg-zinc-950 px-3 py-2 text-xs leading-relaxed text-zinc-100"
              >
                <p className="font-semibold text-white">Proper CSV format</p>
                <pre className="mt-1 whitespace-pre-wrap font-mono text-[11px] text-zinc-300">
                  {formatHint}
                </pre>
                <p className="mt-1 text-zinc-400">
                  Simple lint before send — max {OWL_SEND_MAX_SELECT} wallets / session.
                </p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        <a
          href={OWL_SEND_AIRDROP_CSV_HREF}
          download={OWL_SEND_AIRDROP_CSV_FILENAME}
          className="inline-flex min-h-[36px] items-center gap-1.5 rounded-md px-2 text-xs font-medium text-theme-prime hover:underline touch-manipulation"
        >
          <Download className="h-3.5 w-3.5" />
          {OWL_SEND_AIRDROP_CSV_FILENAME}
        </a>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          ref={fileRef}
          id={inputId}
          type="file"
          accept=".csv,text/csv,text/plain"
          className="sr-only"
          disabled={disabled || busy}
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void lintFile(file)
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="min-h-[40px] gap-2 touch-manipulation"
          disabled={disabled || busy}
          onClick={() => fileRef.current?.click()}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />}
          Lint CSV
        </Button>
        {fileLabel ? (
          <span className="truncate font-mono text-xs text-muted-foreground">{fileLabel}</span>
        ) : (
          <span className="text-xs text-muted-foreground">Pick airdrop.csv · lint before send</span>
        )}
      </div>

      {lint ? (
        <div className="space-y-2 rounded-md border border-white/10 bg-black/40 px-3 py-2">
          {lint.ok ? (
            <>
              <p
                className={cn(
                  'flex items-center gap-1.5 text-sm',
                  cleanPass ? 'text-emerald-200' : 'text-amber-100'
                )}
              >
                {cleanPass ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : null}
                {cleanPass ? 'Lint passed' : 'Lint passed with notes'} · {lint.entries.length}{' '}
                wallet{lint.entries.length === 1 ? '' : 's'}
                {lint.rowErrors.length > 0 ? ` · ${lint.rowErrors.length} skipped` : ''}
                {lint.truncated ? ' · truncated' : ''}
              </p>
              {lint.warnings.map((w) => (
                <p key={w} className="text-xs text-amber-200">
                  {w}
                </p>
              ))}
              {lint.rowErrors.length > 0 ? (
                <ul className="max-h-24 space-y-0.5 overflow-y-auto text-xs text-red-200/90">
                  {lint.rowErrors.slice(0, 8).map((e) => (
                    <li key={`${e.row}-${e.message}`}>
                      Row {e.row}: {e.message}
                    </li>
                  ))}
                  {lint.rowErrors.length > 8 ? (
                    <li>…and {lint.rowErrors.length - 8} more</li>
                  ) : null}
                </ul>
              ) : null}
              {!cleanPass ? (
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    className="min-h-[40px] touch-manipulation"
                    disabled={disabled}
                    onClick={() => applyResult(lint)}
                  >
                    Apply valid wallets
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="min-h-[40px] gap-1 touch-manipulation"
                    onClick={clearLint}
                  >
                    <X className="h-3.5 w-3.5" />
                    Clear
                  </Button>
                </div>
              ) : null}
            </>
          ) : (
            <>
              <p className="text-sm text-red-300" role="alert">
                Lint failed — {lint.error}
              </p>
              {lint.rowErrors.length > 0 ? (
                <ul className="max-h-24 space-y-0.5 overflow-y-auto text-xs text-red-200/90">
                  {lint.rowErrors.slice(0, 8).map((e) => (
                    <li key={`${e.row}-${e.message}`}>
                      Row {e.row}: {e.message}
                    </li>
                  ))}
                </ul>
              ) : null}
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="min-h-[40px] gap-1 touch-manipulation"
                onClick={clearLint}
              >
                <X className="h-3.5 w-3.5" />
                Clear
              </Button>
            </>
          )}
        </div>
      ) : null}
    </div>
  )
}
