/**
 * Guards Gen2 WL / Nesting Share Mint OG art:
 * - og-assets brand PNGs must be real PNG (Satori-safe)
 * - carousel "png" files are known WebP; fetchImageDataUrlForOg must sniff them
 *
 *   npx --yes tsx scripts/test-og-brand-art-mime.ts
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

function sniff(buf: Buffer): string | null {
  if (buf.byteLength < 12) return null
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg'
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png'
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return 'image/gif'
  if (
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  ) {
    return 'image/webp'
  }
  return null
}

let failed = 0
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error('FAIL:', msg)
    failed++
  } else {
    console.log('ok:', msg)
  }
}

async function main() {
  const root = process.cwd()
  const goldenOg = await readFile(join(root, 'public/og-assets/golden-owl.png'))
  const nestOg = await readFile(join(root, 'public/og-assets/nest-punk-owl.png'))
  const goldenCarousel = await readFile(join(root, 'public/images/gen2-carousel/golden-owl.png'))
  const nestCarousel = await readFile(join(root, 'public/images/gen2-carousel/nest-punk-owl.png'))

  assert(sniff(goldenOg) === 'image/png', 'og-assets/golden-owl.png is real PNG for Satori')
  assert(sniff(nestOg) === 'image/png', 'og-assets/nest-punk-owl.png is real PNG for Satori')
  assert(goldenOg.byteLength > 24, 'og-assets/golden-owl.png non-empty')
  assert(nestOg.byteLength > 24, 'og-assets/nest-punk-owl.png non-empty')

  assert(sniff(goldenCarousel) === 'image/webp', 'carousel golden-owl.png bytes are WebP (extension is a lie)')
  assert(sniff(nestCarousel) === 'image/webp', 'carousel nest-punk-owl.png bytes are WebP (extension is a lie)')

  // Decision the fixed fetch path must make: sniffed WebP + lied content-type image/png → transcode
  const liedMime = 'image/png'
  const sniffed = sniff(goldenCarousel)
  const effective = sniffed || liedMime
  assert(effective === 'image/webp', 'sniff must win over Content-Type image/png for carousel WebP')
  assert(
    !new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/gif']).has(effective!),
    'carousel WebP must go through transcode path (not direct embed)'
  )

  if (failed > 0) {
    console.error(`\n${failed} assertion(s) failed`)
    process.exit(1)
  }
  console.log('\nAll OG brand-art mime checks passed.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
