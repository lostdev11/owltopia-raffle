import { simulateSupply } from '@/lib/owl-center/generator/simulate-supply'
import { diagnoseTrait } from '@/lib/owl-center/generator/rules'
import type { CompatibilityRule, GeneratorProject, TraitLayer } from '@/lib/owl-center/generator/types'

// Faithful-ish reproduction of Gembird's project: a dense web of IF chains plus
// bidirectional `require` rules, including the 4-step `wings` chain and a
// `require x ray + No Trait` that links a free layer's "No Trait" to the x-ray
// base. Goal: see whether `wings` (and friends) come out 0 under the current
// engine, and confirm the fix lifts them off 0.

const C = {
  bg: 'bg',
  base: 'base',
  eyes: 'eyes',
  mouth: 'mouth',
  glasses: 'glasses',
  hat: 'hat',
  outfit: 'outfit',
} as const

let n = 0
const t = (categoryId: string, name: string, weight = 100): TraitLayer => ({
  id: `${categoryId}:${name}:${n++}`,
  categoryId,
  name,
  weight,
  imageSrc: '',
})

// ---- traits ---------------------------------------------------------------
const bg = Array.from({ length: 10 }, (_, i) => t(C.bg, `bg${i}`))

const base = {
  brown: t(C.base, 'brown'),
  darkGray: t(C.base, 'dark gray'),
  gray: t(C.base, 'gray'),
  gold: t(C.base, 'gold'),
  white: t(C.base, 'white'),
  black: t(C.base, 'black'),
  xray: t(C.base, 'x ray'),
}

const eyes = {
  galaxy: t(C.eyes, 'galaxy'),
  redLaser: t(C.eyes, 'RED LASER'),
  angry: t(C.eyes, 'angry'),
  none: t(C.eyes, 'No Trait'),
  focus: t(C.eyes, 'focus'),
  here: t(C.eyes, 'here'),
}

const mouth = {
  none: t(C.mouth, 'No Trait'),
  whytooth: t(C.mouth, 'whytooth'),
  smile: t(C.mouth, 'smile'),
}

const glasses = {
  none: t(C.glasses, 'No Trait'),
  frost: t(C.glasses, 'Frost Rider'),
  glitch: t(C.glasses, 'Glitch Vision'),
  medshade: t(C.glasses, 'Medshade'),
  midnight: t(C.glasses, 'Midnight Lens'),
  owlVision: t(C.glasses, 'Owl vision'),
  phantom: t(C.glasses, 'Phantom Wrap'),
  retro: t(C.glasses, 'Retro Orbit'),
  silver: t(C.glasses, 'Silver Strike'),
  skyliner: t(C.glasses, 'Skyliner'),
  undercover: t(C.glasses, 'Undercover'),
}

const hat = {
  none: t(C.hat, 'No Trait'),
  stampede: t(C.hat, 'Stampede', 50),
  wildCrest: t(C.hat, 'Wild Crest'),
  thornNest: t(C.hat, 'Thorn Nest'),
  shadowFade: t(C.hat, 'Shadow Fade'),
  owlHat: t(C.hat, 'Owl Hat'),
  winterHat: t(C.hat, 'Winter Hat'),
  warhawk: t(C.hat, 'Warhawk'),
  goldenShogun: t(C.hat, 'Golden Shogun', 60),
  headphones: t(C.hat, 'Headphones'),
}

const outfit = {
  none: t(C.outfit, 'No Trait'),
  wings: t(C.outfit, 'wings', 80),
  neoArmor: t(C.outfit, 'Neo Armor'),
  bushido: t(C.outfit, 'Bushido Gear', 60),
  warlord: t(C.outfit, 'Warlord Vest'),
  commander: t(C.outfit, 'Commander Jacket'),
  basicTee: t(C.outfit, 'Basic Tee'),
  riderJacket: t(C.outfit, 'Rider Jacket'),
  whiteSuit: t(C.outfit, 'White Suit'),
  winterCloak: t(C.outfit, 'Winter Cloak'),
}

const allTraits: TraitLayer[] = [
  ...bg,
  ...Object.values(base),
  ...Object.values(eyes),
  ...Object.values(mouth),
  ...Object.values(glasses),
  ...Object.values(hat),
  ...Object.values(outfit),
]

// ---- rules ----------------------------------------------------------------
let rid = 0
const chain = (label: string, steps: { traitIds: string[]; stackAll?: boolean }[]): CompatibilityRule => ({
  id: `chain${rid++}`,
  type: 'if_chain',
  chainSteps: steps,
  label,
})
const require_ = (a: TraitLayer, b: TraitLayer): CompatibilityRule => ({
  id: `req${rid++}`,
  type: 'require',
  traitIds: [a.id, b.id],
  label: `require ${a.name} + ${b.name}`,
})

const rules: CompatibilityRule[] = [
  chain('wings → brown → hats → glasses-stack', [
    { traitIds: [outfit.wings.id] },
    { traitIds: [base.brown.id] },
    { traitIds: [hat.none.id, hat.wildCrest.id, hat.thornNest.id, hat.shadowFade.id] },
    { traitIds: [glasses.none.id, glasses.skyliner.id, glasses.retro.id, glasses.undercover.id], stackAll: true },
  ]),
  chain('galaxy → black → No Trait', [
    { traitIds: [eyes.galaxy.id] },
    { traitIds: [base.black.id] },
    { traitIds: [glasses.none.id] },
  ]),
  chain('x ray → No Trait', [{ traitIds: [base.xray.id] }, { traitIds: [glasses.none.id] }]),
  chain('x ray → RED LASER / angry → No Trait', [
    { traitIds: [base.xray.id] },
    { traitIds: [eyes.redLaser.id, eyes.angry.id] },
    { traitIds: [mouth.none.id] },
  ]),
  chain('Thorn Nest → brown', [{ traitIds: [hat.thornNest.id] }, { traitIds: [base.brown.id] }]),
  chain('Bushido Gear → No Trait', [{ traitIds: [outfit.bushido.id] }, { traitIds: [glasses.none.id] }]),
  chain('RED LASER → No Trait', [{ traitIds: [eyes.redLaser.id] }, { traitIds: [glasses.none.id] }]),
  chain('Warlord Vest → glasses-stack', [
    { traitIds: [outfit.warlord.id] },
    { traitIds: [glasses.none.id, glasses.silver.id, glasses.midnight.id, glasses.medshade.id, glasses.skyliner.id], stackAll: true },
  ]),
  chain('Commander Jacket → hats', [
    { traitIds: [outfit.commander.id] },
    { traitIds: [hat.wildCrest.id, hat.shadowFade.id, hat.none.id, hat.stampede.id] },
  ]),
  chain('Owl vision → hats', [
    { traitIds: [glasses.owlVision.id] },
    { traitIds: [hat.wildCrest.id, hat.shadowFade.id, hat.none.id, hat.thornNest.id] },
  ]),
  chain('Stampede → base → outfit → glasses-stack', [
    { traitIds: [hat.stampede.id] },
    { traitIds: [base.brown.id, base.darkGray.id, base.gray.id, base.gold.id, base.white.id] },
    { traitIds: [outfit.basicTee.id, outfit.riderJacket.id, outfit.whiteSuit.id, outfit.winterCloak.id, outfit.none.id] },
    {
      traitIds: [
        glasses.frost.id, glasses.glitch.id, glasses.medshade.id, glasses.midnight.id, glasses.none.id,
        glasses.owlVision.id, glasses.phantom.id, glasses.retro.id, glasses.silver.id, glasses.skyliner.id, glasses.undercover.id,
      ],
      stackAll: true,
    },
  ]),
  require_(outfit.bushido, hat.goldenShogun),
  require_(base.xray, mouth.none), // the dangerous bidirectional one (free-layer No Trait)
]

const project: GeneratorProject = {
  id: 'p',
  name: 'wings-dense',
  collectionName: 'wings-dense',
  symbol: 'WD',
  description: '',
  categories: [
    { id: C.bg, name: 'Background', zIndex: 0 },
    { id: C.base, name: 'Base', zIndex: 10 },
    { id: C.eyes, name: 'Eyes', zIndex: 20 },
    { id: C.mouth, name: 'Mouth', zIndex: 25 },
    { id: C.glasses, name: 'Glasses', zIndex: 30, allowMultiple: true },
    { id: C.hat, name: 'Hat', zIndex: 35 },
    { id: C.outfit, name: 'Outfit', zIndex: 40 },
  ],
  traits: allTraits,
  rules,
  updatedAt: new Date().toISOString(),
}

const result = simulateSupply(project, 2000)
const stat = (tr: TraitLayer) => result.traitStats.find((s) => s.traitId === tr.id)!
const show = (label: string, tr: TraitLayer) => {
  const s = stat(tr)
  console.log(`  ${label.padEnd(16)} count=${String(s.count).padStart(4)}  ${s.percent.toFixed(2)}%`)
}

console.log(`generated: ${result.generated}`)
console.log('triggers:')
show('wings', outfit.wings)
show('Bushido Gear', outfit.bushido)
show('Golden Shogun', hat.goldenShogun)
show('galaxy', eyes.galaxy)
show('x ray', base.xray)
show('Stampede', hat.stampede)
show('Warlord Vest', outfit.warlord)

const zeros = result.traitStats.filter((s) => s.count === 0 && allTraits.find((tr) => tr.id === s.traitId)!.weight > 0)
console.log(`\nzero-count traits (weight>0): ${zeros.length}`)
for (const z of zeros) {
  const diag = diagnoseTrait(project.categories, project.traits, project.rules, z.traitId)
  console.log(`  - ${z.categoryName}: ${z.traitName}`)
  console.log(`      satisfiable=${diag.satisfiable}${diag.reason ? `  reason="${diag.reason}"` : ''}`)
}

let failed = false
const expectPresent = (label: string, tr: TraitLayer) => {
  if (stat(tr).count === 0) {
    console.error(`\nFAIL: "${label}" is a satisfiable stack-all chain trigger but generated 0.`)
    failed = true
  }
}
// These were all 0 before the ordering fix; each is satisfiable and must appear.
expectPresent('wings', outfit.wings)
expectPresent('Warlord Vest', outfit.warlord)
expectPresent('galaxy', eyes.galaxy)
expectPresent('Bushido Gear', outfit.bushido)

// Stampede is a GENUINE rule contradiction (its forced glasses stack includes
// "Owl vision", which forbids the Stampede hat). It must stay 0 AND be reported
// as unsatisfiable — not silently dropped.
const stampedeDiag = diagnoseTrait(project.categories, project.traits, project.rules, hat.stampede.id)
if (stat(hat.stampede).count !== 0 || stampedeDiag.satisfiable) {
  console.error('\nFAIL: expected "Stampede" to be an unsatisfiable contradiction.')
  failed = true
}

if (failed) process.exit(1)
console.log('\nPASS: satisfiable stack-all triggers generate; the true contradiction is flagged.')
