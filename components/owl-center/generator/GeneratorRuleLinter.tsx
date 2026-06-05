'use client'

import { AlertTriangle, CheckCircle2, Info } from 'lucide-react'

import { CommandCard } from '@/components/owl-center/CommandCard'
import type { RuleLintIssue } from '@/lib/owl-center/generator/lint-rules'
import { cn } from '@/lib/utils'

export function GeneratorRuleLinter({ issues }: { issues: RuleLintIssue[] }) {
  if (!issues.length) return null

  const errors = issues.filter((i) => i.severity === 'error')
  const warnings = issues.filter((i) => i.severity === 'warning')
  const infos = issues.filter((i) => i.severity === 'info')

  return (
    <CommandCard label="LINTER // rules & supply">
      {errors.length ? (
        <ul className="mb-4 space-y-2">
          {errors.map((issue, i) => (
            <LintRow key={`e-${issue.code}-${i}`} issue={issue} />
          ))}
        </ul>
      ) : null}
      {warnings.length ? (
        <ul className={cn('space-y-2', errors.length ? 'mb-4' : '')}>
          {warnings.map((issue, i) => (
            <LintRow key={`w-${issue.code}-${i}`} issue={issue} />
          ))}
        </ul>
      ) : null}
      {infos.length ? (
        <ul className="space-y-2">
          {infos.map((issue, i) => (
            <LintRow key={`i-${issue.code}-${i}`} issue={issue} />
          ))}
        </ul>
      ) : null}
    </CommandCard>
  )
}

function LintRow({ issue }: { issue: RuleLintIssue }) {
  const Icon =
    issue.severity === 'error' ? AlertTriangle : issue.severity === 'warning' ? AlertTriangle : Info
  const color =
    issue.severity === 'error'
      ? 'text-red-400 border-red-400/30 bg-red-950/20'
      : issue.severity === 'warning'
        ? 'text-amber-400 border-amber-400/30 bg-amber-950/20'
        : 'text-[#9BA8B4] border-[#1A222B] bg-[#0F1419]/60'

  return (
    <li className={cn('flex gap-2 border px-3 py-2 text-sm', color)}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <span>{issue.message}</span>
      {issue.severity === 'info' && issue.code === 'rules_ok' ? (
        <CheckCircle2 className="ml-auto h-4 w-4 shrink-0 text-[#00FF9C]" aria-hidden />
      ) : null}
    </li>
  )
}
