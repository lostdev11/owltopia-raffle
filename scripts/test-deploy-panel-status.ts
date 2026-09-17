/**
 * Unit checks for deploy panel status helpers.
 * Run: npx --yes tsx --test scripts/test-deploy-panel-status.ts
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  configLineProgressPercent,
  formatConfigLineProgress,
  formatDeploySuccessMessage,
  isDeployWorkInProgress,
  isLikelyDeployTransportError,
} from '../lib/owl-center/deploy-panel-status'
import { owlCenterCoreDeployLoadTimeBudgetMs } from '../lib/owl-center/cm-deploy-limits'

describe('deploy panel status helpers', () => {
  it('detects in-progress deploy phases', () => {
    assert.equal(isDeployWorkInProgress({ deploy_state: { status: 'loading_items' } }), true)
    assert.equal(isDeployWorkInProgress({ deploy_state: { status: 'running' } }), true)
    assert.equal(isDeployWorkInProgress({ fully_deployed: true, deploy_state: { status: 'loading_items' } }), false)
    assert.equal(isDeployWorkInProgress({ deploy_state: { status: 'completed' } }), false)
  })

  it('formats config line progress for 1010 supply', () => {
    assert.equal(
      formatConfigLineProgress({
        deploy_state: { config_lines_loaded: 770, config_lines_total: 1010 },
      }),
      '770 / 1010 items (76%)'
    )
    assert.equal(
      configLineProgressPercent({
        deploy_state: { config_lines_loaded: 1010, config_lines_total: 1010 },
      }),
      100
    )
  })

  it('formats success messages with go-live outcomes', () => {
    const msg = formatDeploySuccessMessage({
      candyMachineId: '4mdwvpf4enEH1TqSDPgUwXg95s3KgPfeuHi3ytRvfZdz',
      collectionMint: 'E5U1jxEJrXCTZinj7feVgvJK9cs99vtMs8DmABA6r2Ma',
      goLiveOk: true,
    })
    assert.match(msg, /^Success — Candy Machine deployed/)
    assert.match(msg, /live to mint/)
  })

  it('classifies transport/timeout errors for watch mode', () => {
    assert.equal(isLikelyDeployTransportError(new TypeError('Failed to fetch')), true)
    const abort = new Error('The operation was aborted')
    abort.name = 'AbortError'
    assert.equal(isLikelyDeployTransportError(abort), true)
    assert.equal(isLikelyDeployTransportError(new Error('Deployer wallet needs more SOL')), false)
  })

  it('defaults Core load rounds to 90s for UI checkpoints', () => {
    const prev = process.env.OWL_CENTER_CORE_DEPLOY_LOAD_TIME_BUDGET_MS
    delete process.env.OWL_CENTER_CORE_DEPLOY_LOAD_TIME_BUDGET_MS
    assert.equal(owlCenterCoreDeployLoadTimeBudgetMs(), 90_000)
    if (prev === undefined) delete process.env.OWL_CENTER_CORE_DEPLOY_LOAD_TIME_BUDGET_MS
    else process.env.OWL_CENTER_CORE_DEPLOY_LOAD_TIME_BUDGET_MS = prev
  })
})
