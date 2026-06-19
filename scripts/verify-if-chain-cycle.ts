import { simulateSupply } from '@/lib/owl-center/generator/simulate-supply'
import type { GeneratorProject } from '@/lib/owl-center/generator/types'

// Reproduces Gembird's "0 combos" bug: two IF chains form a roll-order cycle
// between two layers.
//   • Chain A (galaxy):  Eyes "galaxy"  → Base "black"   → Glasses "No Trait"
//   • Chain B (x-ray):   Base "x-ray"   → Eyes one-of {nervous, red laser}
// Chain A wants Eyes rolled before Base; Chain B wants Base rolled before Eyes.
// The topo-sort can't satisfy both, falls back to z-index (Base first), and —
// before the reverse-guard fix — "galaxy" would be picked after Base already
// rolled a non-black color, fail final validation, and get discarded every time,
// driving galaxy to 0 across the whole supply.
//
// After the fix, galaxy is only OFFERED when Base already rolled black (or hasn't
// rolled yet), so it appears, never violates its chain, and never co-occurs with
// the x-ray base.

const cat = {
  background: 'background',
  base: 'base',
  eyes: 'eyes',
  glasses: 'glasses',
  outfit: 'outfit',
}

function trait(id: string, categoryId: string, name: string, weight: number) {
  return { id, categoryId, name, weight, imageSrc: '' }
}

function many(categoryId: string, prefix: string, n: number, weight = 100) {
  return Array.from({ length: n }, (_, i) => trait(`${prefix}${i}`, categoryId, `${prefix} ${i}`, weight))
}

const backgrounds = many(cat.background, 'bg', 12)
const outfits = many(cat.outfit, 'out', 15)

// Base colors: black + x-ray are the two chain anchors; plus filler colors.
const baseBlack = trait('base_black', cat.base, 'black', 100)
const baseXray = trait('base_xray', cat.base, 'x ray', 100)
const bases = [baseBlack, baseXray, ...many(cat.base, 'base', 10, 100)]

// Eyes: galaxy is a normal-weight eye; nervous + red laser are the x-ray pool.
const eyeGalaxy = trait('eye_galaxy', cat.eyes, 'galaxy', 100)
const eyeNervous = trait('eye_nervous', cat.eyes, 'nervous', 100)
const eyeRedLaser = trait('eye_red_laser', cat.eyes, 'red laser', 100)
const eyes = [eyeGalaxy, eyeNervous, eyeRedLaser, ...many(cat.eyes, 'eye', 8, 100)]

// Glasses includes a "No Trait" sentinel.
const glassesNone = trait('glasses_none', cat.glasses, 'No Trait', 100)
const glasses = [glassesNone, ...many(cat.glasses, 'glasses', 8, 100)]

const project: GeneratorProject = {
  id: 'p',
  name: 'cycle-test',
  collectionName: 'cycle-test',
  symbol: 'CYC',
  description: '',
  categories: [
    { id: cat.background, name: 'Background', zIndex: 0 },
    { id: cat.base, name: 'Base', zIndex: 10 },
    { id: cat.eyes, name: 'Eyes', zIndex: 20 },
    { id: cat.glasses, name: 'Glasses', zIndex: 30 },
    { id: cat.outfit, name: 'Outfit', zIndex: 40 },
  ],
  traits: [...backgrounds, ...bases, ...eyes, ...glasses, ...outfits],
  rules: [
    {
      id: 'chainGalaxy',
      type: 'if_chain',
      chainSteps: [
        { traitIds: [eyeGalaxy.id] },
        { traitIds: [baseBlack.id] },
        { traitIds: [glassesNone.id] },
      ],
      label: 'Chain: galaxy → black → No Trait',
    },
    {
      id: 'chainXray',
      type: 'if_chain',
      chainSteps: [
        { traitIds: [baseXray.id] },
        { traitIds: [eyeNervous.id, eyeRedLaser.id] },
      ],
      label: 'Chain: x-ray → nervous / red laser',
    },
  ],
  updatedAt: new Date().toISOString(),
}

const target = 2000
const result = simulateSupply(project, target)

const stat = (id: string) => result.traitStats.find((s) => s.traitId === id)!
const galaxy = stat(eyeGalaxy.id)
const xray = stat(baseXray.id)

console.log(`generated:       ${result.generated}`)
console.log(`galaxy count:    ${galaxy.count}  (${galaxy.percent.toFixed(2)}%)`)
console.log(`x-ray count:     ${xray.count}  (${xray.percent.toFixed(2)}%)`)

const byCat = (c: GeneratorProject['categories'][number]['id'], combo: (typeof result.combos)[number]) =>
  combo.traits.find((t) => t.categoryId === c)

// Every galaxy owl must have black base + No Trait glasses (chain A enforced).
const galaxyCombos = result.combos.filter((c) => c.traits.some((t) => t.id === eyeGalaxy.id))
const galaxyViolations = galaxyCombos.filter((c) => {
  const base = byCat(cat.base, c)
  const g = byCat(cat.glasses, c)
  return base?.id !== baseBlack.id || (g && g.id !== glassesNone.id)
})

// Every x-ray owl must have nervous or red laser eyes (chain B enforced).
const xrayCombos = result.combos.filter((c) => c.traits.some((t) => t.id === baseXray.id))
const xrayAllowedEyes = new Set([eyeNervous.id, eyeRedLaser.id])
const xrayViolations = xrayCombos.filter((c) => {
  const eye = byCat(cat.eyes, c)
  return eye ? !xrayAllowedEyes.has(eye.id) : false
})

console.log(`galaxy combos:   ${galaxyCombos.length}  (violations: ${galaxyViolations.length})`)
console.log(`x-ray combos:    ${xrayCombos.length}  (violations: ${xrayViolations.length})`)

let failed = false
if (galaxy.count === 0) {
  console.error('\nFAIL: "galaxy" never appeared — the cycle still zeroes the trigger.')
  failed = true
}
if (xray.count === 0) {
  console.error('\nFAIL: "x-ray" never appeared — the cycle still zeroes the trigger.')
  failed = true
}
if (galaxyViolations.length > 0) {
  console.error('\nFAIL: galaxy chain not enforced (base/glasses wrong).')
  failed = true
}
if (xrayViolations.length > 0) {
  console.error('\nFAIL: x-ray chain not enforced (eyes wrong).')
  failed = true
}

if (failed) process.exit(1)
console.log('\nPASS: both cyclic chain triggers appear AND both chains are enforced.')
