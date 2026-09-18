'use client'

import { useEffect, useState } from 'react'

import {
  MINT_TIME_ZONE_CHANGE_EVENT,
  readMintTimeZoneMode,
  writeMintTimeZoneMode,
  type MintTimeZoneMode,
} from '@/lib/owl-center/mint-time-preference'
import { cn } from '@/lib/utils'

/** Compact UTC / Local toggle for mint countdown + phase schedule. */
export function MintTimeZoneToggle({ className }: { className?: string }) {
  const [mode, setMode] = useState<MintTimeZoneMode>('utc')

  useEffect(() => {
    const apply = () => setMode(readMintTimeZoneMode())
    apply()
    window.addEventListener(MINT_TIME_ZONE_CHANGE_EVENT, apply)
    window.addEventListener('storage', apply)
    return () => {
      window.removeEventListener(MINT_TIME_ZONE_CHANGE_EVENT, apply)
      window.removeEventListener('storage', apply)
    }
  }, [])

  function select(next: MintTimeZoneMode) {
    setMode(next)
    writeMintTimeZoneMode(next)
  }

  return (
    <div
      className={cn(
        'inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-widest text-[#5C6773]',
        className
      )}
      role="group"
      aria-label="Mint time zone"
    >
      <button
        type="button"
        onClick={() => select('utc')}
        className={cn(
          'min-h-[36px] touch-manipulation border px-2 py-1',
          mode === 'utc'
            ? 'border-[#00FF9C]/50 bg-[#00FF9C]/12 text-[#00FF9C]'
            : 'border-[#1A222B] text-[#5C6773] hover:border-[#00FF9C]/35'
        )}
      >
        UTC
      </button>
      <button
        type="button"
        onClick={() => select('local')}
        className={cn(
          'min-h-[36px] touch-manipulation border px-2 py-1',
          mode === 'local'
            ? 'border-[#00FF9C]/50 bg-[#00FF9C]/12 text-[#00FF9C]'
            : 'border-[#1A222B] text-[#5C6773] hover:border-[#00FF9C]/35'
        )}
      >
        Local
      </button>
    </div>
  )
}
