'use client'

import { Download, FlaskConical, Loader2 } from 'lucide-react'
import { useCallback, useState } from 'react'

import { CommandCard } from '@/components/owl-center/CommandCard'
import { DeployButton } from '@/components/owl-center/DeployButton'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  simulateSupply,
  simulationResultToCsv,
  type SupplySimulationResult,
} from '@/lib/owl-center/generator/simulate-supply'
import type { GeneratorProject } from '@/lib/owl-center/generator/types'
import { cn } from '@/lib/utils'

type Props = {
  project: GeneratorProject
  targetSupply: number
  disabled?: boolean
}

export function GeneratorSupplySimulator({ project, targetSupply, disabled }: Props) {
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)
  const [result, setResult] = useState<SupplySimulationResult | null>(null)

  const runSimulation = useCallback(() => {
    setBusy(true)
    setOpen(true)
    setResult(null)
    window.setTimeout(() => {
      try {
        const next = simulateSupply(project, targetSupply)
        setResult(next)
      } catch (e) {
        setResult({
          target: targetSupply,
          generated: 0,
          exhausted: true,
          attempts: 0,
          combos: [],
          traitStats: [],
          warnings: [e instanceof Error ? e.message : 'Simulation failed'],
        })
      } finally {
        setBusy(false)
      }
    }, 0)
  }, [project, targetSupply])

  const downloadCsv = useCallback(() => {
    if (!result?.combos.length) return
    const csv = simulationResultToCsv(project, result)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${project.collectionName || 'collection'}-simulation-${result.generated}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }, [project, result])

  const ok = result ? result.generated >= result.target : false
  const short = result ? result.generated < result.target : false

  return (
    <>
      <CommandCard label="SIMULATE // full supply test">
        <p className="text-sm text-[#9BA8B4]">
          Generate all{' '}
          <span className="text-[#E8EEF2]">{targetSupply.toLocaleString()}</span> unique combos in-memory
          (no images) to see rule gaps, missing traits, and distribution skew before export.
        </p>
        <DeployButton
          className="mt-4 w-full gap-2"
          disabled={disabled || busy || !project.traits.length}
          onClick={runSimulation}
        >
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <FlaskConical className="h-4 w-4" aria-hidden />
          )}
          {busy ? 'Simulating…' : `Simulate ${targetSupply.toLocaleString()} combos`}
        </DeployButton>
      </CommandCard>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto border-[#1A222B] bg-[#0F1419] text-[#E8EEF2] sm:max-w-lg [&>button]:text-[#9BA8B4] [&>button]:hover:text-[#E8EEF2]">
          <DialogHeader className="text-left">
            <DialogTitle className="text-lg text-[#E8EEF2]">Supply simulation</DialogTitle>
            <DialogDescription className="text-sm text-[#9BA8B4]">
              Dry-run of unique combos under current traits, weights, and rules.
            </DialogDescription>
          </DialogHeader>

          {busy ? (
            <div className="flex items-center gap-3 py-8 text-sm text-[#9BA8B4]">
              <Loader2 className="h-5 w-5 animate-spin text-[#00C97A]" aria-hidden />
              Generating {targetSupply.toLocaleString()} combos…
            </div>
          ) : result ? (
            <div className="space-y-4">
              <div
                className={cn(
                  'border px-4 py-3 text-sm',
                  ok
                    ? 'border-[#00FF9C]/35 bg-[#00FF9C]/10 text-[#E8FDF4]'
                    : short
                      ? 'border-amber-500/35 bg-amber-500/10 text-amber-100'
                      : 'border-[#1A222B] bg-[#0B0F12] text-[#C5D0D8]'
                )}
              >
                <p className="font-mono text-lg font-bold">
                  {result.generated.toLocaleString()} / {result.target.toLocaleString()} unique combos
                </p>
                <p className="mt-1 font-mono text-[10px] uppercase tracking-widest text-[#9BA8B4]">
                  {result.attempts.toLocaleString()} generation attempts
                  {result.exhausted ? ' · pool exhausted' : ''}
                </p>
              </div>

              <div>
                <p className="font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">Findings</p>
                <ul className="mt-2 space-y-2 text-sm text-[#C5D0D8]">
                  {result.warnings.map((w, i) => (
                    <li key={i} className="border border-[#1A222B] bg-[#0B0F12] px-3 py-2">
                      {w}
                    </li>
                  ))}
                </ul>
              </div>

              {result.traitStats.length ? (
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">
                    Trait distribution
                  </p>
                  <div className="mt-2 max-h-48 overflow-y-auto border border-[#1A222B]">
                    <table className="w-full text-left text-xs">
                      <thead className="sticky top-0 bg-[#0B0F12] text-[#5C6773]">
                        <tr>
                          <th className="px-2 py-2 font-mono uppercase">Layer</th>
                          <th className="px-2 py-2 font-mono uppercase">Trait</th>
                          <th className="px-2 py-2 font-mono uppercase">Count</th>
                          <th className="px-2 py-2 font-mono uppercase">%</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.traitStats.map((s) => (
                          <tr
                            key={s.traitId}
                            className={cn(
                              'border-t border-[#1A222B]',
                              s.count === 0 && 'text-amber-300/90'
                            )}
                          >
                            <td className="px-2 py-1.5 text-[#9BA8B4]">{s.categoryName}</td>
                            <td className="px-2 py-1.5 text-[#E8EEF2]">{s.traitName}</td>
                            <td className="px-2 py-1.5 font-mono">{s.count}</td>
                            <td className="px-2 py-1.5 font-mono">{s.percent.toFixed(1)}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}

              {result.combos.length ? (
                <DeployButton variant="ghost" className="w-full gap-2" onClick={downloadCsv}>
                  <Download className="h-4 w-4" aria-hidden />
                  Download combo list (CSV)
                </DeployButton>
              ) : null}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  )
}
