'use client'

import { OWL_CENTER_SCHEDULED_PHASES } from '@/lib/owl-center/phase-schedule'
import { owlCenterPhaseLabel } from '@/lib/owl-center/phase-display'
import { datetimeLocalToIso, isoToDatetimeLocal } from '@/lib/owl-center/phase-schedule'
import type { OwlCenterPhaseSchedule } from '@/lib/owl-center/phase-schedule'

type Props = {
  mintStartsAt: string
  onMintStartsAtChange: (v: string) => void
  schedule: OwlCenterPhaseSchedule
  onScheduleChange: (phase: keyof OwlCenterPhaseSchedule, isoValue: string | null) => void
  /** Hide phases with zero supply on gen2-style launches. */
  hiddenPhases?: Set<string>
}

export function PhaseScheduleEditor({
  mintStartsAt,
  onMintStartsAtChange,
  schedule,
  onScheduleChange,
  hiddenPhases,
}: Props) {
  const visiblePhases = OWL_CENTER_SCHEDULED_PHASES.filter((p) => !hiddenPhases?.has(p))

  return (
    <div className="grid gap-4">
      <label className="grid gap-1 font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">
        Mint opens (kickoff)
        <input
          type="datetime-local"
          value={mintStartsAt}
          onChange={(e) => onMintStartsAtChange(e.target.value)}
          className="min-h-[44px] touch-manipulation border border-[#1A222B] bg-[#0F1419] px-3 py-2 font-mono text-sm text-[#F4FBF8]"
        />
      </label>
      <p className="text-xs text-[#5C6773]">
        Set optional start times per phase. Leave blank to open when admin activates that phase manually.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {visiblePhases.map((phase) => (
          <label key={phase} className="grid gap-1 font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">
            {owlCenterPhaseLabel(phase)} starts
            <input
              type="datetime-local"
              value={isoToDatetimeLocal(schedule[phase])}
              onChange={(e) => onScheduleChange(phase, datetimeLocalToIso(e.target.value))}
              className="min-h-[44px] touch-manipulation border border-[#1A222B] bg-[#0F1419] px-3 py-2 font-mono text-sm text-[#F4FBF8]"
            />
          </label>
        ))}
      </div>
    </div>
  )
}
