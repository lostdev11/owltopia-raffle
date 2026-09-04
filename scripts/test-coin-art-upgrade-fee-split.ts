import assert from 'node:assert/strict'

process.env.COIN_ART_UPGRADE_FEE_SOL = '0.1'
delete process.env.FOUNDER_A_WALLET
delete process.env.FOUNDER_B_WALLET
delete process.env.COIN_ART_UPGRADE_SPLIT_A_WALLET
delete process.env.COIN_ART_UPGRADE_SPLIT_B_WALLET
delete process.env.COIN_ART_UPGRADE_PLATFORM_FEE_USDC

import {
  computeCoinArtUpgradeFeeBreakdown,
  getCoinArtUpgradeFeeSplitConfig,
} from '../lib/coin-upgrade/fee-split'
import {
  formatCoinArtUpgradePlatformFeeBatchLabel,
  formatCoinArtUpgradePlatformFeeLabel,
  getCoinArtUpgradeFeeSol,
  getCoinArtUpgradePlatformFeeUsd,
} from '../lib/coin-upgrade/config'

assert.equal(getCoinArtUpgradeFeeSol(), 0.1)
assert.equal(getCoinArtUpgradePlatformFeeUsd(), 0.5)
assert.equal(formatCoinArtUpgradePlatformFeeLabel(0.5), '50¢ platform fee per coin')
assert.equal(formatCoinArtUpgradePlatformFeeBatchLabel(3, 0.5), '$1.50 platform fee (3 × 50¢)')

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
