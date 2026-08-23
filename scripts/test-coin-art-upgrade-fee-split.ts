import assert from 'node:assert/strict'

import {
  computeCoinArtUpgradeFeeBreakdown,
  getCoinArtUpgradeFeeSplitConfig,
} from '../lib/coin-upgrade/fee-split'

process.env.COIN_ART_UPGRADE_FEE_SOL = '0.1'
delete process.env.FOUNDER_A_WALLET
delete process.env.FOUNDER_B_WALLET
delete process.env.COIN_ART_UPGRADE_SPLIT_A_WALLET
delete process.env.COIN_ART_UPGRADE_SPLIT_B_WALLET

const split = getCoinArtUpgradeFeeSplitConfig()
assert.ok(split)
assert.equal(split.percentA, 50)
assert.equal(split.percentB, 50)
assert.equal(split.walletA, '7gra2JyY969Lt3BXLb6FMx9DxouXcEpRzpiKnc6wFgrq')
assert.equal(split.walletB, 'qg7pNNZq7qDQuc6Xkd1x4NvS2VM3aHtCqHEzucZxRGA')

const one = computeCoinArtUpgradeFeeBreakdown(1, split)
assert.equal(one.totalLamports, 100_000_000n)
assert.equal(one.walletALamports, 50_000_000n)
assert.equal(one.walletBLamports, 50_000_000n)

const three = computeCoinArtUpgradeFeeBreakdown(3, split)
assert.equal(three.totalLamports, 300_000_000n)
assert.equal(three.walletALamports, 150_000_000n)
assert.equal(three.walletBLamports, 150_000_000n)

console.log('coin art upgrade fee split tests passed')
