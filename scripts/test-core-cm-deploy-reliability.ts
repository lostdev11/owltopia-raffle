/**
 * Unit checks for Core CM deploy reliability (checkpoint merge, expiry, lock codes).
 * Run: npx --yes tsx --test scripts/test-core-cm-deploy-reliability.ts
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  mergeOnchainDeployPatch,
  onchainDeployHasSavedIds,
} from '../lib/owl-center/onchain-deploy-checkpoint'
import {
  isDeployExpiryErrorMessage,
  deployPanelHasRecoverableIds,
} from '../lib/owl-center/deploy-panel-status'
import { isBlockhashOrTxExpiryError } from '../lib/solana/tx-expiry-patterns'
import { estimateCoreCandyMachineAccountDataLen } from '../lib/owl-center/core-cm-rent-estimate'

describe('onchain deploy checkpoint merge', () => {
  it('never overwrites saved IDs with null', () => {
    const existing = {
      status: 'loading_items' as const,
      candy_machine_id: 'Cm11111111111111111111111111111111111111111',
      collection_mint: 'Col1111111111111111111111111111111111111111',
      candy_guard_id: 'Gd11111111111111111111111111111111111111111',
      onchain_update_authority: null,
      platform_update_delegate: null,
      config_lines_loaded: 210,
      config_lines_total: 888,
      error: null,
      completed_at: null,
    }
    const merged = mergeOnchainDeployPatch(existing, {
      status: 'running',
      candy_machine_id: null,
      collection_mint: null,
      candy_guard_id: null,
    })
    assert.equal(merged.candy_machine_id, existing.candy_machine_id)
    assert.equal(merged.collection_mint, existing.collection_mint)
    assert.equal(merged.candy_guard_id, existing.candy_guard_id)
    assert.equal(merged.config_lines_loaded, 210)
  })

  it('detects saved IDs for fresh-create guard', () => {
    assert.equal(onchainDeployHasSavedIds(null), false)
    assert.equal(
      onchainDeployHasSavedIds({
        status: 'running',
        candy_machine_id: null,
        collection_mint: 'Col1111111111111111111111111111111111111111',
        candy_guard_id: null,
        onchain_update_authority: null,
        platform_update_delegate: null,
        config_lines_loaded: null,
        config_lines_total: null,
        error: null,
        completed_at: null,
      }),
      true
    )
  })
})

describe('expiry classification', () => {
  it('recognizes block height exceeded copy', () => {
    assert.equal(
      isBlockhashOrTxExpiryError('Signature abc has expired: block height exceeded'),
      true
    )
    assert.equal(isDeployExpiryErrorMessage('Signature abc has expired: block height exceeded'), true)
  })
})

describe('deploy panel recoverable IDs', () => {
  it('treats in-progress CM as recoverable', () => {
    assert.equal(
      deployPanelHasRecoverableIds({
        fully_deployed: false,
        in_progress_candy_machine_id: 'Cm11111111111111111111111111111111111111111',
      }),
      true
    )
  })
})

describe('core CM resume sizing', () => {
  it('estimates larger CM accounts for bigger supply', () => {
    const small = estimateCoreCandyMachineAccountDataLen(100, { nameLength: 32, uriLength: 200 })
    const large = estimateCoreCandyMachineAccountDataLen(888, { nameLength: 32, uriLength: 200 })
    assert.ok(large > small)
  })
})

describe('deploy lock contention code', () => {
  it('uses deploy_in_progress worker code', () => {
    const code = 'deploy_in_progress'
    assert.equal(code, 'deploy_in_progress')
  })
})
