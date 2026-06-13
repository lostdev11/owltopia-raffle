'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Layers, Link2, Plus, Rocket, Shuffle, Sparkles, Trash2, Upload } from 'lucide-react'
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
import { GeneratorStageUploadPanel } from '@/components/owl-center/generator/GeneratorStageUploadPanel'
import { GeneratorCloudSavePanel } from '@/components/owl-center/generator/GeneratorCloudSavePanel'
import { GeneratorRuleLinter } from '@/components/owl-center/generator/GeneratorRuleLinter'
import { GeneratorSupplySimulator } from '@/components/owl-center/generator/GeneratorSupplySimulator'
import { OwlCenterShell } from '@/components/owl-center/OwlCenterShell'
import { canvasToDataUrl, compositeTraitsToCanvas } from '@/lib/owl-center/generator/composite'
import {
  createDemoProject,
  createEmptyProject,
  ensureDefaultCategories,
  projectMissingDefaultLayers,
} from '@/lib/owl-center/generator/demo-project'
import { exportBatchAsSugarZip } from '@/lib/owl-center/generator/export-zip'
import { generateBatch } from '@/lib/owl-center/generator/generate-batch'
import { buildLaunchDraft, saveExportMetaToSession, saveGeneratorProjectIdToSession, saveLaunchDraftToSession } from '@/lib/owl-center/generator/launch-draft'
import {
  DEFAULT_ONE_OF_ONE_TRAIT_TYPE,
  defaultTraitValueFromFilename,
  generativeCountForSupply,
  mergeOneOfOnesIntoCollection,
  oneOfOnesForProject,
} from '@/lib/owl-center/generator/one-of-one'
import { hasBlockingLintIssues, lintGeneratorProject } from '@/lib/owl-center/generator/lint-rules'
import {
  clampTraitWeight,
  estimateMaxUniqueSupply,
  traitRarityPercent,
} from '@/lib/owl-center/generator/rarity'
import {
  addCategoryToProject,
  MAX_TRAIT_CATEGORIES,
  removeCategoryFromProject,
  renameCategoryInProject,
  setCategoryAllowMultiple,
} from '@/lib/owl-center/generator/categories'
import { formatIfChainLabel, normalizeIfChainSteps } from '@/lib/owl-center/generator/if-chain'
import {
  clearTraitFromSelection,
  isTraitSelected,
  toggleCategoryTrait,
} from '@/lib/owl-center/generator/selection'
import {
  randomSelection,
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
  OneOfOneEntry,
  OneOfOnePlacement,
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
  const [exportFullBusy, setExportFullBusy] = useState(false)
  const [lastExportZip, setLastExportZip] = useState<{ blob: Blob; filename: string } | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [signedIn, setSignedIn] = useState<boolean | null>(null)
  const [cloudUpdatedAt, setCloudUpdatedAt] = useState<string | null>(null)
  const [cloudBusy, setCloudBusy] = useState(false)
  const [cloudError, setCloudError] = useState<string | null>(null)
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false)
  const [newLayerName, setNewLayerName] = useState('')
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
      setProject(ensureDefaultCategories(chosen))
      setLoading(false)
    })()
  }, [fetchCloudProject])

  useEffect(() => {
    if (!project || loading) return
    if (!projectMissingDefaultLayers(project)) return
    setProject(ensureDefaultCategories(project))
  }, [project, loading])

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
  const targetSupply = project?.targetSupply ?? 2000
  const oneOfOnes = project ? oneOfOnesForProject(project) : []
  const oneOfOnePlacement = project?.oneOfOnePlacement ?? 'random'

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

  const traitById = useMemo(
    () => (project ? new Map(project.traits.map((t) => [t.id, t])) : undefined),
    [project]
  )

  const selectedTraits = useMemo(
    () => (project ? traitsForSelection(project.traits, selection, project.categories) : []),
    [project, selection]
  )

  const selectionError = useMemo(
    () =>
      project && traitById
        ? validateSelection(selection, project.rules, traitById, project.categories)
        : null,
    [project, selection, traitById]
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

  const handleRenameCategory = useCallback(
    (categoryId: string, name: string) => {
      if (!project) return
      updateProject(renameCategoryInProject(project, categoryId, name))
    },
    [project, updateProject]
  )

  const handleToggleCategoryMulti = useCallback(
    (categoryId: string, allowMultiple: boolean) => {
      if (!project) return
      updateProject(setCategoryAllowMultiple(project, categoryId, allowMultiple))
    },
    [project, updateProject]
  )

  const handleAddCategory = useCallback(() => {
    if (!project || !newLayerName.trim()) return
    const result = addCategoryToProject(project, newLayerName)
    if ('error' in result) {
      setMessage(result.error)
      return
    }
    updateProject(result)
    setNewLayerName('')
    setMessage(`Added layer "${result.categories[result.categories.length - 1]?.name}"`)
  }, [project, newLayerName, updateProject])

  const handleRemoveCategory = useCallback(
    (categoryId: string) => {
      if (!project) return
      const result = removeCategoryFromProject(project, categoryId)
      if ('error' in result) {
        setMessage(result.error)
        return
      }
      updateProject(result)
      setSelection((s) => {
        const next = { ...s }
        delete next[categoryId]
        return next
      })
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
          if (r.type === 'if_chain') {
            const steps = normalizeIfChainSteps(r)
              .map((s) => ({ traitIds: s.traitIds.filter((id) => id !== traitId) }))
              .filter((s) => s.traitIds.length)
            const total = steps.reduce((n, s) => n + s.traitIds.length, 0)
            if (steps.length >= 2 && total >= 2) {
              acc.push({ ...r, chainSteps: steps, chainTraitIds: undefined })
            }
            return acc
          }
          const traitIds = (r.traitIds ?? []).filter((id) => id !== traitId)
          if (traitIds.length >= 2) acc.push({ ...r, traitIds })
          return acc
        }, []),
      })
      setSelection((s) => {
        const removed = project.traits.find((t) => t.id === traitId)
        if (!removed) return s
        return clearTraitFromSelection(s, traitId, removed.categoryId)
      })
    },
    [project, updateProject]
  )

  const randomizePreview = useCallback(() => {
    if (!project) return
    const next = randomSelection(project.categories, project.traits, project.rules)
    if (!next) {
      setMessage('No valid combo found — check IF rules are set both ways for exclusive pairs')
      return
    }
    setMessage(null)
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
    (
      whenTraitId: string,
      targetCategoryId: string,
      allowedTraitIds: string[],
      options?: { alsoReverse?: boolean }
    ) => {
      if (!project || !whenTraitId || !targetCategoryId || allowedTraitIds.length < 1) return
      const whenTrait = project.traits.find((t) => t.id === whenTraitId)
      const targetCat = project.categories.find((c) => c.id === targetCategoryId)
      const allowedNames = allowedTraitIds
        .map((id) => project.traits.find((t) => t.id === id)?.name)
        .filter(Boolean)
        .join(', ')
      const newRules: CompatibilityRule[] = [
        {
          id: uid(),
          type: 'if_pool',
          whenTraitId,
          targetCategoryId,
          allowedTraitIds,
          label: `IF ${whenTrait?.name ?? 'trait'} → ${targetCat?.name ?? 'layer'}: ${allowedNames}`,
        },
      ]

      if (options?.alsoReverse && whenTrait) {
        const reverseTargetCat = project.categories.find((c) => c.id === whenTrait.categoryId)
        for (const allowedId of allowedTraitIds) {
          const allowedTrait = project.traits.find((t) => t.id === allowedId)
          if (!allowedTrait) continue
          newRules.push({
            id: uid(),
            type: 'if_pool',
            whenTraitId: allowedId,
            targetCategoryId: whenTrait.categoryId,
            allowedTraitIds: [whenTraitId],
            label: `IF ${allowedTrait.name} → ${reverseTargetCat?.name ?? 'layer'}: ${whenTrait.name}`,
          })
        }
      }

      updateProject({ rules: [...project.rules, ...newRules] })
    },
    [project, updateProject]
  )

  const addIfChainRule = useCallback(
    (chainStepGroups: { traitIds: string[]; stackAll?: boolean }[]) => {
      const steps = chainStepGroups.filter((s) => s.traitIds.length > 0)
      if (!project || steps.length < 2) return
      const traitById = new Map(project.traits.map((t) => [t.id, t]))
      const label = formatIfChainLabel(
        steps,
        traitById,
        (catId) => project.categories.find((c) => c.id === catId)?.name ?? 'Layer',
        project.categories
      )
      const rule: CompatibilityRule = {
        id: uid(),
        type: 'if_chain',
        chainSteps: steps,
        label: `Chain: ${label}`,
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

  const addOneOfOneFiles = useCallback(
    async (files: FileList | null) => {
      if (!project || !files?.length) return
      const added: OneOfOneEntry[] = []
      for (const file of Array.from(files)) {
        if (!file.type.startsWith('image/')) continue
        const imageSrc = await fileToDataUrl(file)
        added.push({
          id: uid(),
          imageSrc,
          traitType: DEFAULT_ONE_OF_ONE_TRAIT_TYPE,
          traitValue: defaultTraitValueFromFilename(file.name),
        })
      }
      if (!added.length) return
      updateProject({ oneOfOnes: [...oneOfOnesForProject(project), ...added] })
      setMessage(`Added ${added.length} 1/1 image(s)`)
    },
    [project, updateProject]
  )

  const updateOneOfOne = useCallback(
    (entryId: string, patch: Partial<Pick<OneOfOneEntry, 'traitType' | 'traitValue'>>) => {
      if (!project) return
      updateProject({
        oneOfOnes: oneOfOnesForProject(project).map((o) =>
          o.id === entryId ? { ...o, ...patch } : o
        ),
      })
    },
    [project, updateProject]
  )

  const removeOneOfOne = useCallback(
    (entryId: string) => {
      if (!project) return
      updateProject({
        oneOfOnes: oneOfOnesForProject(project).filter((o) => o.id !== entryId),
      })
    },
    [project, updateProject]
  )

  const exportMergedBatch = useCallback(
    async (generativeCount: number, label: string): Promise<number | null> => {
      if (!project) return null
      if (lintBlocked) {
        setMessage('Fix linter errors before exporting')
        return null
      }
      const entries = oneOfOnesForProject(project)
      if (generativeCount > 0 && !project.traits.length) {
        setMessage('Add trait layers before exporting generative pieces')
        return null
      }
      const generative =
        generativeCount > 0 ? generateBatch(project, generativeCount, { requireAllCategories: true }) : []
      const batch = mergeOneOfOnesIntoCollection(
        generative,
        entries,
        project.oneOfOnePlacement,
        project.id
      )
      const built = await exportBatchAsSugarZip(project, batch)
      setLastExportZip({ blob: built.blob, filename: built.filename })
      setMessage(`Exported ${built.count} Sugar-ready asset(s) (${label})`)
      return built.count
    },
    [project, lintBlocked]
  )

  const handleExport = useCallback(async () => {
    if (!project) return
    setExportBusy(true)
    setMessage(null)
    try {
      const entries = oneOfOnesForProject(project)
      const totalRequested = Math.min(50, Math.max(1, batchSize))
      const generativeCount = Math.max(0, totalRequested - entries.length)
      await exportMergedBatch(generativeCount, `${totalRequested} preview batch`)
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Export failed')
    } finally {
      setExportBusy(false)
    }
  }, [project, batchSize, exportMergedBatch])

  const handleExportFullSupply = useCallback(async () => {
    if (!project) return
    setExportFullBusy(true)
    setMessage(null)
    try {
      const entries = oneOfOnesForProject(project)
      const generativeCount = generativeCountForSupply(targetSupply, entries.length)
      if (generativeCount <= 0 && !entries.length) {
        setMessage('Set target supply or add 1/1 images before exporting')
        return
      }
      const count = await exportMergedBatch(generativeCount, `full supply ${targetSupply.toLocaleString()}`)
      if (count != null) {
        saveExportMetaToSession({
          exported_count: count,
          full_supply: true,
          exported_at: new Date().toISOString(),
        })
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Full export failed')
    } finally {
      setExportFullBusy(false)
    }
  }, [project, targetSupply, exportMergedBatch])

  const handleLaunchHandoff = useCallback(() => {
    if (!project) return
    if (lintBlocked) {
      setMessage('Fix linter errors before submitting to launch')
      return
    }
    const draft = buildLaunchDraft(project)
    saveLaunchDraftToSession(draft)
    saveGeneratorProjectIdToSession(project.id)
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

          <CommandCard label="1/1 // unique pieces">
            <p className="mb-4 text-sm text-[#9BA8B4]">
              Upload hand-drawn 1/1 art that uses the same Sugar metadata as generative pieces, with a custom trait
              (Gen1 example: <strong className="font-normal text-[#E8EEF2]">Special: The Widow King</strong>). 1/1s
              occupy slots in target supply — they are not added on top.
            </p>
            <div className="mb-4 flex flex-wrap items-end gap-3">
              <label className="block min-w-[200px] flex-1 text-sm">
                <span className="font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">
                  1/1 placement
                </span>
                <select
                  className="mt-1 w-full min-h-[44px] border border-[#1A222B] bg-[#0F1419] px-3 text-[#E8EEF2] touch-manipulation"
                  value={oneOfOnePlacement}
                  onChange={(e) =>
                    updateProject({ oneOfOnePlacement: e.target.value as OneOfOnePlacement })
                  }
                >
                  <option value="start">At the start</option>
                  <option value="end">At the end</option>
                  <option value="random">Randomly</option>
                </select>
              </label>
              <label className="inline-flex min-h-[44px] cursor-pointer touch-manipulation items-center gap-2 border border-[#00FF9C]/35 bg-[#00FF9C]/10 px-4 text-xs font-bold uppercase tracking-wide text-[#E8FDF4] hover:bg-[#00FF9C]/16">
                <Upload className="h-4 w-4" aria-hidden />
                Upload 1/1 PNGs
                <input
                  type="file"
                  accept="image/png,image/webp,image/jpeg"
                  multiple
                  className="sr-only"
                  onChange={(e) => {
                    void addOneOfOneFiles(e.target.files)
                    e.target.value = ''
                  }}
                />
              </label>
            </div>
            {oneOfOnes.length ? (
              <ul className="grid gap-3 sm:grid-cols-2">
                {oneOfOnes.map((entry) => (
                  <li key={entry.id} className="border border-[#1A222B] bg-[#0F1419]/60 p-3">
                    <div className="flex items-start gap-3">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={entry.imageSrc}
                        alt=""
                        className="h-16 w-16 shrink-0 border border-[#1A222B] bg-[#10161C] object-contain"
                      />
                      <div className="min-w-0 flex-1 space-y-2">
                        <label className="block text-xs">
                          <span className="font-mono text-[10px] uppercase text-[#5C6773]">Trait type</span>
                          <input
                            className="mt-1 w-full min-h-[44px] border border-[#1A222B] bg-[#0B0F12] px-2 text-[#E8EEF2] touch-manipulation"
                            value={entry.traitType}
                            onChange={(e) => updateOneOfOne(entry.id, { traitType: e.target.value })}
                            placeholder="Special"
                          />
                        </label>
                        <label className="block text-xs">
                          <span className="font-mono text-[10px] uppercase text-[#5C6773]">Trait value</span>
                          <input
                            className="mt-1 w-full min-h-[44px] border border-[#1A222B] bg-[#0B0F12] px-2 text-[#E8EEF2] touch-manipulation"
                            value={entry.traitValue}
                            onChange={(e) => updateOneOfOne(entry.id, { traitValue: e.target.value })}
                            placeholder="The Widow King"
                          />
                        </label>
                      </div>
                      <button
                        type="button"
                        aria-label="Remove 1/1"
                        className="inline-flex min-h-[44px] min-w-[44px] touch-manipulation items-center justify-center text-[#9BA8B4] hover:text-red-400"
                        onClick={() => removeOneOfOne(entry.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="font-mono text-xs text-[#5C6773]">
                No 1/1 images yet — drag PNGs here or use Upload 1/1 PNGs.
              </p>
            )}
            {oneOfOnes.length && targetSupply ? (
              <p className="mt-3 font-mono text-[10px] text-[#5C6773]">
                {oneOfOnes.length} 1/1 slot(s) · {generativeCountForSupply(targetSupply, oneOfOnes.length).toLocaleString()}{' '}
                generative pieces → {targetSupply.toLocaleString()} total
              </p>
            ) : null}
          </CommandCard>

          <GeneratorRuleLinter issues={lintIssues} />

          <CommandCard label="LAYERS // upload PNGs per category">
            <p className="mb-4 text-sm text-[#9BA8B4]">
              Rename layers, add up to {MAX_TRAIT_CATEGORIES} sections (3 or 10+), stack bottom → top. Enable{' '}
              <strong className="font-normal text-[#E8EEF2]">Multi stack</strong> to select multiple traits in one
              layer (e.g. Glasses).
            </p>
            <div className="space-y-6">
              {categoriesSorted.map((cat) => {
                const traits = traitsByCategory.get(cat.id) ?? []
                return (
                  <div key={cat.id} className="border border-[#1A222B] bg-[#0F1419]/60 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                        <Layers className="h-4 w-4 shrink-0 text-[#00FF9C]" aria-hidden />
                        <input
                          className="min-h-[44px] min-w-[120px] flex-1 border border-[#1A222B] bg-[#0B0F12] px-3 text-sm font-bold text-[#F4FBF8] touch-manipulation"
                          value={cat.name}
                          onChange={(e) => handleRenameCategory(cat.id, e.target.value)}
                          aria-label="Layer name"
                        />
                        <span className="font-mono text-[10px] text-[#5C6773]">z{cat.zIndex}</span>
                        <label className="flex min-h-[44px] cursor-pointer items-center gap-2 text-xs text-[#9BA8B4] touch-manipulation">
                          <input
                            type="checkbox"
                            className="h-4 w-4 accent-[#00FF9C]"
                            checked={Boolean(cat.allowMultiple)}
                            onChange={(e) => handleToggleCategoryMulti(cat.id, e.target.checked)}
                          />
                          Multi stack
                        </label>
                        {!traits.length ? (
                          <button
                            type="button"
                            aria-label={`Remove empty layer ${cat.name}`}
                            className="inline-flex min-h-[44px] min-w-[44px] touch-manipulation items-center justify-center text-[#9BA8B4] hover:text-red-400"
                            onClick={() => handleRemoveCategory(cat.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        ) : null}
                      </div>
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
                                isTraitSelected(selection, cat.id, t.id)
                                  ? 'border-[#00FF9C]/50 bg-[#00FF9C]/8'
                                  : 'border-[#1A222B]'
                              )}
                            >
                              <div className="flex items-start gap-2">
                                <button
                                  type="button"
                                  className="flex min-h-[44px] flex-1 touch-manipulation items-center gap-3 text-left"
                                  onClick={() =>
                                    setSelection((s) => toggleCategoryTrait(s, cat, t.id))
                                  }
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
            <div className="mt-6 flex flex-wrap items-end gap-2 border border-dashed border-[#1A222B] p-4">
              <label className="min-w-[160px] flex-1 text-sm">
                <span className="font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">New layer name</span>
                <input
                  className="mt-1 w-full min-h-[44px] border border-[#1A222B] bg-[#0F1419] px-3 text-[#E8EEF2] touch-manipulation"
                  placeholder="e.g. Mouth, Wings, FX"
                  value={newLayerName}
                  onChange={(e) => setNewLayerName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleAddCategory()
                  }}
                />
              </label>
              <DeployButton
                variant="ghost"
                className="gap-2"
                disabled={!newLayerName.trim() || project.categories.length >= MAX_TRAIT_CATEGORIES}
                onClick={handleAddCategory}
              >
                <Plus className="h-4 w-4" aria-hidden />
                Add layer ({project.categories.length}/{MAX_TRAIT_CATEGORIES})
              </DeployButton>
            </div>
          </CommandCard>

          <RulesSection
            project={project}
            onAddRule={addRule}
            onAddIfPoolRule={addIfPoolRule}
            onAddIfChainRule={addIfChainRule}
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
                  setProject(ensureDefaultCategories(cloud))
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

          <GeneratorSupplySimulator
            project={project}
            targetSupply={targetSupply}
            disabled={!project.traits.length}
          />

          <CommandCard label="EXPORT // Sugar batch">
            <p className="text-sm text-[#9BA8B4]">
              Unique DNA combos respecting weights and rules{oneOfOnes.length ? ` · ${oneOfOnes.length} 1/1(s) merged at export` : ''}.
              Blocked while linter reports errors.
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
              disabled={exportBusy || exportFullBusy || (!project.traits.length && !oneOfOnes.length) || lintBlocked}
              onClick={() => void handleExport()}
            >
              {exportBusy ? 'Exporting…' : 'Download Sugar ZIP (preview batch)'}
            </DeployButton>
            <DeployButton
              variant="ghost"
              className="mt-3 w-full"
              disabled={
                exportBusy ||
                exportFullBusy ||
                lintBlocked ||
                (!project.traits.length && !oneOfOnes.length) ||
                (generativeCountForSupply(targetSupply, oneOfOnes.length) <= 0 && !oneOfOnes.length)
              }
              onClick={() => void handleExportFullSupply()}
            >
              {exportFullBusy
                ? `Exporting ${targetSupply.toLocaleString()}…`
                : `Download full supply (${targetSupply.toLocaleString()})`}
            </DeployButton>
            <DeployButton
              variant="ghost"
              className="mt-3 w-full gap-2"
              disabled={lintBlocked || (!project.traits.length && !oneOfOnes.length)}
              onClick={handleLaunchHandoff}
            >
              <Rocket className="h-4 w-4" aria-hidden />
              Submit to Owl Center launch
            </DeployButton>
          </CommandCard>

          <GeneratorStageUploadPanel
            projectId={project.id}
            zipBlob={lastExportZip?.blob ?? null}
            zipFilename={lastExportZip?.filename ?? null}
          />
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
  onAddIfChainRule,
  onRemoveRule,
}: {
  project: GeneratorProject
  onAddRule: (type: CompatibilityRuleType, traitIds: string[]) => void
  onAddIfPoolRule: (
    whenTraitId: string,
    targetCategoryId: string,
    allowedTraitIds: string[],
    options?: { alsoReverse?: boolean }
  ) => void
  onAddIfChainRule: (chainStepGroups: { traitIds: string[]; stackAll?: boolean }[]) => void
  onRemoveRule: (id: string) => void
}) {
  const [ruleType, setRuleType] = useState<CompatibilityRuleType>('require')
  const [picked, setPicked] = useState<string[]>([])
  const [ifTrigger, setIfTrigger] = useState<string | null>(null)
  const [ifTargetCategory, setIfTargetCategory] = useState<string | null>(null)
  const [ifAllowed, setIfAllowed] = useState<string[]>([])
  const [ifAlsoReverse, setIfAlsoReverse] = useState(true)
  const [chainStepGroups, setChainStepGroups] = useState<
    { traitIds: string[]; stackAll?: boolean }[]
  >([])
  const [chainDraft, setChainDraft] = useState<string[]>([])
  const [chainDraftStackAll, setChainDraftStackAll] = useState(false)
  const [chainDraftCategory, setChainDraftCategory] = useState<string | null>(null)

  const traitLabel = (id: string) => project.traits.find((t) => t.id === id)?.name ?? id.slice(0, 8)
  const categoryLabel = (id: string) => project.categories.find((c) => c.id === id)?.name ?? 'Layer'

  const traitsForIfCategory = ifTargetCategory
    ? project.traits.filter((t) => t.categoryId === ifTargetCategory)
    : []

  const comboRules = project.rules.filter((r) => r.type !== 'if_pool' && r.type !== 'if_chain')
  const ifPoolRules = project.rules.filter((r) => r.type === 'if_pool')
  const ifChainRules = project.rules.filter((r) => r.type === 'if_chain')

  const chainUsedCategories = new Set([
    ...chainStepGroups.map((group) => project.traits.find((t) => t.id === group.traitIds[0])?.categoryId),
    chainDraftCategory,
  ].filter(Boolean))

  const toggleChainDraftTrait = (traitId: string, categoryId: string) => {
    if (chainUsedCategories.has(categoryId) && categoryId !== chainDraftCategory) return
    if (!chainDraftCategory) {
      setChainDraftCategory(categoryId)
      setChainDraft([traitId])
      return
    }
    if (categoryId !== chainDraftCategory) return
    setChainDraft((p) => (p.includes(traitId) ? p.filter((x) => x !== traitId) : [...p, traitId]))
  }

  const commitChainDraft = () => {
    if (!chainDraft.length) return
    setChainStepGroups((p) => [
      ...p,
      { traitIds: chainDraft, stackAll: chainDraftStackAll || undefined },
    ])
    setChainDraft([])
    setChainDraftStackAll(false)
    setChainDraftCategory(null)
  }

  const totalChainLayers = chainStepGroups.length + (chainDraft.length ? 1 : 0)

  return (
    <>
      <CommandCard label="RULES // trait pairing">
        <p className="mb-4 text-sm text-[#9BA8B4]">
          <strong className="font-normal text-[#E8EEF2]">Require</strong> — linked traits must appear together.{' '}
          <strong className="font-normal text-[#E8EEF2]">Exclude</strong> — cannot combine (pick 3+ traits in one
          exclude rule, e.g. Cyber Eyewear + every hat except No Trait).{' '}
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
          subset — e.g. Stampede Hat → only Brown Base. For exclusive pairs, enable{' '}
          <strong className="font-normal text-[#E8EEF2]">both directions</strong> and include{' '}
          <strong className="font-normal text-[#E8EEF2]">None</strong> traits where a layer can be empty.
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

            <label className="flex min-h-[44px] cursor-pointer items-center gap-2 text-sm text-[#9BA8B4] touch-manipulation">
              <input
                type="checkbox"
                className="h-4 w-4 accent-[#00FF9C]"
                checked={ifAlsoReverse}
                onChange={(e) => setIfAlsoReverse(e.target.checked)}
              />
              Also add reverse IF rules (recommended for exclusive pairs)
            </label>

            <DeployButton
              variant="ghost"
              className="gap-2"
              disabled={!ifTrigger || !ifTargetCategory || ifAllowed.length < 1}
              onClick={() => {
                if (!ifTrigger || !ifTargetCategory) return
                onAddIfPoolRule(ifTrigger, ifTargetCategory, ifAllowed, { alsoReverse: ifAlsoReverse })
                setIfTrigger(null)
                setIfTargetCategory(null)
                setIfAllowed([])
              }}
            >
              <Link2 className="h-4 w-4" aria-hidden />
              Add IF rule{ifAlsoReverse ? ' (+ reverse)' : ''}
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

      <CommandCard label="RULES // IF chain (multi-layer)">
        <p className="mb-4 text-sm text-[#9BA8B4]">
          Build layer-by-layer. Tap <strong className="font-normal text-[#E8EEF2]">multiple traits per step</strong>{' '}
          to offer options (pick one). On eyewear, enable <strong className="font-normal text-[#E8EEF2]">Stack all</strong>{' '}
          only when you want every PNG combined. Then <strong className="font-normal text-[#E8EEF2]">Next layer</strong>{' '}
          before the next category.
        </p>

        {project.traits.length >= 2 ? (
          <div className="space-y-4">
            {chainStepGroups.length || chainDraft.length ? (
              <ol className="space-y-2 border border-[#1A222B] bg-[#0F1419]/80 px-3 py-3 text-sm text-[#C5D0D8]">
                {chainStepGroups.map((group, i) => {
                  const catId = project.traits.find((tr) => tr.id === group.traitIds[0])?.categoryId
                  const cat = project.categories.find((c) => c.id === catId)
                  const joiner = group.stackAll ? ' + ' : ' / '
                  return (
                    <li key={`group-${i}`} className="flex flex-wrap items-center justify-between gap-2">
                      <span>
                        <span className="font-mono text-[10px] text-[#5C6773]">{i + 1}.</span>{' '}
                        {cat?.name}:{' '}
                        <span className="text-[#E8EEF2]">{group.traitIds.map(traitLabel).join(joiner)}</span>
                      </span>
                      <button
                        type="button"
                        aria-label="Remove chain layer"
                        className="inline-flex min-h-[44px] min-w-[44px] touch-manipulation items-center justify-center text-[#9BA8B4] hover:text-red-400"
                        onClick={() => setChainStepGroups((p) => p.filter((_, idx) => idx !== i))}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </li>
                  )
                })}
                {chainDraft.length ? (
                  <li className="flex flex-wrap items-center justify-between gap-2 border border-dashed border-[#00FF9C]/25 px-2 py-1">
                    <span>
                      <span className="font-mono text-[10px] text-[#00C97A]">{chainStepGroups.length + 1}.</span>{' '}
                      {project.categories.find((c) => c.id === chainDraftCategory)?.name}:{' '}
                      <span className="text-[#E8FDF4]">
                        {chainDraft.map(traitLabel).join(chainDraftStackAll ? ' + ' : ' / ')}
                      </span>
                    </span>
                  </li>
                ) : null}
              </ol>
            ) : (
              <p className="font-mono text-xs text-[#5C6773]">Step 1 — pick trait(s) for one layer, then Next layer.</p>
            )}

            <div>
              <span className="font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">
                {chainDraftCategory
                  ? `Current layer — ${project.categories.find((c) => c.id === chainDraftCategory)?.name}`
                  : chainStepGroups.length
                    ? `Next layer (${chainStepGroups.length + 1})`
                    : 'Step 1'}
              </span>
              <div className="mt-2 flex flex-wrap gap-2">
                {project.traits.map((t) => {
                  const cat = project.categories.find((c) => c.id === t.categoryId)
                  const layerTaken =
                    chainUsedCategories.has(t.categoryId) && t.categoryId !== chainDraftCategory
                  const active = chainDraft.includes(t.id)
                  return (
                    <button
                      key={t.id}
                      type="button"
                      disabled={layerTaken}
                      className={cn(
                        'min-h-[44px] touch-manipulation border px-3 text-xs',
                        active
                          ? 'border-[#00FF9C]/45 bg-[#00FF9C]/12 text-[#E8FDF4]'
                          : 'border-[#1A222B] text-[#9BA8B4] hover:border-[#00FF9C]/30',
                        layerTaken && 'cursor-not-allowed opacity-40'
                      )}
                      onClick={() => toggleChainDraftTrait(t.id, t.categoryId)}
                    >
                      {cat?.name}: {t.name}
                    </button>
                  )
                })}
              </div>
              {chainDraft.length > 1 &&
              project.categories.find((c) => c.id === chainDraftCategory)?.allowMultiple ? (
                <label className="mt-3 flex min-h-[44px] touch-manipulation cursor-pointer items-center gap-2 text-xs text-[#9BA8B4]">
                  <input
                    type="checkbox"
                    checked={chainDraftStackAll}
                    onChange={(e) => setChainDraftStackAll(e.target.checked)}
                    className="h-4 w-4 accent-[#00FF9C]"
                  />
                  Stack all eyewear PNGs in this step (default: pick one)
                </label>
              ) : null}
            </div>

            <div className="flex flex-wrap gap-2">
              <DeployButton
                variant="ghost"
                disabled={!chainDraft.length}
                onClick={commitChainDraft}
              >
                Next layer
              </DeployButton>
              <DeployButton
                variant="ghost"
                className="gap-2"
                disabled={totalChainLayers < 2}
                onClick={() => {
                  const groups = chainDraft.length
                    ? [
                        ...chainStepGroups,
                        { traitIds: chainDraft, stackAll: chainDraftStackAll || undefined },
                      ]
                    : chainStepGroups
                  onAddIfChainRule(groups)
                  setChainStepGroups([])
                  setChainDraft([])
                  setChainDraftStackAll(false)
                  setChainDraftCategory(null)
                }}
              >
                <Link2 className="h-4 w-4" aria-hidden />
                Add IF chain ({totalChainLayers} layers)
              </DeployButton>
              {chainStepGroups.length || chainDraft.length ? (
                <DeployButton
                  variant="ghost"
                  onClick={() => {
                    setChainStepGroups([])
                    setChainDraft([])
                    setChainDraftStackAll(false)
                    setChainDraftCategory(null)
                  }}
                >
                  Clear
                </DeployButton>
              ) : null}
            </div>
          </div>
        ) : (
          <p className="font-mono text-xs text-[#5C6773]">Add at least 2 traits to create IF chains.</p>
        )}

        {ifChainRules.length ? (
          <ul className="mt-6 space-y-2">
            {ifChainRules.map((r) => (
              <li
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-2 border border-[#1A222B] bg-[#0F1419]/80 px-3 py-2 text-sm"
              >
                <span className="text-[#C5D0D8]">
                  <span className="font-mono text-[10px] uppercase text-[#00C97A]">if chain</span>
                  {' · '}
                  {normalizeIfChainSteps(r)
                    .map((step) => {
                      const catId = project.traits.find((t) => t.id === step.traitIds[0])?.categoryId
                      const cat = project.categories.find((c) => c.id === catId)
                      const joiner = cat?.allowMultiple ? ' + ' : ' / '
                      return step.traitIds.map(traitLabel).join(joiner)
                    })
                    .join(' → ')}
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
