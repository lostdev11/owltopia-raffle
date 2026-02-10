'use client'

import { linkifySegments } from '@/lib/linkify'

interface LinkifiedTextProps {
  text: string | null | undefined
  className?: string
}

/**
 * Renders text with URLs as clickable links. Normalizes pasted content so
 * pasted URLs (e.g. from Word or browsers) are detected and linked.
 */
export function LinkifiedText({ text, className }: LinkifiedTextProps) {
  const segments = linkifySegments(text)
  return (
    <span className={className}>
      {segments.map((seg, i) =>
        seg.type === 'text' ? (
          <span key={i}>{seg.value}</span>
        ) : (
          <a
            key={i}
            href={seg.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-green-500 hover:text-green-400 underline break-all"
          >
            {seg.value}
          </a>
        )
      )}
    </span>
  )
}
