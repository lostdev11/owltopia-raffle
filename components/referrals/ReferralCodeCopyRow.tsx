'use client'

import { useCallback, useState } from 'react'
import { Button } from '@/components/ui/button'

type Props = {
  code: string
  /** Clipboard value; defaults to `code`. Use full URL when copying a link. */
  copyValue?: string
  copyLabel?: string
  copiedLabel?: string
  /** Prefix shown before code in the display box, e.g. ?ref= */
  displayPrefix?: string
}

export function ReferralCodeCopyRow({
  code,
  copyValue,
  copyLabel = 'Copy code',
  copiedLabel = 'Copied!',
  displayPrefix = '',
}: Props) {
  const [copied, setCopied] = useState(false)

  const onCopy = useCallback(() => {
    const value = (copyValue ?? code).trim()
    if (!value || typeof navigator === 'undefined' || !navigator.clipboard?.writeText) return
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }, [code, copyValue])

  const display = `${displayPrefix}${code}`

  return (
    <div className="flex w-full items-stretch gap-2">
      <div
        className="flex min-h-[44px] min-w-0 flex-1 items-center rounded-lg border border-border/60 bg-muted/80 px-3 font-mono text-sm font-medium text-foreground"
        title={copyValue ?? code}
      >
        <span className="truncate">{display}</span>
      </div>
      <Button
        type="button"
        variant="outline"
        className="min-h-[44px] shrink-0 touch-manipulation px-4"
        onClick={onCopy}
      >
        {copied ? copiedLabel : copyLabel}
      </Button>
    </div>
  )
}
