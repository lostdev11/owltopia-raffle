'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'

import { CommandCard } from '@/components/owl-center/CommandCard'
import { DeployButton } from '@/components/owl-center/DeployButton'
import {
  buildFullSupplySugarZip,
  fetchGen2GeneratorLink,
  linkGen2GeneratorProject,
  processStagedUploadJob,
  stageSugarZipToLaunch,
  type Gen2GeneratorLink,
} from '@/lib/owl-center/generator/gen2-stage-client'
import { hasBlockingLintIssues, lintGeneratorProject } from '@/lib/owl-center/generator/lint-rules'
import type { GeneratorProject } from '@/lib/owl-center/generator/types'

export function Gen2ExportStagePanel({
  project,
  onProjectPatch,
}: {
  project: GeneratorProject | null
  onProjectPatch: (patch: Partial<GeneratorProject>) => void
}) {
  const [link, setLink] = useState<Gen2GeneratorLink | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const j = await fetchGen2GeneratorLink()
      setLink(j)
      if (j && project && project.targetSupply !== j.total_supply) {
        onProjectPatch({ targetSupply: j.total_supply })
      }
    } finally {
      setLoading(false)
    }
  }, [onProjectPatch, project])

  useEffect(() => {
    void load()
  }, [load])

  const linked =
    Boolean(link?.generator_project_id && project?.id && link.generator_project_id === project.id)
  const lint = project ? lintGeneratorProject(project) : null
  const lintBlocked = lint ? hasBlockingLintIssues(lint) : true
  const supply = link?.total_supply ?? project?.targetSupply ?? 2000

  async function linkThisProject() {
    if (!project) return
    setBusy(true)
    setErr(null)
    const res = await linkGen2GeneratorProject({ generator_project_id: project.id })
    if (!res.ok) setErr(res.error ?? 'link_failed')
    else {
      setMsg('This project is now linked to Gen2.')
      if (res.link) setLink(res.link)
    }
    setBusy(false)
  }

  async function exportAndStage() {
    if (!project || !link?.launch_id) return
    if (lintBlocked) {
      setErr('Fix linter errors before exporting')
      return
    }
    setBusy(true)
    setErr(null)
    setMsg(null)
    setProgress('Building Sugar ZIP…')
    try {
      const built = await buildFullSupplySugarZip(project, supply, (p) => {
        if (p.phase === 'compositing') {
          setProgress(`Rendering ${p.completed.toLocaleString()} / ${p.total.toLocaleString()} pieces…`)
        } else {
          setProgress(`Packaging ZIP… ${p.completed}%`)
        }
      })
      setProgress(`Staging ${built.count.toLocaleString()} files to Gen2…`)
      const staged = await stageSugarZipToLaunch(link.launch_id, built.blob, built.filename)
      if (!staged.ok) throw new Error(staged.error)
      setProgress('Running validation…')
      await processStagedUploadJob(link.launch_id, staged.job_id, 'validate')
      setMsg(
        `Staged ${built.count.toLocaleString()} assets on Gen2. Open assets admin → Push to Arweave when ready.`
      )
      setProgress(null)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'export_stage_failed')
      setProgress(null)
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <CommandCard label="GEN2 // export & stage">
        <p className="font-mono text-xs text-[#5C6773]">Loading Gen2 link…</p>
      </CommandCard>
    )
  }

  return (
    <CommandCard label="GEN2 // export & stage">
      <p className="mb-4 text-sm leading-relaxed text-[#9BA8B4]">
        Full Gen2 pipeline: export <strong className="font-normal text-[#E8EEF2]">{supply.toLocaleString()}</strong>{' '}
        PNG+JSON pairs and stage directly to Gen2 assets (skip manual ZIP download).
      </p>

      {!linked ? (
        <p className="mb-4 rounded border border-[#FFD769]/30 bg-[#FFD769]/10 px-3 py-2 text-sm text-[#FFD769]">
          {link?.generator_project_id
            ? 'Another project is linked to Gen2 — link this project or open the linked one.'
            : 'Link this project to Gen2 before staging.'}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-3">
        {!linked ? (
          <DeployButton
            type="button"
            className="min-h-[44px] touch-manipulation"
            disabled={busy || !project}
            onClick={() => void linkThisProject()}
          >
            Link this project to Gen2
          </DeployButton>
        ) : (
          <DeployButton
            type="button"
            className="min-h-[44px] touch-manipulation"
            disabled={busy || lintBlocked || !project}
            onClick={() => void exportAndStage()}
          >
            {busy ? (
              <>
                <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
                Working…
              </>
            ) : (
              `Export & stage full supply (${supply.toLocaleString()})`
            )}
          </DeployButton>
        )}
        {link?.assets_admin_url ? (
          <Link
            href={link.assets_admin_url}
            className="inline-flex min-h-[44px] touch-manipulation items-center border border-[#1A222B] px-4 font-mono text-xs uppercase tracking-wide text-[#9BA8B4] hover:border-[#00FF9C]/35 hover:text-[#E8EEF2]"
          >
            Gen2 assets admin
          </Link>
        ) : null}
      </div>

      {progress ? <p className="mt-3 font-mono text-xs text-[#C5D0D8]">{progress}</p> : null}
      {err ? <p className="mt-3 font-mono text-xs text-[#FF9C9C]">{err}</p> : null}
      {msg ? <p className="mt-3 font-mono text-xs text-[#00FF9C]">{msg}</p> : null}

      {linked && !busy ? (
        <p className="mt-3 text-xs text-[#5C6773]">
          Re-export replaces the staged set — safe before Candy Machine deploy. Large ZIPs may take a few minutes in the
          browser.
        </p>
      ) : null}
    </CommandCard>
  )
}
