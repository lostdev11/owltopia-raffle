import assert from 'node:assert/strict'
import {
  bumpMetadataJsonTokenNumber,
  detectCoinNumberingScheme,
  isZeroBasedContiguousIndices,
  remapZeroBasedManifestKeys,
  resolveCatalogManifestForOnChainCoins,
  shouldRemapZeroBasedKeys,
  shiftManifestKeys,
} from '../lib/coin-upgrade/zero-based-remap'

assert.equal(isZeroBasedContiguousIndices([0, 1, 2]), true)
assert.equal(isZeroBasedContiguousIndices([0, 1, 999]), false)
assert.equal(isZeroBasedContiguousIndices([1, 2, 3]), false)
assert.equal(isZeroBasedContiguousIndices([...Array.from({ length: 1000 }, (_, i) => i)]), true)
assert.equal(shouldRemapZeroBasedKeys([...Array.from({ length: 1000 }, (_, i) => i)]), true)
assert.equal(shouldRemapZeroBasedKeys([1, 2, 3]), false)

const { manifest, remapped } = remapZeroBasedManifestKeys({
  '0': { image: 'i0', metadata: 'm0' },
  '1': { image: 'i1', metadata: 'm1' },
  '999': { image: 'i999', metadata: 'm999' },
})
assert.equal(remapped, false) // not contiguous — missing 2..998

const full: Record<string, { image: string; metadata: string }> = {}
for (let i = 0; i < 3; i += 1) full[String(i)] = { image: `i${i}`, metadata: `m${i}` }
const remapped3 = remapZeroBasedManifestKeys(full)
assert.equal(remapped3.remapped, true)
assert.deepEqual(remapped3.manifest, {
  '1': { image: 'i0', metadata: 'm0' },
  '2': { image: 'i1', metadata: 'm1' },
  '3': { image: 'i2', metadata: 'm2' },
})

const thousand: Record<string, { image: string; metadata: string }> = {}
for (let i = 0; i < 1000; i += 1) thousand[String(i)] = { image: `i${i}`, metadata: `m${i}` }
const remapped1k = remapZeroBasedManifestKeys(thousand)
assert.equal(remapped1k.remapped, true)
assert.ok(remapped1k.manifest['1000'])
assert.equal(remapped1k.manifest['1000']?.metadata, 'm999')
assert.equal(remapped1k.manifest['1']?.metadata, 'm0')
assert.equal(remapped1k.manifest['0'], undefined)

const alreadyOneBased = remapZeroBasedManifestKeys({
  '1': { image: 'a', metadata: 'b' },
  '2': { image: 'c', metadata: 'd' },
})
assert.equal(alreadyOneBased.remapped, false)

const bumped = bumpMetadataJsonTokenNumber(
  JSON.stringify({ name: 'Owltopia Coin #0', description: 'Token 0' }),
  0,
  1
)
const parsed = JSON.parse(bumped) as { name: string; description: string }
assert.equal(parsed.name, 'Owltopia Coin #1')
assert.equal(parsed.description, 'Token 1')

assert.equal(detectCoinNumberingScheme([1, 2, 999, 1000]), 'one-based')
assert.equal(detectCoinNumberingScheme([0, 1, 2, 998, 999]), 'zero-based')
assert.equal(detectCoinNumberingScheme([0, 1, 999]), 'zero-based')

const zeroManifest: Record<string, { image: string; metadata: string }> = {}
for (let i = 0; i < 1000; i += 1) zeroManifest[String(i)] = { image: `i${i}`, metadata: `m${i}` }

const zeroBased = resolveCatalogManifestForOnChainCoins(zeroManifest, [0, 1, 998, 999])
assert.equal(zeroBased.scheme, 'zero-based')
assert.equal(zeroBased.manifest['0']?.metadata, 'm0')
assert.equal(zeroBased.manifest['999']?.metadata, 'm999')
assert.equal(zeroBased.manifest['1000'], undefined)

const oneBased = resolveCatalogManifestForOnChainCoins(zeroManifest, [1, 2, 999, 1000])
assert.equal(oneBased.scheme, 'one-based')
assert.equal(oneBased.manifest['1']?.metadata, 'm0')
assert.equal(oneBased.manifest['1000']?.metadata, 'm999')
assert.equal(oneBased.manifest['0'], undefined)

const shifted = shiftManifestKeys({ '1': { metadata: 'a' }, '2': { metadata: 'b' } }, -1)
assert.deepEqual(shifted, { '0': { metadata: 'a' }, '1': { metadata: 'b' } })

console.log('test-coin-art-zero-based-remap: ok')
