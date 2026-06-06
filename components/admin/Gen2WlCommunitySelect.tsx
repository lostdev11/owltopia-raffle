'use client'

import { GEN2_WL_COLLAB_COMMUNITIES } from '@/lib/owl-center/phase-display'
import { cn } from '@/lib/utils'

type Props = {
  value: string
  onChange: (slug: string) => void
  id?: string
  className?: string
  placeholder?: string
  includeUnassigned?: boolean
}

export function Gen2WlCommunitySelect({
  value,
  onChange,
  id = 'gen2-wl-community',
  className,
  placeholder = 'Choose a community…',
  includeUnassigned = false,
}: Props) {
  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        'min-h-[44px] w-full touch-manipulation border border-[#1A222B] bg-[#0F1419] px-3 py-2 font-mono text-sm text-[#F4FBF8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00FF9C]/40',
        className
      )}
    >
      <option value="">{placeholder}</option>
      {GEN2_WL_COLLAB_COMMUNITIES.map((c) => (
        <option key={c.slug} value={c.slug}>
          {c.label} ({c.slug})
        </option>
      ))}
      {includeUnassigned ? (
        <option value="unassigned">Unassigned</option>
      ) : null}
    </select>
  )
}

export function gen2WlCommunityLabel(slug: string): string {
  if (slug === 'unassigned') return 'Unassigned'
  const match = GEN2_WL_COLLAB_COMMUNITIES.find((c) => c.slug === slug)
  return match ? match.label : slug
}
