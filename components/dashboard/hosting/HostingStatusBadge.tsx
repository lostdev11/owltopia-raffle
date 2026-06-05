'use client'

import { hostingStatusTone, myRaffleStatusLabel, HOSTING_STATUS_BADGE_CLASS } from './helpers'

export function HostingStatusBadge({ status }: { status: string | null }) {
  const tone = hostingStatusTone(status)
  return (
    <span
      className={`inline-flex max-w-full items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium capitalize ring-1 ${HOSTING_STATUS_BADGE_CLASS[tone]}`}
    >
      <span className="truncate">{myRaffleStatusLabel(status)}</span>
    </span>
  )
}
