import { ChevronDown } from 'lucide-react'
import type { ReactNode } from 'react'

/** Extra / technical notes, always collapsed until opened. */
export function PacksAdminExtraDetails({
  children,
  notes = [],
  summary = 'More details',
}: {
  children?: ReactNode
  notes?: string[]
  summary?: string
}) {
  const hasNotes = notes.length > 0
  if (!hasNotes && !children) return null

  return (
    <details className="group mt-2 rounded-md border border-border/60">
      <summary
        className="flex min-h-[44px] cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-sm text-muted-foreground touch-manipulation [&::-webkit-details-marker]:hidden"
        style={{ touchAction: 'manipulation' }}
      >
        <span>{summary}</span>
        <ChevronDown
          className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
          aria-hidden
        />
      </summary>
      <div className="space-y-2 border-t border-border/50 px-3 pb-3 pt-2">
        {children}
        {hasNotes ? (
          <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">
            {notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </details>
  )
}
