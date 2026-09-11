import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { isOwlCenterCreatorUaHandoffEnabled } from '../lib/owl-center/creator-ua-flags'

/** Local mirror of parseOnchainDeployState status gate (keeps test free of server-only). */
function parseDeployStatus(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null
  const status = (raw as { status?: unknown }).status
  if (
    status !== 'running' &&
    status !== 'cm_ready' &&
    status !== 'ua_handed_off' &&
    status !== 'completed' &&
    status !== 'failed'
  ) {
    return null
  }
  return status
}

function canRetryHandoff(input: {
  mint_standard: string
  handoffEnabled: boolean
  jobCompleted: boolean
  cmId: string | null
  colMint: string | null
  deployStatus: string | null
}): boolean {
  const pending =
    input.mint_standard === 'core' &&
    input.handoffEnabled &&
    input.jobCompleted &&
    Boolean(input.cmId && input.colMint) &&
    (input.deployStatus === 'cm_ready' || input.deployStatus === 'failed')
  return pending && input.deployStatus !== 'running'
}

function orbisCopy(input: {
  mintStandard?: string
  creatorOwnsUpdateAuthority?: boolean
}): string {
  if (input.mintStandard !== 'core' && input.mintStandard != null) {
    return 'tm_contact_support'
  }
  if (input.creatorOwnsUpdateAuthority === false) return 'claim_first'
  if (input.creatorOwnsUpdateAuthority) return 'verify_as_ua'
  return 'core_after_ua'
}

describe('creator UA handoff helpers', () => {
  it('defaults handoff enabled unless explicitly disabled', () => {
    const prev = process.env.OWL_CENTER_CREATOR_UA_HANDOFF
    delete process.env.OWL_CENTER_CREATOR_UA_HANDOFF
    assert.equal(isOwlCenterCreatorUaHandoffEnabled(), true)
    process.env.OWL_CENTER_CREATOR_UA_HANDOFF = 'false'
    assert.equal(isOwlCenterCreatorUaHandoffEnabled(), false)
    if (prev === undefined) delete process.env.OWL_CENTER_CREATOR_UA_HANDOFF
    else process.env.OWL_CENTER_CREATOR_UA_HANDOFF = prev
  })

  it('accepts cm_ready and ua_handed_off checkpoint statuses', () => {
    assert.equal(parseDeployStatus({ status: 'cm_ready' }), 'cm_ready')
    assert.equal(parseDeployStatus({ status: 'ua_handed_off' }), 'ua_handed_off')
    assert.equal(parseDeployStatus({ status: 'nope' }), null)
  })

  it('allows handoff retry when cm_ready with CM ids present', () => {
    assert.equal(
      canRetryHandoff({
        mint_standard: 'core',
        handoffEnabled: true,
        jobCompleted: true,
        cmId: 'Cm11111111111111111111111111111111111111111',
        colMint: 'Col1111111111111111111111111111111111111111',
        deployStatus: 'cm_ready',
      }),
      true
    )
    assert.equal(
      canRetryHandoff({
        mint_standard: 'core',
        handoffEnabled: true,
        jobCompleted: true,
        cmId: null,
        colMint: null,
        deployStatus: 'cm_ready',
      }),
      false
    )
    assert.equal(
      canRetryHandoff({
        mint_standard: 'token_metadata',
        handoffEnabled: true,
        jobCompleted: true,
        cmId: 'Cm11111111111111111111111111111111111111111',
        colMint: 'Col1111111111111111111111111111111111111111',
        deployStatus: 'cm_ready',
      }),
      false
    )
  })

  it('gates Orbis verify copy by mint standard and UA ownership', () => {
    assert.equal(orbisCopy({ mintStandard: 'token_metadata' }), 'tm_contact_support')
    assert.equal(orbisCopy({ mintStandard: 'core', creatorOwnsUpdateAuthority: false }), 'claim_first')
    assert.equal(orbisCopy({ mintStandard: 'core', creatorOwnsUpdateAuthority: true }), 'verify_as_ua')
  })
})
