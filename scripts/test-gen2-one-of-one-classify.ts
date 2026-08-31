/**
 * Gen 2 1/1 classification: allowlist + DAS/JSON trait detection.
 * Run: npx tsx scripts/test-gen2-one-of-one-classify.ts
 */
import assert from 'node:assert/strict'
import {
  GEN2_ONE_OF_ONE_MINTS,
  GEN2_STEEL_ONE_OF_ONE_MINT,
} from '../lib/nesting/gen2-one-of-one-mints'
import {
  attrsHaveGen2OneOfOneTrait,
  bucketForGen2Mint,
  classifyGen2OneOfOneMints,
  isGen2OneOfOneFromDasAsset,
  metadataJsonHasGen2OneOfOneTrait,
  mintIsGen2OneOfOneAllowlisted,
  pickAttributesFromDasAsset,
} from '../lib/nesting/gen2-one-of-one'

assert.equal(GEN2_ONE_OF_ONE_MINTS.length, 14, 'expect 14 Gen 2 1/1s')
assert.ok(
  GEN2_ONE_OF_ONE_MINTS.includes(GEN2_STEEL_ONE_OF_ONE_MINT as (typeof GEN2_ONE_OF_ONE_MINTS)[number]),
  'Steel mint must be on the committed allowlist'
)
assert.equal(mintIsGen2OneOfOneAllowlisted(GEN2_STEEL_ONE_OF_ONE_MINT), true)
assert.equal(mintIsGen2OneOfOneAllowlisted('So11111111111111111111111111111111111111112'), false)

{
  // Steel is allowlisted → one-of-one even with empty / missing DAS payload
  assert.equal(isGen2OneOfOneFromDasAsset(GEN2_STEEL_ONE_OF_ONE_MINT, null), true)
  assert.equal(isGen2OneOfOneFromDasAsset(GEN2_STEEL_ONE_OF_ONE_MINT, {}), true)
}

{
  const dasWithTrait = {
    content: {
      metadata: {
        attributes: [{ trait_type: '1/1', value: 'Steel' }],
      },
    },
  }
  const unknownMint = '11111111111111111111111111111111'
  assert.equal(isGen2OneOfOneFromDasAsset(unknownMint, dasWithTrait), true)
  assert.ok(attrsHaveGen2OneOfOneTrait(pickAttributesFromDasAsset(dasWithTrait)))
}

{
  // Empty DAS attrs — sync path is false without allowlist; JSON helper still sees the trait
  const sparseDas = {
    content: {
      json_uri: 'https://arweave.net/example',
      metadata: { name: 'Owltopia G2 #726', attributes: [] },
    },
  }
  const unknownMint = '22222222222222222222222222222222'
  assert.equal(isGen2OneOfOneFromDasAsset(unknownMint, sparseDas), false)
  assert.equal(
    metadataJsonHasGen2OneOfOneTrait({
      name: 'Owltopia G2 #727',
      attributes: [{ trait_type: '1/1', value: 'Steel' }],
    }),
    true
  )
  assert.equal(
    metadataJsonHasGen2OneOfOneTrait({
      attributes: [{ trait_type: 'Special', value: 'Nope' }],
    }),
    false
  )
}

{
  // classify: allowlisted Steel resolves without needing Helius
  void (async () => {
    const map = await classifyGen2OneOfOneMints([
      GEN2_STEEL_ONE_OF_ONE_MINT,
      'So11111111111111111111111111111111111111112',
    ])
    assert.equal(map.get(GEN2_STEEL_ONE_OF_ONE_MINT), 'one-of-one')
    // Non-allowlisted + no Helius in this env → standard (fail closed)
    assert.equal(map.get('So11111111111111111111111111111111111111112'), 'standard')
    assert.equal(bucketForGen2Mint(GEN2_STEEL_ONE_OF_ONE_MINT, map), 'one-of-one')
    console.log('test-gen2-one-of-one-classify: ok')
  })().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}