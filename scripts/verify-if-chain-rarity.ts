import { simulateSupply } from '@/lib/owl-center/generator/simulate-supply'
import type { GeneratorProject } from '@/lib/owl-center/generator/types'

// Reproduces the reported bug: a rare "Stampede" hat (weight 50 of ~1790) is the
// trigger of an IF chain whose downstream Body step lists the common base colors.
// Before the fix, rolling a common body color forced Stampede onto the hat (~84%).
// After the fix, Stampede should track its weight (~2.8%).

const cat = {
  background: 'background',
  body: 'body',
  hat: 'hat',
  outfit: 'outfit',
}

function trait(id: string, categoryId: string, name: string, weight: number) {
  return { id, categoryId, name, weight, imageSrc: '' }
}

// Build a large, representative trait space so unique-combo saturation does not
// flatten the distribution (real collections have millions of possible combos).
function many(categoryId: string, prefix: string, n: number, weight = 100) {
  return Array.from({ length: n }, (_, i) => trait(`${prefix}${i}`, categoryId, `${prefix} ${i}`, weight))
}

const backgrounds = many(cat.background, 'bg', 20)
const bodies = many(cat.body, 'body', 20)
const outfits = many(cat.outfit, 'out', 20)

// Hat pool: Stampede is rare. 50 / (50 + 19*~92) ~= 2.8%.
const hats = [trait('stampede', cat.hat, 'Stampede', 50), ...many(cat.hat, 'hat', 19, 92)]

// Chain downstream steps list the common base colors / outfits (a large share),
// exactly the scenario that previously back-propagated and forced Stampede.
const chainBodyIds = bodies.slice(0, 12).map((t) => t.id)
const chainOutfitIds = outfits.slice(0, 10).map((t) => t.id)

const project: GeneratorProject = {
  id: 'p',
  name: 'test',
  collectionName: 'test',
  symbol: 'TST',
  description: '',
  categories: [
    { id: cat.background, name: 'Background', zIndex: 0 },
    { id: cat.body, name: 'Body', zIndex: 10 },
    { id: cat.hat, name: 'Hat', zIndex: 20 },
    { id: cat.outfit, name: 'Outfits', zIndex: 40 },
  ],
  traits: [...backgrounds, ...bodies, ...hats, ...outfits],
  rules: [
    {
      id: 'chain1',
      type: 'if_chain',
      chainSteps: [
        { traitIds: ['stampede'] },
        { traitIds: chainBodyIds },
        { traitIds: chainOutfitIds },
      ],
      label: 'Chain: Stampede → body → outfit',
    },
  ],
  updatedAt: new Date().toISOString(),
}

const target = 2000
const result = simulateSupply(project, target)
const stampede = result.traitStats.find((s) => s.traitName === 'Stampede')!

console.log(`generated:        ${result.generated}`)
console.log(`Stampede count:   ${stampede.count}`)
console.log(`Stampede actual:  ${stampede.percent.toFixed(2)}%`)
console.log(`Stampede expected:${stampede.expectedPercent.toFixed(2)}%`)

const withinTolerance = Math.abs(stampede.percent - stampede.expectedPercent) < 1.5

// Directionality: every owl wearing Stampede must respect the downstream chain.
const allowedBody = new Set(chainBodyIds)
const allowedOutfit = new Set(chainOutfitIds)
const stampedeCombos = result.combos.filter((c) => c.traits.some((t) => t.id === 'stampede'))
const violations = stampedeCombos.filter((c) => {
  const body = c.traits.find((t) => t.categoryId === cat.body)
  const outfit = c.traits.find((t) => t.categoryId === cat.outfit)
  const bodyOk = !body || allowedBody.has(body.id)
  const outfitOk = !outfit || allowedOutfit.has(outfit.id)
  return !bodyOk || !outfitOk
})

console.log(`Stampede combos:  ${stampedeCombos.length}`)
console.log(`chain violations: ${violations.length}`)

if (!withinTolerance) {
  console.error('\nFAIL: Stampede frequency does not track its weight.')
  process.exit(1)
}
if (violations.length > 0) {
  console.error('\nFAIL: chain not enforced downstream of Stampede.')
  process.exit(1)
}
console.log('\nPASS: Stampede tracks its weight AND the chain is enforced when it appears.')
