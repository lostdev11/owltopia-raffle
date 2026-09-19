/**
 * Unit checks for Core CM large-deploy checkpoints (resumable config-line loading).
 * Run: npx --yes tsx --test scripts/test-core-cm-large-deploy.ts
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  configLinesFullyLoaded,
  parseOnchainDeployState,
} from '../lib/owl-center/onchain-deploy-state'
import {
  OWL_CENTER_SERVER_CM_DEPLOY_MAX_SUPPLY,
  owlCenterCoreDeployLoadTimeBudgetMs,
  owlCenterCoreServerCmDeployMaxSupply,
} from '../lib/owl-center/cm-deploy-limits'

describe('core CM large deploy checkpoints', () => {
  it('parses loading_items with config line progress', () => {
    const state = parseOnchainDeployState({
      onchain_deploy: {
        status: 'loading_items',
        candy_machine_id: 'Cm11111111111111111111111111111111111111111',
        collection_mint: 'Col1111111111111111111111111111111111111111',
        candy_guard_id: 'Gd11111111111111111111111111111111111111111',
        config_lines_loaded: 250,
        config_lines_total: 1010,
      },
    })
    assert.ok(state)
    assert.equal(state.status, 'loading_items')
    assert.equal(state.config_lines_loaded, 250)
    assert.equal(state.config_lines_total, 1010)
    assert.equal(configLinesFullyLoaded(state), false)
  })

  it('treats 1010/1010 as fully loaded', () => {
    const state = parseOnchainDeployState({
      onchain_deploy: {
        status: 'cm_ready',
        candy_machine_id: 'Cm11111111111111111111111111111111111111111',
        collection_mint: 'Col1111111111111111111111111111111111111111',
        config_lines_loaded: 1010,
        config_lines_total: 1010,
      },
    })
    assert.equal(configLinesFullyLoaded(state), true)
  })

  it('legacy cm_ready without line counts counts as fully loaded', () => {
    const state = parseOnchainDeployState({
      onchain_deploy: {
        status: 'cm_ready',
        candy_machine_id: 'Cm11111111111111111111111111111111111111111',
        collection_mint: 'Col1111111111111111111111111111111111111111',
      },
    })
    assert.equal(configLinesFullyLoaded(state), true)
  })

  it('rejects unknown status', () => {
    assert.equal(parseOnchainDeployState({ onchain_deploy: { status: 'nope' } }), null)
  })

  it('keeps TM one-shot cap at 250 while Core ceiling is higher', () => {
    assert.equal(OWL_CENTER_SERVER_CM_DEPLOY_MAX_SUPPLY, 250)
    const prev = process.env.OWL_CENTER_CORE_SERVER_CM_DEPLOY_MAX_SUPPLY
    delete process.env.OWL_CENTER_CORE_SERVER_CM_DEPLOY_MAX_SUPPLY
    assert.equal(owlCenterCoreServerCmDeployMaxSupply(), 10_000)
    assert.ok(owlCenterCoreServerCmDeployMaxSupply() > 1010)
    process.env.OWL_CENTER_CORE_SERVER_CM_DEPLOY_MAX_SUPPLY = '2000'
    assert.equal(owlCenterCoreServerCmDeployMaxSupply(), 2000)
    if (prev === undefined) delete process.env.OWL_CENTER_CORE_SERVER_CM_DEPLOY_MAX_SUPPLY
    else process.env.OWL_CENTER_CORE_SERVER_CM_DEPLOY_MAX_SUPPLY = prev
  })

  it('time budget stays under serverless maxDuration headroom', () => {
    const prev = process.env.OWL_CENTER_CORE_DEPLOY_LOAD_TIME_BUDGET_MS
    delete process.env.OWL_CENTER_CORE_DEPLOY_LOAD_TIME_BUDGET_MS
    const ms = owlCenterCoreDeployLoadTimeBudgetMs()
    assert.equal(ms, 90_000)
    assert.ok(ms <= 280_000)
    if (prev === undefined) delete process.env.OWL_CENTER_CORE_DEPLOY_LOAD_TIME_BUDGET_MS
    else process.env.OWL_CENTER_CORE_DEPLOY_LOAD_TIME_BUDGET_MS = prev
  })
})
