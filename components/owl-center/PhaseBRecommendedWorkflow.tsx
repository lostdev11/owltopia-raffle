'use client'

import { PHASE_B_RECOMMENDED_STEPS } from '@/lib/owl-center/phase-b-workflow'

export function PhaseBRecommendedWorkflow({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return (
      <p className="text-xs leading-relaxed text-[#9BA8B4]">
        <strong className="font-normal text-[#C5D0D8]">Recommended:</strong> one in-app Arweave upload here — do{' '}
        <strong className="font-normal text-[#E8EEF2]">not</strong> also run <code className="text-[#7D8A93]">sugar upload</code>{' '}
        on the same files. After Arweave, use <code className="text-[#7D8A93]">sugar deploy</code> only.
      </p>
    )
  }

  return (
    <div className="mb-4 rounded border border-[#00FF9C]/20 bg-[#00FF9C]/5 px-3 py-3">
      <p className="font-mono text-[10px] uppercase tracking-widest text-[#00FF9C]">Recommended workflow</p>
      <ol className="mt-2 list-decimal space-y-1.5 pl-4 text-xs leading-relaxed text-[#C5D0D8]">
        {PHASE_B_RECOMMENDED_STEPS.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
    </div>
  )
}
