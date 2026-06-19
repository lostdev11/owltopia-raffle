import type { CompatibilityRule, GeneratorProject } from '@/lib/owl-center/generator/types'
import { ifChainStepCategoryId, ifChainStepMode, isNoneTraitId, normalizeIfChainSteps } from '@/lib/owl-center/generator/if-chain'
import { chainTraitIds, comboTraitIds } from '@/lib/owl-center/generator/rules'

export type RuleLintSeverity = 'error' | 'warning' | 'info'

export type RuleLintIssue = {
  severity: RuleLintSeverity
  code: string
  message: string
  ruleId?: string
  traitIds?: string[]
}

function ruleTraitKey(ids: string[]): string {
  return [...ids].sort().join('|')
}

function pairKey(a: string, b: string): string {
  return [a, b].sort().join('|')
}

function lintIfPoolRule(
  rule: CompatibilityRule,
  traitById: Map<string, GeneratorProject['traits'][number]>,
  issues: RuleLintIssue[]
): void {
  if (!rule.whenTraitId) {
    issues.push({
      severity: 'error',
      code: 'if_pool_missing_trigger',
      message: 'IF rule needs a trigger trait',
      ruleId: rule.id,
    })
    return
  }
  if (!rule.targetCategoryId) {
    issues.push({
      severity: 'error',
      code: 'if_pool_missing_category',
      message: 'IF rule needs a target category',
      ruleId: rule.id,
    })
    return
  }
  const allowed = rule.allowedTraitIds ?? []
  if (allowed.length < 1) {
    issues.push({
      severity: 'error',
      code: 'if_pool_empty_pool',
      message: 'IF rule needs at least one allowed trait in the target pool',
      ruleId: rule.id,
    })
  }

  const whenTrait = traitById.get(rule.whenTraitId)
  if (!whenTrait) {
    issues.push({
      severity: 'error',
      code: 'missing_trait',
      message: 'IF rule trigger trait was removed',
      ruleId: rule.id,
    })
  } else if (whenTrait.categoryId === rule.targetCategoryId) {
    issues.push({
      severity: 'error',
      code: 'if_pool_same_category',
      message: 'IF trigger and target pool must be in different categories',
      ruleId: rule.id,
    })
  }

  for (const id of allowed) {
    const t = traitById.get(id)
    if (!t) {
      issues.push({
        severity: 'error',
        code: 'missing_trait',
        message: 'IF rule references a trait that was removed',
        ruleId: rule.id,
      })
    } else if (t.categoryId !== rule.targetCategoryId) {
      issues.push({
        severity: 'error',
        code: 'if_pool_wrong_category',
        message: 'Allowed traits must belong to the IF rule target category',
        ruleId: rule.id,
      })
    }
  }
}

function lintIfChainRule(
  rule: CompatibilityRule,
  traitById: Map<string, GeneratorProject['traits'][number]>,
  project: GeneratorProject,
  issues: RuleLintIssue[]
): void {
  const steps = normalizeIfChainSteps(rule)
  const totalTraits = chainTraitIds(rule).length

  if (steps.length < 2 || totalTraits < 2) {
    issues.push({
      severity: 'error',
      code: 'if_chain_too_short',
      message: 'IF chain needs at least 2 layers with traits',
      ruleId: rule.id,
    })
    return
  }

  const seenCategories = new Set<string>()
  for (const step of steps) {
    if (!step.traitIds.length) {
      issues.push({
        severity: 'error',
        code: 'if_chain_empty_step',
        message: 'IF chain step cannot be empty',
        ruleId: rule.id,
      })
      continue
    }

    const catId = ifChainStepCategoryId(step, traitById)
    if (!catId) continue

    const catsInStep = new Set<string>()
    for (const id of step.traitIds) {
      const t = traitById.get(id)
      if (!t) {
        issues.push({
          severity: 'error',
          code: 'missing_trait',
          message: 'IF chain references a trait that was removed',
          ruleId: rule.id,
        })
        continue
      }
      if (t.categoryId !== catId) {
        issues.push({
          severity: 'error',
          code: 'if_chain_mixed_category',
          message: 'Each IF chain step must use traits from one layer only',
          ruleId: rule.id,
        })
      }
      catsInStep.add(t.categoryId)
    }

    if (
      ifChainStepMode(undefined, step) === 'all' &&
      step.traitIds.some((id) => isNoneTraitId(id, traitById)) &&
      step.traitIds.some((id) => !isNoneTraitId(id, traitById))
    ) {
      issues.push({
        severity: 'warning',
        code: 'if_chain_stack_all_with_none',
        message: '"No Trait" can\'t stack (+) with real traits — it will be ignored in this step. Use a pick-one (/) step if the layer can be empty.',
        ruleId: rule.id,
      })
    }

    if (seenCategories.has(catId)) {
      issues.push({
        severity: 'error',
        code: 'if_chain_duplicate_layer',
        message: 'IF chain cannot repeat the same layer — combine traits into one step',
        ruleId: rule.id,
      })
    }
    seenCategories.add(catId)
  }
}

function lintSkipLayerRule(
  rule: CompatibilityRule,
  traitById: Map<string, GeneratorProject['traits'][number]>,
  issues: RuleLintIssue[]
): void {
  if (!rule.whenTraitId) {
    issues.push({
      severity: 'error',
      code: 'skip_missing_trigger',
      message: 'Skip-layer rule needs a trigger trait',
      ruleId: rule.id,
    })
    return
  }
  if (!rule.targetCategoryId) {
    issues.push({
      severity: 'error',
      code: 'skip_missing_category',
      message: 'Skip-layer rule needs a layer to leave empty',
      ruleId: rule.id,
    })
    return
  }
  const whenTrait = traitById.get(rule.whenTraitId)
  if (!whenTrait) {
    issues.push({
      severity: 'error',
      code: 'missing_trait',
      message: 'Skip-layer trigger trait was removed',
      ruleId: rule.id,
    })
  } else if (whenTrait.categoryId === rule.targetCategoryId) {
    issues.push({
      severity: 'error',
      code: 'skip_same_layer',
      message: 'Skip-layer trigger and target layer must be different',
      ruleId: rule.id,
    })
  }
}

/** Static analysis for trait rules before batch generation. */
export function lintGeneratorProject(project: GeneratorProject): RuleLintIssue[] {
  const issues: RuleLintIssue[] = []
  const traitById = new Map(project.traits.map((t) => [t.id, t]))

  for (const rule of project.rules) {
    if (rule.type === 'if_pool') {
      lintIfPoolRule(rule, traitById, issues)
      continue
    }

    if (rule.type === 'if_chain') {
      lintIfChainRule(rule, traitById, project, issues)
      continue
    }

    if (rule.type === 'skip_layer') {
      lintSkipLayerRule(rule, traitById, issues)
      continue
    }

    const ids = comboTraitIds(rule)
    if (ids.length < 2) {
      issues.push({
        severity: 'error',
        code: 'rule_too_short',
        message: 'Rule needs at least 2 traits',
        ruleId: rule.id,
      })
    }
    for (const id of ids) {
      if (!traitById.has(id)) {
        issues.push({
          severity: 'error',
          code: 'missing_trait',
          message: 'Rule references a trait that was removed',
          ruleId: rule.id,
        })
      }
    }

    if (
      (rule.type === 'require' || rule.type === 'lock_set') &&
      ids.some((id) => isNoneTraitId(id, traitById)) &&
      ids.some((id) => !isNoneTraitId(id, traitById))
    ) {
      issues.push({
        severity: 'warning',
        code: 'require_none_use_skip',
        message:
          'Requiring a "No Trait" links it both ways (every owl with that empty layer is forced to the trigger too). To leave a layer empty when a trait is present, use a Skip-layer rule instead.',
        ruleId: rule.id,
      })
    }

    if (rule.type !== 'exclude') {
      const categoryIds = ids
        .map((id) => traitById.get(id)?.categoryId)
        .filter((c): c is string => Boolean(c))
      const seen = new Set<string>()
      const catById = new Map(project.categories.map((c) => [c.id, c]))
      for (const catId of categoryIds) {
        if (seen.has(catId)) {
          const cat = catById.get(catId)
          if (!cat?.allowMultiple) {
            issues.push({
              severity: 'error',
              code: 'same_category_link',
              message:
                'Linked traits cannot share a category unless the layer allows multiple traits (e.g. Glasses)',
              ruleId: rule.id,
            })
          }
          break
        }
        seen.add(catId)
      }
    }
  }

  const seenRules = new Map<string, string>()
  for (const rule of project.rules) {
    const key =
      rule.type === 'if_pool'
        ? `if_pool:${rule.whenTraitId}:${rule.targetCategoryId}:${ruleTraitKey(rule.allowedTraitIds ?? [])}`
        : rule.type === 'skip_layer'
          ? `skip_layer:${rule.whenTraitId}:${rule.targetCategoryId}`
          : rule.type === 'if_chain'
            ? `if_chain:${ruleTraitKey(normalizeIfChainSteps(rule).flatMap((s) => s.traitIds))}`
            : `${rule.type}:${ruleTraitKey(comboTraitIds(rule))}`
    if (seenRules.has(key)) {
      issues.push({
        severity: 'warning',
        code: 'duplicate_rule',
        message: 'Duplicate rule — consider removing one',
        ruleId: rule.id,
      })
    } else {
      seenRules.set(key, rule.id)
    }
  }

  const comboRules = project.rules.filter((r) => r.type !== 'if_pool' && r.type !== 'if_chain')
  for (let i = 0; i < comboRules.length; i++) {
    for (let j = i + 1; j < comboRules.length; j++) {
      const a = comboRules[i]
      const b = comboRules[j]
      const aIds = comboTraitIds(a)
      const bIds = comboTraitIds(b)
      if (aIds.length === 2 && bIds.length === 2) {
        const pk = pairKey(aIds[0], aIds[1])
        const pk2 = pairKey(bIds[0], bIds[1])
        if (pk === pk2) {
          if (
            (a.type === 'require' && b.type === 'exclude') ||
            (a.type === 'exclude' && b.type === 'require')
          ) {
            issues.push({
              severity: 'error',
              code: 'contradiction',
              message: 'Require and exclude conflict on the same trait pair',
              ruleId: a.id,
            })
          }
          if (a.type === 'lock_set' && b.type === 'exclude') {
            issues.push({
              severity: 'error',
              code: 'lock_exclude_conflict',
              message: 'Locked set conflicts with exclude on the same traits',
              ruleId: a.id,
            })
          }
        }
      }
    }
  }

  // Overlapping if_pool rules on same trigger + category with different pools
  const ifPools = project.rules.filter((r) => r.type === 'if_pool')
  for (let i = 0; i < ifPools.length; i++) {
    for (let j = i + 1; j < ifPools.length; j++) {
      const a = ifPools[i]
      const b = ifPools[j]
      if (
        a.whenTraitId === b.whenTraitId &&
        a.targetCategoryId === b.targetCategoryId &&
        ruleTraitKey(a.allowedTraitIds ?? []) !== ruleTraitKey(b.allowedTraitIds ?? [])
      ) {
        issues.push({
          severity: 'warning',
          code: 'if_pool_overlap',
          message:
            'Multiple IF rules share the same trigger and category with different pools — generation intersects them',
          ruleId: a.id,
        })
      }
    }
  }

  for (const cat of project.categories) {
    const count = project.traits.filter((t) => t.categoryId === cat.id).length
    if (count === 0) {
      issues.push({
        severity: 'info',
        code: 'empty_category',
        message: `${cat.name} has no traits yet`,
      })
    }
  }

  for (const t of project.traits) {
    if (t.weight <= 0) {
      issues.push({
        severity: 'warning',
        code: 'zero_weight',
        message: `${t.name} has weight 0 — excluded from random generation`,
        traitIds: [t.id],
      })
    }
  }

  const perCategory = project.categories
    .map((c) => project.traits.filter((t) => t.categoryId === c.id).length)
    .filter((n) => n > 0)
  if (perCategory.length) {
    const maxUnique = perCategory.reduce((a, b) => a * b, 1)
    issues.push({
      severity: 'info',
      code: 'max_unique',
      message: `Up to ~${maxUnique.toLocaleString()} unique combos before rules`,
    })
  }

  const oneOfOnes = project.oneOfOnes ?? []
  if (oneOfOnes.length) {
    const missing = oneOfOnes.filter((o) => !o.traitValue.trim())
    if (missing.length) {
      issues.push({
        severity: 'warning',
        code: 'one_of_one_missing_trait',
        message: `${missing.length} 1/1 image(s) need a trait value (e.g. The Widow King)`,
      })
    }
    const supply = project.targetSupply ?? 0
    if (supply > 0 && oneOfOnes.length >= supply) {
      issues.push({
        severity: 'error',
        code: 'one_of_one_supply',
        message: `1/1 count (${oneOfOnes.length}) must be less than target supply (${supply})`,
      })
    }
  }

  const errors = issues.filter((i) => i.severity === 'error')
  if (project.rules.length > 0 && errors.length === 0 && project.traits.length >= 2) {
    issues.push({
      severity: 'info',
      code: 'rules_ok',
      message: 'No rule conflicts detected',
    })
  }

  return issues
}

export function hasBlockingLintIssues(issues: RuleLintIssue[]): boolean {
  return issues.some((i) => i.severity === 'error')
}
