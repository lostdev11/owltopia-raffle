'use client'

import { cn } from '@/lib/utils'
import type { MintTerminalLine } from '@/lib/owl-center/types'

export function ActivityLog({ lines, className }: { lines: MintTerminalLine[]; className?: string }) {
  return (
    <div
      className={cn(
        'max-h-[320px] min-w-0 overflow-x-auto overflow-y-auto rounded-none border border-[#1A222B] bg-[#0B0F14] p-3 font-mono text-[11px] leading-relaxed text-[#C5D0D8]',
        className
      )}
    >
      {lines.length === 0 ? (
        <p className="text-[#5C6773]">// no signals yet</p>
      ) : (
        <ul className="space-y-1">
          {lines.map((l) => (
            <li key={l.id} className="flex min-w-0 gap-2 border-l-2 border-[#00FF9C]/20 pl-2">
              <span className="shrink-0 text-[#5C6773]">{new Date(l.created_at).toLocaleTimeString()}</span>
              <span className={cn('min-w-0 break-words', l.kind === 'mint' ? 'text-[#00FF9C]' : 'text-[#9BA8B4]')}>
                {l.message}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
