'use client'

import { LinkifiedText } from '@/components/LinkifiedText'
import type { Raffle } from '@/lib/types'

type Props = {
  raffle: Pick<Raffle, 'description' | 'description_urls_clickable'>
  className?: string
  linkClassName?: string
}

/**
 * Raffle description: only admin creators get URL linkification (see enrichRafflesWithCreatorHolder).
 * Everyone else sees plain text so pasted phishing URLs are not one-tap on mobile.
 */
export function RaffleDescriptionText({ raffle, className, linkClassName }: Props) {
  const text = raffle.description
  if (text == null || !String(text).trim()) return null
  const allowLinks = raffle.description_urls_clickable === true
  if (allowLinks) {
    return <LinkifiedText text={text} className={className} linkClassName={linkClassName} />
  }
  return <span className={`${className ?? ''} whitespace-pre-wrap break-words`}>{text}</span>
}
