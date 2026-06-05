'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Layers, Link2, Rocket, Shuffle, Sparkles, Trash2, Upload } from 'lucide-react'
import { useWallet } from '@solana/wallet-adapter-react'

import { CommandCard } from '@/components/owl-center/CommandCard'
import { DeployButton } from '@/components/owl-center/DeployButton'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { GeneratorCloudSavePanel } from '@/components/owl-center/generator/GeneratorCloudSavePanel'
import { GeneratorRuleLinter } from '@/components/owl-center/generator/GeneratorRuleLinter'
import { OwlCenterShell } from '@/components/owl-center/OwlCenterShell'
import { canvasToDataUrl, compositeTraitsToCanvas } from '@/lib/owl-center/generator/composite'
import { createDemoProject, createEmptyProject } from '@/lib/owl-center/generator/demo-project'
import { exportBatchAsSugarZip } from '@/lib/owl-center/generator/export-zip'
import { generateBatch } from '@/lib/owl-center/generator/generate-batch'
import { buildLaunchDraft, saveLaunchDraftToSession } from '@/lib/owl-center/generator/launch-draft'
import { hasBlockingLintIssues, lintGeneratorProject } from '@/lib/owl-center/generator/lint-rules'
import {
  clampTraitWeight,
  estimateMaxUniqueSupply,
  traitRarityPercent,
} from '@/lib/owl-center/generator/rarity'
import {
  getCategoryPool,
  pickWeightedRandom,
  traitsForSelection,
  validateSelection,
} from '@/lib/owl-center/generator/rules'
import {
  clearGeneratorProject,
  fileToDataUrl,
  loadGeneratorProject,
  saveGeneratorProject,
} from '@/lib/owl-center/generator/storage'
import type {
  CompatibilityRule,
  CompatibilityRuleType,
  GeneratorProject,
  TraitLayer,
  TraitSelection,
} from '@/lib/owl-center/generator/types'
import { cn } from '@/lib/utils'

function uid() {
  return crypto.randomUUID()
}

export function OwlGeneratorPageClient() {
  const router = useRouter()
  const { connected } = useWallet()
  const [project, setProject] = useState<GeneratorProject | null>(null)
  const [loading, setLoading] = useState(true)
  const [selection, setSelection] = useState<TraitSelection>({})
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [batchSize, setBatchSize] = useState(5)
  const [exportBusy, setExportBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [signedIn, setSignedIn] = useState<boolean | null>(null)
  const [cloudUpdatedAt, setCloudUpdatedAt] = useState<string | null>(null)
  const [cloudBusy, setCloudBusy] = useState(false)
  const [cloudError, setCloudError] = useState<string | null>(null)
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cloudTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const fetchCloudProject = useCallback(async () => {
    try {
      const res = await fetch('/api/owl-center/generator/project', { credentials: 'include' })
      if (res.status === 401) {
        setSignedIn(false)
        return null
      }
      if (!res.ok) return null
      setSignedIn(true)
      const j = (await res.json()) as {
        project?: GeneratorProject | null
        cloud_updated_at?: string
      }
      setCloudUpdatedAt(j.cloud_updated_at ?? null)
      return j.project ?? null
    } catch {
      return null
    }
  }, [])

  useEffect(() => {
    void (async () => {
      const [local, cloud] = await Promise.all([loadGeneratorProject(), fetchCloudProject()])
      let chosen = local ?? createEmptyProject()
      if (cloud) {
        const cloudTime = new Date(cloud.updatedAt).getTime()
        const localTime = local ? new Date(local.updatedAt).getTime() : 0
        if (!local || cloudTime >= localTime) chosen = cloud
      }
      setProject(chosen)
      setLoading(false)
    })()
  }, [fetchCloudProject])

  useEffect(() => {
    if (!project || loading) return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      void saveGeneratorProject(project)
    }, 800)
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
    }
  }, [project, loading])

  useEffect(() => {
    if (connected && signedIn === null) {
      void fetchCloudProject()
    }
    if (!connected) setSignedIn(null)
  }, [connected, signedIn, fetchCloudProject])

  const lintIssues = useMemo(() => (project ? lintGeneratorProject(project) : []), [project])
  const lintBlocked = hasBlockingLintIssues(lintIssues)
  const maxUnique = project ? estimateMaxUniqueSupply(project) : 0

  const categoriesSorted = useMemo(
    () => (project ? [...project.categories].sort((a, b) => a.zIndex - b.zIndex) : []),
    [project]
  )

  const traitsByCategory = useMemo(() => {
    const map = new Map<string, TraitLayer[]>()
    if (!project) return map
    for (const cat of project.categories) map.set(cat.id, [])
    for (const t of project.traits) {
      const list = map.get(t.categoryId)
      if (list) list.push(t)
    }
    return map
  }, [project])

  const selectedTraits = useMemo(
    () => (project ? traitsForSelection(project.traits, selection) : []),
    [project, selection]
  )

  const selectionError = useMemo(
    () => (project ? validateSelection(selection, project.rules) : null),
    [project, selection]
  )

  useEffect(() => {
    if (!project || !selectedTraits.length) {
      setPreviewUrl(null)
      return
    }
    if (selectionError) {
      setPreviewError(selectionError)
      setPreviewUrl(null)
      return
    }
    let cancelled = false
    void compositeTraitsToCanvas(selectedTraits, project.categories)
      .then((canvas) => {
        if (!cancelled) {
          setPreviewUrl(canvasToDataUrl(canvas))
          setPreviewError(null)
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setPreviewError(e instanceof Error ? e.message : 'Preview failed')
          setPreviewUrl(null)
        }
      })
    return () => {
      cancelled = true
    }
  }, [project, selectedTraits, selectionError])

  const updateProject = useCallback((patch: Partial<GeneratorProject>) => {
    setProject((p) => (p ? { ...p, ...patch, updatedAt: new Date().toISOString() } : p))
  }, [])

  const updateTraitWeight = useCallback(
    (traitId: string, weight: number) => {
      if (!project) return
      updateProject({
        traits: project.traits.map((t) =>
          t.id === traitId ? { ...t, weight: clampTraitWeight(weight) } : t
        ),
      })
    },
    [project, updateProject]
  )

  const saveProjectToCloud = useCallback(
    async (p: GeneratorProject, opts?: { silent?: boolean }) => {
      setCloudBusy(true)
      if (!opts?.silent) setCloudError(null)
      try {
        const res = await fetch('/api/owl-center/generator/project', {
          method: 'PUT',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ project: p }),
        })
        const j = (await res.json()) as { error?: string; updated_at?: string }
        if (res.status === 401) {
          setSignedIn(false)
          if (!opts?.silent) setCloudError('Sign in required for cloud save')
          return
        }
        if (!res.ok) {
          if (!opts?.silent) setCloudError(j.error || 'Cloud save failed')
          return
        }
        setSignedIn(true)
        setCloudUpdatedAt(j.updated_at ?? new Date().toISOString())
        if (!opts?.silent) setMessage('Saved to cloud')
      } catch {
        if (!opts?.silent) setCloudError('Cloud save failed')
      } finally {
        setCloudBusy(false)
      }
    },
    []
  )

  useEffect(() => {
    if (!project || loading || signedIn !== true) return
    if (cloudTimer.current) clearTimeout(cloudTimer.current)
    cloudTimer.current = setTimeout(() => {
      void saveProjectToCloud(project, { silent: true })
    }, 4000)
    return () => {
      if (cloudTimer.current) clearTimeout(cloudTimer.current)
    }
  }, [project, loading, signedIn, saveProjectToCloud])

  const addTraitFiles = useCallback(
    async (categoryId: string, files: FileList | null) => {
      if (!project || !files?.length) return
      const added: TraitLayer[] = []
      for (const file of Array.from(files)) {
        if (!file.type.startsWith('image/')) continue
        const imageSrc = await fileToDataUrl(file)
        const baseName = file.name.replace(/\.[^.]+$/, '')
        added.push({
          id: uid(),
          categoryId,
          name: baseName,
          weight: 100,
          imageSrc,
        })
      }
      if (!added.length) return
      updateProject({ traits: [...project.traits, ...added] })
      setMessage(`Added ${added.length} layer(s)`)
    },
    [project, updateProject]
  )

  const removeTrait = useCallback(
    (traitId: string) => {
      if (!project) return
      updateProject({
        traits: project.traits.filter((t) => t.id !== traitId),
        rules: project.rules.reduce<CompatibilityRule[]>((acc, r) => {
          if (r.type === 'if_pool') {
            if (r.whenTraitId === traitId) return acc
            const allowed = (r.allowedTraitIds ?? []).filter((id) => id !== traitId)
            if (!allowed.length) return acc
            acc.push({ ...r, allowedTraitIds: allowed })
            return acc
          }
          const traitIds = (r.traitIds ?? []).filter((id) => id !== traitId)
          if (traitIds.length >= 2) acc.push({ ...r, traitIds })
          return acc
        }, []),
      })
      setSelection((s) => {
        const next = { ...s }
        for (const [catId, id] of Object.entries(next)) {
          if (id === traitId) next[catId] = null
        }
        return next
      })
    },
    [project, updateProject]
  )

  const randomizePreview = useCallback(() => {
    if (!project) return
    const sorted = [...project.categories].sort((a, b) => a.zIndex - b.zIndex)
    const next: TraitSelection = {}
    for (const cat of sorted) {
      const pool = getCategoryPool(cat.id, next, project.traits, project.rules)
      next[cat.id] = pool.length ? (pickWeightedRandom(pool)?.id ?? null) : null
    }
    for (let i = 0; i < 80; i++) {
      if (!validateSelection(next, project.rules)) break
      for (const cat of sorted) {
        const pool = getCategoryPool(cat.id, next, project.traits, project.rules)
        if (pool.length) next[cat.id] = pickWeightedRandom(pool)?.id ?? null
      }
    }
    setSelection(next)
  }, [project])

  const addRule = useCallback(
    (type: CompatibilityRuleType, traitIds: string[]) => {
      if (!project || traitIds.length < 2) return
      const rule: CompatibilityRule = {
        id: uid(),
        type,
        traitIds,
        label:
          type === 'require'
            ? 'Linked traits — must appear together'
            : type === 'exclude'
              ? 'Incompatible — cannot combine'
              : 'Locked set — all or none',
      }
      updateProject({ rules: [...project.rules, rule] })
    },
    [project, updateProject]
  )

  const addIfPoolRule = useCallback(
    (whenTraitId: string, targetCategoryId: string, allowedTraitIds: string[]) => {
      if (!project || !whenTraitId || !targetCategoryId || allowedTraitIds.length < 1) return
      const whenTrait = project.traits.find((t) => t.id === whenTraitId)
      const targetCat = project.categories.find((c) => c.id === targetCategoryId)
      const allowedNames = allowedTraitIds
        .map((id) => project.traits.find((t) => t.id === id)?.name)
        .filter(Boolean)
        .join(', ')
      const rule: CompatibilityRule = {
        id: uid(),
        type: 'if_pool',
        whenTraitId,
        targetCategoryId,
        allowedTraitIds,
        label: `IF ${whenTrait?.name ?? 'trait'} → ${targetCat?.name ?? 'layer'}: ${allowedNames}`,
      }
      updateProject({ rules: [...project.rules, rule] })
    },
    [project, updateProject]
  )

  const loadDemo = useCallback(async () => {
    setLoading(true)
    const demo = await createDemoProject()
    setProject(demo)
    setSelection({})
    setLoading(false)
    setMessage('Demo loaded — backgrounds, bodies, hats, glasses, accessories + sample IF rules')
  }, [])

  const handleExport = useCallback(async () => {
    if (!project) return
    if (lintBlocked) {
      setMessage('Fix linter errors before exporting')
      return
    }
    setExportBusy(true)
    setMessage(null)
    try {
      const batch = generateBatch(project, Math.min(50, Math.max(1, batchSize)))
      await exportBatchAsSugarZip(project, batch)
      setMessage(`Exported ${batch.length} Sugar-ready asset(s) as ZIP`)
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Export failed')
    } finally {
      setExportBusy(false)
    }
  }, [project, batchSize, lintBlocked])

  const handleLaunchHandoff = useCallback(() => {
    if (!project) return
    if (lintBlocked) {
      setMessage('Fix linter errors before submitting to launch')
      return
    }
    const draft = buildLaunchDraft(project)
    saveLaunchDraftToSession(draft)
    router.push('/owl-center/launch?from=generator')
  }, [project, lintBlocked, router])

  const handleResetProject = useCallback(async () => {
    await clearGeneratorProject()
    setProject(createEmptyProject())
    setSelection({})
    setMessage('Project reset')
    setResetConfirmOpen(false)
  }, [])

  if (loading || !project) {
    return (
      <OwlCenterShell eyebrow="OWL_CENTER // GENERATOR" title="Owl Generator" subtitle="Loading project…">
        <p className="font-mono text-sm text-[#5C6773]">Loading…</p>
      </OwlCenterShell>
    )
  }

  return (
    <OwlCenterShell
      eyebrow="OWL_CENTER // GENERATOR"
      title="Owl Generator"
      subtitle="Layers, rarity weights, pairing rules, cloud sync, and launch submission — for Gen3 and partner collections."
    >
      <div className="mb-6 flex flex-wrap gap-2">
        <DeployButton variant="ghost" onClick={() => void loadDemo()} className="gap-2">
          <Sparkles className="h-4 w-4" aria-hidden />
          Load demo
        </DeployButton>
        <DeployButton variant="ghost" onClick={() => setResetConfirmOpen(true)}>
          Reset project
        </DeployButton>
        <DeployButton className="gap-2" onClick={handleLaunchHandoff} disabled={lintBlocked || !project.traits.length}>
          <Rocket className="h-4 w-4" aria-hidden />
          Submit to launch
        </DeployButton>
      </div>

      {message ? (
        <p className="mb-6 rounded border border-[#00FF9C]/25 bg-[#00FF9C]/8 px-4 py-3 text-sm text-[#C5D0D8]">{message}</p>
      ) : null}

      <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
        <div className="space-y-8">
          <CommandCard label="COLLECTION // meta">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">Project name</span>
                <input
                  className="mt-1 w-full min-h-[44px] border border-[#1A222B] bg-[#0F1419] px-3 text-[#E8EEF2] touch-manipulation"
                  value={project.name}
                  onChange={(e) => updateProject({ name: e.target.value })}
                />
              </label>
              <label className="block text-sm">
                <span className="font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">Collection name</span>
                <input
                  className="mt-1 w-full min-h-[44px] border border-[#1A222B] bg-[#0F1419] px-3 text-[#E8EEF2] touch-manipulation"
                  value={project.collectionName}
                  onChange={(e) => updateProject({ collectionName: e.target.value })}
                />
              </label>
              <label className="block text-sm">
                <span className="font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">Symbol</span>
                <input
                  className="mt-1 w-full min-h-[44px] border border-[#1A222B] bg-[#0F1419] px-3 text-[#E8EEF2] touch-manipulation"
                  value={project.symbol}
                  onChange={(e) => updateProject({ symbol: e.target.value.slice(0, 10) })}
                />
              </label>
              <label className="block text-sm">
                <span className="font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">Target supply</span>
                <input
                  type="number"
                  min={1}
                  max={1000000}
                  className="mt-1 w-full min-h-[44px] border border-[#1A222B] bg-[#0F1419] px-3 text-[#E8EEF2] touch-manipulation"
                  value={project.targetSupply ?? (maxUnique || 1000)}
                  onChange={(e) => updateProject({ targetSupply: Math.max(1, Number(e.target.value) || 1) })}
                />
                <span className="mt-1 block font-mono text-[10px] text-[#5C6773]">
                  ~{maxUnique.toLocaleString()} max unique combos
                </span>
              </label>
              <label className="block text-sm sm:col-span-2">
                <span className="font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">Description</span>
                <textarea
                  className="mt-1 w-full min-h-[80px] border border-[#1A222B] bg-[#0F1419] px-3 py-2 text-[#E8EEF2] touch-manipulation"
                  value={project.description}
                  onChange={(e) => updateProject({ description: e.target.value })}
                />
              </label>
            </div>
          </CommandCard>

          <GeneratorRuleLinter issues={lintIssues} />

          <CommandCard label="LAYERS // upload PNGs per category">
            <p className="mb-4 text-sm text-[#9BA8B4]">
              Transparent PNGs stacked bottom → top. Set rarity weight per trait (higher = more common in random
              generation).
            </p>
            <div className="space-y-6">
              {categoriesSorted.map((cat) => {
                const traits = traitsByCategory.get(cat.id) ?? []
                return (
                  <div key={cat.id} className="border border-[#1A222B] bg-[#0F1419]/60 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="flex items-center gap-2 font-bold text-[#F4FBF8]">
                        <Layers className="h-4 w-4 text-[#00FF9C]" aria-hidden />
                        {cat.name}
                        <span className="font-mono text-[10px] font-normal text-[#5C6773]">z{cat.zIndex}</span>
                      </h3>
                      <label className="inline-flex min-h-[44px] cursor-pointer touch-manipulation items-center gap-2 border border-[#00FF9C]/35 bg-[#00FF9C]/10 px-4 text-xs font-bold uppercase tracking-wide text-[#E8FDF4] hover:bg-[#00FF9C]/16">
                        <Upload className="h-4 w-4" aria-hidden />
                        Add PNGs
                        <input
                          type="file"
                          accept="image/png,image/webp,image/jpeg"
                          multiple
                          className="sr-only"
                          onChange={(e) => {
                            void addTraitFiles(cat.id, e.target.files)
                            e.target.value = ''
                          }}
                        />
                      </label>
                    </div>
                    {traits.length ? (
                      <ul className="mt-4 grid gap-3 sm:grid-cols-2">
                        {traits.map((t) => {
                          const pct = traitRarityPercent(t, traits)
                          return (
                            <li
                              key={t.id}
                              className={cn(
                                'border p-2',
                                selection[cat.id] === t.id
                                  ? 'border-[#00FF9C]/50 bg-[#00FF9C]/8'
                                  : 'border-[#1A222B]'
                              )}
                            >
                              <div className="flex items-start gap-2">
                                <button
                                  type="button"
                                  className="flex min-h-[44px] flex-1 touch-manipulation items-center gap-3 text-left"
                                  onClick={() => setSelection((s) => ({ ...s, [cat.id]: t.id }))}
                                >
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img
                                    src={t.imageSrc}
                                    alt=""
                                    className="h-12 w-12 shrink-0 border border-[#1A222B] bg-[#10161C] object-contain"
                                  />
                                  <span className="min-w-0 flex-1">
                                    <span className="block truncate text-sm font-semibold text-[#E8EEF2]">{t.name}</span>
                                    <span className="font-mono text-[10px] text-[#00C97A]">{pct.toFixed(1)}% in {cat.name}</span>
                                  </span>
                                </button>
                                <button
                                  type="button"
                                  aria-label={`Remove ${t.name}`}
                                  className="inline-flex min-h-[44px] min-w-[44px] touch-manipulation items-center justify-center text-[#9BA8B4] hover:text-red-400"
                                  onClick={() => removeTrait(t.id)}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              </div>
                              <label className="mt-2 flex items-center gap-2 text-xs">
                                <span className="font-mono text-[10px] uppercase text-[#5C6773]">Weight</span>
                                <input
                                  type="number"
                                  min={0}
                                  max={10000}
                                  className="min-h-[44px] w-full border border-[#1A222B] bg-[#0F1419] px-2 text-[#E8EEF2] touch-manipulation"
                                  value={t.weight}
                                  onChange={(e) => updateTraitWeight(t.id, Number(e.target.value))}
                                />
                              </label>
                            </li>
                          )
                        })}
                      </ul>
                    ) : (
                      <p className="mt-3 font-mono text-xs text-[#5C6773]">No traits yet — upload PNG layers.</p>
                    )}
                  </div>
                )
              })}
            </div>
          </CommandCard>

          <RulesSection
            project={project}
            onAddRule={addRule}
            onAddIfPoolRule={addIfPoolRule}
            onRemoveRule={(id) => updateProject({ rules: project.rules.filter((r) => r.id !== id) })}
          />
        </div>

        <aside className="space-y-6 lg:sticky lg:top-20 lg:self-start">
          <GeneratorCloudSavePanel
            project={project}
            cloudUpdatedAt={cloudUpdatedAt}
            cloudBusy={cloudBusy}
            cloudError={cloudError}
            signedIn={signedIn}
            onSaveCloud={() => void saveProjectToCloud(project)}
            onLoadCloud={() =>
              void (async () => {
                const cloud = await fetchCloudProject()
                if (cloud) {
                  setProject(cloud)
                  setSelection({})
                  setMessage('Loaded from cloud')
                } else setCloudError('No cloud project found')
              })()
            }
            onCheckSession={() => void fetchCloudProject()}
          />

          <CommandCard label="PREVIEW // composite">
            <div className="flex flex-wrap gap-2">
              <DeployButton variant="ghost" onClick={randomizePreview} className="gap-2">
                <Shuffle className="h-4 w-4" aria-hidden />
                Randomize
              </DeployButton>
            </div>
            <div className="mt-4 aspect-square w-full border border-[#1A222B] bg-[#0B0F12]">
              {previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={previewUrl} alt="Composite preview" className="h-full w-full object-contain" />
              ) : (
                <div className="flex h-full items-center justify-center p-4 text-center text-sm text-[#5C6773]">
                  {previewError ?? 'Select traits or randomize to preview'}
                </div>
              )}
            </div>
            {selectionError ? (
              <p className="mt-3 text-sm text-amber-400/90">{selectionError}</p>
            ) : selectedTraits.length ? (
              <ul className="mt-3 space-y-1 text-xs text-[#9BA8B4]">
                {selectedTraits.map((t) => {
                  const cat = project.categories.find((c) => c.id === t.categoryId)
                  return (
                    <li key={t.id}>
                      {cat?.name}: <span className="text-[#E8EEF2]">{t.name}</span>
                    </li>
                  )
                })}
              </ul>
            ) : null}
          </CommandCard>

          <CommandCard label="EXPORT // Sugar batch">
            <p className="text-sm text-[#9BA8B4]">
              Unique DNA combos respecting weights and rules. Blocked while linter reports errors.
            </p>
            <label className="mt-4 block text-sm">
              <span className="font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">Batch size (max 50)</span>
              <input
                type="number"
                min={1}
                max={50}
                className="mt-1 w-full min-h-[44px] border border-[#1A222B] bg-[#0F1419] px-3 text-[#E8EEF2] touch-manipulation"
                value={batchSize}
                onChange={(e) => setBatchSize(Number(e.target.value) || 5)}
              />
            </label>
            <DeployButton
              className="mt-4 w-full"
              disabled={exportBusy || !project.traits.length || lintBlocked}
              onClick={() => void handleExport()}
            >
              {exportBusy ? 'Exporting…' : 'Download Sugar ZIP'}
            </DeployButton>
            <DeployButton
              variant="ghost"
              className="mt-3 w-full gap-2"
              disabled={lintBlocked || !project.traits.length}
              onClick={handleLaunchHandoff}
            >
              <Rocket className="h-4 w-4" aria-hidden />
              Submit to Owl Center launch
            </DeployButton>
          </CommandCard>
        </aside>
      </div>

      <Dialog open={resetConfirmOpen} onOpenChange={setResetConfirmOpen}>
        <DialogContent className="border-[#1A222B] bg-[#0F1419] text-[#E8EEF2] sm:max-w-md [&>button]:text-[#9BA8B4] [&>button]:hover:text-[#E8EEF2]">
          <DialogHeader className="text-left">
            <DialogTitle className="text-lg text-[#E8EEF2]">Reset project?</DialogTitle>
            <DialogDescription className="text-sm text-[#9BA8B4]">
              Clear all layers and rules? This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-end">
            <DeployButton variant="ghost" className="w-full sm:w-auto" onClick={() => setResetConfirmOpen(false)}>
              Cancel
            </DeployButton>
            <DeployButton
              className="w-full border-red-500/40 bg-red-500/10 text-red-200 shadow-none hover:bg-red-500/18 sm:w-auto"
              onClick={() => void handleResetProject()}
            >
              Reset project
            </DeployButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </OwlCenterShell>
  )
}

function RulesSection({
  project,
  onAddRule,
  onAddIfPoolRule,
  onRemoveRule,
}: {
  project: GeneratorProject
  onAddRule: (type: CompatibilityRuleType, traitIds: string[]) => void
  onAddIfPoolRule: (whenTraitId: string, targetCategoryId: string, allowedTraitIds: string[]) => void
  onRemoveRule: (id: string) => void
}) {
  const [ruleType, setRuleType] = useState<CompatibilityRuleType>('require')
  const [picked, setPicked] = useState<string[]>([])
  const [ifTrigger, setIfTrigger] = useState<string | null>(null)
  const [ifTargetCategory, setIfTargetCategory] = useState<string | null>(null)
  const [ifAllowed, setIfAllowed] = useState<string[]>([])

  const traitLabel = (id: string) => project.traits.find((t) => t.id === id)?.name ?? id.slice(0, 8)
  const categoryLabel = (id: string) => project.categories.find((c) => c.id === id)?.name ?? 'Layer'

  const traitsForIfCategory = ifTargetCategory
    ? project.traits.filter((t) => t.categoryId === ifTargetCategory)
    : []

  const comboRules = project.rules.filter((r) => r.type !== 'if_pool')
  const ifPoolRules = project.rules.filter((r) => r.type === 'if_pool')

  return (
    <>
      <CommandCard label="RULES // trait pairing">
        <p className="mb-4 text-sm text-[#9BA8B4]">
          <strong className="font-normal text-[#E8EEF2]">Require</strong> — linked traits must appear together.{' '}
          <strong className="font-normal text-[#E8EEF2]">Exclude</strong> — cannot combine.{' '}
          <strong className="font-normal text-[#E8EEF2]">Lock set</strong> — all or none.
        </p>

        {project.traits.length >= 2 ? (
          <div className="mb-4 flex flex-wrap gap-2">
            {(['require', 'exclude', 'lock_set'] as const).map((t) => (
              <button
                key={t}
                type="button"
                className={cn(
                  'min-h-[44px] touch-manipulation border px-3 font-mono text-[10px] font-bold uppercase tracking-widest',
                  ruleType === t
                    ? 'border-[#00FF9C]/45 bg-[#00FF9C]/12 text-[#E8FDF4]'
                    : 'border-[#1A222B] text-[#9BA8B4] hover:border-[#00FF9C]/30'
                )}
                onClick={() => setRuleType(t)}
              >
                {t.replace('_', ' ')}
              </button>
            ))}
          </div>
        ) : null}

        {project.traits.length >= 2 ? (
          <div className="mb-4 flex flex-wrap gap-2">
            {project.traits.map((t) => {
              const active = picked.includes(t.id)
              const cat = project.categories.find((c) => c.id === t.categoryId)?.name
              return (
                <button
                  key={t.id}
                  type="button"
                  className={cn(
                    'min-h-[44px] touch-manipulation border px-3 text-xs',
                    active
                      ? 'border-[#00FF9C]/45 bg-[#00FF9C]/12 text-[#E8FDF4]'
                      : 'border-[#1A222B] text-[#9BA8B4] hover:border-[#00FF9C]/30'
                  )}
                  onClick={() =>
                    setPicked((p) => (p.includes(t.id) ? p.filter((x) => x !== t.id) : [...p, t.id]))
                  }
                >
                  {cat}: {t.name}
                </button>
              )
            })}
          </div>
        ) : (
          <p className="font-mono text-xs text-[#5C6773]">Add at least 2 traits to create rules.</p>
        )}

        <DeployButton
          variant="ghost"
          className="gap-2"
          disabled={picked.length < 2}
          onClick={() => {
            onAddRule(ruleType, picked)
            setPicked([])
          }}
        >
          <Link2 className="h-4 w-4" aria-hidden />
          Add pairing rule
        </DeployButton>

        {comboRules.length ? (
          <ul className="mt-6 space-y-2">
            {comboRules.map((r) => (
              <li
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-2 border border-[#1A222B] bg-[#0F1419]/80 px-3 py-2 text-sm"
              >
                <span className="text-[#C5D0D8]">
                  <span className="font-mono text-[10px] uppercase text-[#00C97A]">{r.type.replace('_', ' ')}</span>
                  {' · '}
                  {(r.traitIds ?? []).map(traitLabel).join(' + ')}
                </span>
                <button
                  type="button"
                  aria-label="Remove rule"
                  className="inline-flex min-h-[44px] min-w-[44px] touch-manipulation items-center justify-center text-[#9BA8B4] hover:text-red-400"
                  onClick={() => onRemoveRule(r.id)}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </CommandCard>

      <CommandCard label="RULES // IF → pool (conditional)">
        <p className="mb-4 text-sm text-[#9BA8B4]">
          <strong className="font-normal text-[#E8EEF2]">IF</strong> a trigger trait is selected,{' '}
          <strong className="font-normal text-[#E8EEF2]">THEN</strong> another layer only rolls from the allowed
          subset — e.g. Cyber Base → only cyber hats, or no-mouth variants.
        </p>

        {project.traits.length >= 2 ? (
          <div className="space-y-4">
            <div>
              <span className="font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">1. Trigger trait (IF)</span>
              <div className="mt-2 flex flex-wrap gap-2">
                {project.traits.map((t) => {
                  const cat = project.categories.find((c) => c.id === t.categoryId)?.name
                  const active = ifTrigger === t.id
                  return (
                    <button
                      key={t.id}
                      type="button"
                      className={cn(
                        'min-h-[44px] touch-manipulation border px-3 text-xs',
                        active
                          ? 'border-[#00FF9C]/45 bg-[#00FF9C]/12 text-[#E8FDF4]'
                          : 'border-[#1A222B] text-[#9BA8B4] hover:border-[#00FF9C]/30'
                      )}
                      onClick={() => {
                        setIfTrigger(t.id)
                        if (ifTargetCategory === t.categoryId) {
                          setIfTargetCategory(null)
                          setIfAllowed([])
                        }
                      }}
                    >
                      {cat}: {t.name}
                    </button>
                  )
                })}
              </div>
            </div>

            <div>
              <span className="font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">2. Target layer (THEN)</span>
              <div className="mt-2 flex flex-wrap gap-2">
                {project.categories.map((cat) => {
                  const triggerCat = ifTrigger
                    ? project.traits.find((t) => t.id === ifTrigger)?.categoryId
                    : null
                  const disabled = !ifTrigger || cat.id === triggerCat
                  return (
                    <button
                      key={cat.id}
                      type="button"
                      disabled={disabled}
                      className={cn(
                        'min-h-[44px] touch-manipulation border px-3 font-mono text-[10px] font-bold uppercase tracking-widest',
                        ifTargetCategory === cat.id
                          ? 'border-[#00FF9C]/45 bg-[#00FF9C]/12 text-[#E8FDF4]'
                          : 'border-[#1A222B] text-[#9BA8B4] hover:border-[#00FF9C]/30',
                        disabled && 'cursor-not-allowed opacity-40'
                      )}
                      onClick={() => {
                        setIfTargetCategory(cat.id)
                        setIfAllowed([])
                      }}
                    >
                      {cat.name}
                    </button>
                  )
                })}
              </div>
            </div>

            {ifTargetCategory && traitsForIfCategory.length ? (
              <div>
                <span className="font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">
                  3. Allowed traits only
                </span>
                <div className="mt-2 flex flex-wrap gap-2">
                  {traitsForIfCategory.map((t) => {
                    const active = ifAllowed.includes(t.id)
                    return (
                      <button
                        key={t.id}
                        type="button"
                        className={cn(
                          'min-h-[44px] touch-manipulation border px-3 text-xs',
                          active
                            ? 'border-[#00FF9C]/45 bg-[#00FF9C]/12 text-[#E8FDF4]'
                            : 'border-[#1A222B] text-[#9BA8B4] hover:border-[#00FF9C]/30'
                        )}
                        onClick={() =>
                          setIfAllowed((p) =>
                            p.includes(t.id) ? p.filter((x) => x !== t.id) : [...p, t.id]
                          )
                        }
                      >
                        {t.name}
                      </button>
                    )
                  })}
                </div>
              </div>
            ) : ifTargetCategory ? (
              <p className="font-mono text-xs text-[#5C6773]">Upload traits to this layer first.</p>
            ) : null}

            <DeployButton
              variant="ghost"
              className="gap-2"
              disabled={!ifTrigger || !ifTargetCategory || ifAllowed.length < 1}
              onClick={() => {
                if (!ifTrigger || !ifTargetCategory) return
                onAddIfPoolRule(ifTrigger, ifTargetCategory, ifAllowed)
                setIfTrigger(null)
                setIfTargetCategory(null)
                setIfAllowed([])
              }}
            >
              <Link2 className="h-4 w-4" aria-hidden />
              Add IF rule
            </DeployButton>
          </div>
        ) : (
          <p className="font-mono text-xs text-[#5C6773]">Add at least 2 traits to create IF rules.</p>
        )}

        {ifPoolRules.length ? (
          <ul className="mt-6 space-y-2">
            {ifPoolRules.map((r) => (
              <li
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-2 border border-[#1A222B] bg-[#0F1419]/80 px-3 py-2 text-sm"
              >
                <span className="text-[#C5D0D8]">
                  <span className="font-mono text-[10px] uppercase text-[#00C97A]">if pool</span>
                  {' · '}
                  IF {traitLabel(r.whenTraitId!)} → {categoryLabel(r.targetCategoryId!)}:{' '}
                  {(r.allowedTraitIds ?? []).map(traitLabel).join(', ')}
                </span>
                <button
                  type="button"
                  aria-label="Remove rule"
                  className="inline-flex min-h-[44px] min-w-[44px] touch-manipulation items-center justify-center text-[#9BA8B4] hover:text-red-400"
                  onClick={() => onRemoveRule(r.id)}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </CommandCard>
    </>
  )
}
