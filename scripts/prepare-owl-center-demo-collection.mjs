/**
 * Build Sugar-ready demo collection from pre-rendered owl art in public/images/gen2-carousel.
 *
 * Usage:
 *   node scripts/prepare-owl-center-demo-collection.mjs
 *
 * Output: collections/owl-center-demo/assets/{0..4}.png + .json, collection.json, config.json
 * Then: cd collections/owl-center-demo && sugar validate && sugar upload && sugar deploy
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
const OUT = path.join(ROOT, 'collections', 'owl-center-demo')
const ASSETS = path.join(OUT, 'assets')

const SUPPLY = 5
const COLLECTION_NAME = 'Owl Center Launchpad Demo'
const SYMBOL = 'OWLDEMO'
const DESCRIPTION =
  'Pre-rendered demo collection for Owl Center — proves Sugar → mint → sell-out → Magic Eden / Tensor flow.'

/** Source PNGs (relative to repo root). */
const TRAITS = [
  { file: 'public/images/gen2-carousel/golden-owl.png', name: 'Golden Owl', background: 'Gold', trait: 'Golden' },
  { file: 'public/images/gen2-carousel/armored-purple-owl.png', name: 'Armored Owl', background: 'Purple', trait: 'Armored' },
  { file: 'public/images/gen2-carousel/nest-punk-owl.png', name: 'Nest Punk Owl', background: 'Neon', trait: 'Nest Punk' },
  { file: 'public/images/gen2-carousel/blindfold-tux-owl.png', name: 'Blindfold Tux Owl', background: 'Midnight', trait: 'Blindfold Tux' },
  { file: 'public/images/gen2-carousel/monster-owl.png', name: 'Monster Owl', background: 'Void', trait: 'Monster' },
]

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true })
}

function copyFile(src, dest) {
  const abs = path.join(ROOT, src)
  if (!fs.existsSync(abs)) {
    throw new Error(`Missing source art: ${src} — run from repo root after pulling assets`)
  }
  fs.copyFileSync(abs, dest)
}

function writeJson(file, obj) {
  fs.writeFileSync(file, `${JSON.stringify(obj, null, 2)}\n`, 'utf8')
}

ensureDir(ASSETS)

copyFile('public/images/gen2-logo-mark.png', path.join(ASSETS, 'collection.png'))

writeJson(path.join(ASSETS, 'collection.json'), {
  name: COLLECTION_NAME,
  symbol: SYMBOL,
  description: DESCRIPTION,
  image: 'collection.png',
  properties: {
    files: [{ uri: 'collection.png', type: 'image/png' }],
    category: 'image',
  },
})

for (let i = 0; i < SUPPLY; i++) {
  const t = TRAITS[i]
  copyFile(t.file, path.join(ASSETS, `${i}.png`))
  writeJson(path.join(ASSETS, `${i}.json`), {
    name: `${COLLECTION_NAME} #${i}`,
    symbol: SYMBOL,
    description: `${DESCRIPTION} Token ${i}.`,
    image: `${i}.png`,
    attributes: [
      { trait_type: 'Background', value: t.background },
      { trait_type: 'Owl', value: t.trait },
    ],
    properties: {
      files: [{ uri: `${i}.png`, type: 'image/png' }],
      category: 'image',
    },
  })
}

writeJson(path.join(OUT, 'config.json'), {
  number: SUPPLY,
  symbol: SYMBOL,
  sellerFeeBasisPoints: 500,
  gifFilter: false,
  creators: [{ address: 'REPLACE_WITH_DEPLOYER_WALLET', share: 100 }],
  uploadMethod: 'bundlr',
  awsConfig: null,
  nftStorageAuthToken: null,
  pinataConfig: null,
  hiddenSettings: null,
  instantSale: false,
  nftStorage: null,
  guard: null,
})

writeJson(
  path.join(OUT, 'traits.csv'),
  ['index,background,owl', ...TRAITS.map((t, i) => `${i},${t.background},${t.trait}`)].join('\n') + '\n'
)

const readme = `# Owl Center demo collection (pre-rendered)

Supply: **${SUPPLY}** · Symbol: **${SYMBOL}**

Art is copied from \`public/images/gen2-carousel/\` by \`scripts/prepare-owl-center-demo-collection.mjs\`.

## Sugar deploy

1. Edit \`config.json\` — set \`creators[0].address\` to your deployer wallet.
2. \`cd collections/owl-center-demo\`
3. \`sugar validate\`
4. \`sugar upload\` (Arweave via bundlr)
5. \`sugar deploy\` — note **candy_machine_id** and **collection_mint**
6. Owl Center admin → \`/admin/owl-center/demo\` — paste IDs, create launch with supply **${SUPPLY}**
7. Mint at \`/owl-center/collection/demo\` until sold out
8. Sell-out auto-generates hash list for Magic Eden + Tensor

See \`docs/OWL_CENTER_DEMO_MINT.md\`.
`

fs.writeFileSync(path.join(OUT, 'README.md'), readme, 'utf8')

console.log(`Prepared ${SUPPLY} assets in ${OUT}`)
console.log('Next: edit config.json creator wallet, then sugar validate / upload / deploy')
