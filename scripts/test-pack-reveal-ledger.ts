import assert from 'node:assert/strict'
import { packRevealMessage } from '../lib/packs/reveal-message'
import { packOpenVerifyJsonToClientResult } from '../lib/packs/pack-open-client-result'

assert.equal(
  packRevealMessage({ category: 'owl', prizeLabel: '10 $OWL' }),
  'You won 10 $OWL — sent to your wallet'
)
assert.equal(
  packRevealMessage({ category: 'sol', prizeLabel: '0.05 SOL' }),
  'You won 0.05 SOL'
)
assert.equal(
  packRevealMessage({
    category: 'jackpot',
    prizeLabel: '1.2 SOL Jackpot',
    isJackpotWin: true,
  }),
  'You won the 1.2 SOL Jackpot!'
)

const restored = packOpenVerifyJsonToClientResult({
  id: '00000000-0000-4000-8000-000000000001',
  status: 'completed',
  category: 'nft',
  prizeLabel: 'Cool Owl',
  nftMint: 'mint',
  openSeed: 'seed',
  openCommitHash: 'hash',
  revealMessage: 'You won Cool Owl',
})
assert.ok(restored)
assert.equal(restored!.category, 'nft')
assert.equal(restored!.openId, '00000000-0000-4000-8000-000000000001')

assert.equal(packOpenVerifyJsonToClientResult({ id: 'x', status: 'paid', category: 'owl' }), null)

console.log('test-pack-reveal-ledger: ok')
