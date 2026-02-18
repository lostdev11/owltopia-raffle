'use client'

import { createContext, useContext } from 'react'
import { linkifySegments } from '@/lib/linkify'

/** When true, LinkifiedText must not render <a> (avoids nested <a> inside Next Link). */
const LinkifiedTextInsideLinkContext = createContext(false)

export function LinkifiedTextInsideLinkProvider({ children }: { children: React.ReactNode }) {
  return (
    <LinkifiedTextInsideLinkContext.Provider value={true}>
      {children}
    </LinkifiedTextInsideLinkContext.Provider>
  )
}

interface LinkifiedTextProps {
  text: string | null | undefined
  className?: string
  /** When true, URLs are rendered as spans with click handlers instead of <a>, to avoid nested <a> (invalid HTML). */
  nestedInLink?: boolean
}

function openUrl(url: string) {
  window.open(url, '_blank', 'noopener,noreferrer')
}

/**
 * Renders text with URLs as clickable links. Normalizes pasted content so
 * pasted URLs (e.g. from Word or browsers) are detected and linked.
 * Use nestedInLink (or wrap in LinkifiedTextInsideLinkProvider) when inside another link to avoid invalid nested <a>.
 */
export function LinkifiedText({ text, className, nestedInLink }: LinkifiedTextProps) {
  const insideLinkContext = useContext(LinkifiedTextInsideLinkContext)
  const useSpanForLinks = nestedInLink === true || insideLinkContext
  const segments = linkifySegments(text)
  const linkClassName = 'text-green-500 hover:text-green-400 underline break-all'
  return (
    <span className={className}>
      {segments.map((seg, i) =>
        seg.type === 'text' ? (
          <span key={i}>{seg.value}</span>
        ) : useSpanForLinks ? (
          <span
            key={i}
            role="link"
            tabIndex={0}
            className={`${linkClassName} cursor-pointer`}
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              openUrl(seg.url)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                openUrl(seg.url)
              }
            }}
          >
            {seg.value}
          </span>
        ) : (
          <a
            key={i}
            href={seg.url}
            target="_blank"
            rel="noopener noreferrer"
            className={linkClassName}
          >
            {seg.value}
          </a>
        )
      )}
    </span>
  )
}
