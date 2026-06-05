import type { CompatibilityRule, GeneratorProject, TraitLayer } from '@/lib/owl-center/generator/types'
import { applyLegacyCategoryRenames } from '@/lib/owl-center/generator/categories'
import { DEFAULT_CATEGORIES } from '@/lib/owl-center/generator/types'
import { urlToDataUrl } from '@/lib/owl-center/generator/storage'

const DEMO_BODIES: { name: string; file: string; weight?: number }[] = [
  { name: 'Golden', file: '/images/gen2-carousel/golden-owl.png' },
  { name: 'Cyber', file: '/images/gen2-carousel/armored-purple-owl.png' },
  { name: 'Nest Punk', file: '/images/gen2-carousel/nest-punk-owl.png', weight: 80 },
  { name: 'Tux', file: '/images/gen2-carousel/blindfold-tux-owl.png' },
  { name: 'Monster', file: '/images/gen2-carousel/monster-owl.png', weight: 60 },
]

const DEMO_HATS: { name: string; file: string }[] = [
  { name: 'Cyber Hood', file: '/images/gen2-carousel/armored-purple-owl.png' },
  { name: 'Beanie', file: '/images/gen2-carousel/nest-punk-owl.png' },
  { name: 'Crown', file: '/images/gen2-carousel/golden-owl.png' },
]

const DEMO_GLASSES: { name: string; file: string }[] = [
  { name: 'Round', file: '/images/gen2-carousel/blindfold-tux-owl.png' },
  { name: 'Cyber Visor', file: '/images/gen2-carousel/monster-owl.png' },
]

const DEMO_ACCESSORIES: { name: string; file: string }[] = [
  { name: 'Jersey', file: '/images/gen2-carousel/jersey-owl.png' },
]

const DEMO_BACKGROUNDS: { name: string; color: string }[] = [
  { name: 'Night', color: '#0B0F12' },
  { name: 'Forest', color: '#1a3d2e' },
  { name: 'Purple Haze', color: '#2d1b4e' },
]

function svgDataUrl(svg: string): string {
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

function transparentLayerSvg(): string {
  return svgDataUrl('<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"/>')
}

function backgroundSvg(color: string): string {
  return svgDataUrl(
    `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect width="100%" height="100%" fill="${color}"/></svg>`
  )
}

async function traitFromFile(
  categoryId: string,
  name: string,
  file: string,
  weight = 100
): Promise<TraitLayer> {
  return {
    id: crypto.randomUUID(),
    categoryId,
    name,
    weight,
    imageSrc: await urlToDataUrl(file),
  }
}

function traitFromDataUrl(
  categoryId: string,
  name: string,
  imageSrc: string,
  weight = 100
): TraitLayer {
  return {
    id: crypto.randomUUID(),
    categoryId,
    name,
    weight,
    imageSrc,
  }
}

export function projectMissingDefaultLayers(project: GeneratorProject): boolean {
  const existing = new Set(project.categories.map((c) => c.name.toLowerCase()))
  return DEFAULT_CATEGORIES.some((c) => !existing.has(c.name.toLowerCase()))
}

function defaultCategoryFlags(name: string): Pick<GeneratorProject['categories'][number], 'allowMultiple'> {
  const template = DEFAULT_CATEGORIES.find((c) => c.name.toLowerCase() === name.toLowerCase())
  return template?.allowMultiple ? { allowMultiple: true } : {}
}

/** Add missing default layers and sync flags (e.g. Eyes, Glasses multi-select). */
export function ensureDefaultCategories(project: GeneratorProject): GeneratorProject {
  const existing = new Set(project.categories.map((c) => c.name.toLowerCase()))
  const missing = DEFAULT_CATEGORIES.filter((c) => !existing.has(c.name.toLowerCase()))
  const categories = applyLegacyCategoryRenames([
    ...project.categories.map((c) => ({ ...c, ...defaultCategoryFlags(c.name) })),
    ...missing.map((c) => ({
      ...c,
      id: `cat-${crypto.randomUUID().slice(0, 8)}`,
    })),
  ]).sort((a, b) => a.zIndex - b.zIndex)

  const snapshot = (cats: GeneratorProject['categories']) =>
    JSON.stringify(cats.map((c) => ({ id: c.id, name: c.name, zIndex: c.zIndex, allowMultiple: c.allowMultiple })))
  if (snapshot(categories) === snapshot(project.categories)) return project
  return { ...project, categories }
}

export function createEmptyProject(): GeneratorProject {
  const now = new Date().toISOString()
  const categories = DEFAULT_CATEGORIES.map((c, i) => ({
    ...c,
    id: `cat-${i}-${crypto.randomUUID().slice(0, 8)}`,
  }))
  return {
    id: crypto.randomUUID(),
    name: 'My Collection',
    collectionName: 'Owltopia Gen3',
    symbol: 'OWLGEN3',
    description: 'Generated with Owl Center trait generator.',
    categories,
    traits: [],
    rules: [],
    updatedAt: now,
  }
}

export async function createDemoProject(): Promise<GeneratorProject> {
  const project = createEmptyProject()
  project.name = 'Demo — layers + IF rules'
  project.collectionName = 'Owl Center Generator Demo'
  project.symbol = 'OWLDEMO'
  project.description =
    'Demo project with sample IF → pool rules (Cyber body → cyber hat/visor only). Replace carousel stand-ins with real transparent layer PNGs for production.'

  const bgCat = project.categories.find((c) => c.name === 'Background')
  const bodyCat = project.categories.find((c) => c.name === 'Body')
  const hatCat = project.categories.find((c) => c.name === 'Hat')
  const glassesCat = project.categories.find((c) => c.name === 'Glasses')
  const outfitsCat = project.categories.find(
    (c) => c.name === 'Outfits' || c.name === 'Accessory'
  )
  if (!bgCat || !bodyCat || !hatCat || !glassesCat || !outfitsCat) return project

  const noneSvg = transparentLayerSvg()
  const traits: TraitLayer[] = []

  for (const bg of DEMO_BACKGROUNDS) {
    traits.push(traitFromDataUrl(bgCat.id, bg.name, backgroundSvg(bg.color)))
  }

  for (const item of DEMO_BODIES) {
    traits.push(await traitFromFile(bodyCat.id, item.name, item.file, item.weight ?? 100))
  }

  for (const item of DEMO_HATS) {
    traits.push(await traitFromFile(hatCat.id, item.name, item.file))
  }
  traits.push(traitFromDataUrl(hatCat.id, 'None', noneSvg, 40))

  for (const item of DEMO_GLASSES) {
    traits.push(await traitFromFile(glassesCat.id, item.name, item.file))
  }
  traits.push(traitFromDataUrl(glassesCat.id, 'None', noneSvg, 50))

  for (const item of DEMO_ACCESSORIES) {
    traits.push(await traitFromFile(outfitsCat.id, item.name, item.file))
  }
  traits.push(traitFromDataUrl(outfitsCat.id, 'None', noneSvg, 70))

  const byName = (catId: string, name: string) =>
    traits.find((t) => t.categoryId === catId && t.name === name)?.id

  const cyberBody = byName(bodyCat.id, 'Cyber')
  const goldenBody = byName(bodyCat.id, 'Golden')
  const tuxBody = byName(bodyCat.id, 'Tux')
  const cyberHood = byName(hatCat.id, 'Cyber Hood')
  const hatNone = byName(hatCat.id, 'None')
  const beanie = byName(hatCat.id, 'Beanie')
  const crown = byName(hatCat.id, 'Crown')
  const cyberVisor = byName(glassesCat.id, 'Cyber Visor')
  const glassesNone = byName(glassesCat.id, 'None')
  const roundGlasses = byName(glassesCat.id, 'Round')

  const rules: CompatibilityRule[] = []

  if (cyberBody && cyberHood && hatNone) {
    rules.push({
      id: crypto.randomUUID(),
      type: 'if_pool',
      whenTraitId: cyberBody,
      targetCategoryId: hatCat.id,
      allowedTraitIds: [cyberHood, hatNone],
      label: 'IF Cyber → Hat: Cyber Hood, None',
    })
  }

  if (cyberBody && cyberVisor && glassesNone) {
    rules.push({
      id: crypto.randomUUID(),
      type: 'if_pool',
      whenTraitId: cyberBody,
      targetCategoryId: glassesCat.id,
      allowedTraitIds: [cyberVisor, glassesNone],
      label: 'IF Cyber → Glasses: Cyber Visor, None',
    })
  }

  if (goldenBody && beanie && crown && hatNone) {
    rules.push({
      id: crypto.randomUUID(),
      type: 'if_pool',
      whenTraitId: goldenBody,
      targetCategoryId: hatCat.id,
      allowedTraitIds: [beanie, crown, hatNone],
      label: 'IF Golden → Hat: Beanie, Crown, None',
    })
  }

  if (tuxBody && roundGlasses) {
    rules.push({
      id: crypto.randomUUID(),
      type: 'lock_set',
      traitIds: [tuxBody, roundGlasses],
      label: 'Tux + Round glasses — fixed pair (demo lock set)',
    })
  }

  project.traits = traits
  project.rules = rules
  project.updatedAt = new Date().toISOString()
  return project
}
