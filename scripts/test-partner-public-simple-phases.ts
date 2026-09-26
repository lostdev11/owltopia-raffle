/**
 * Partner public_simple: guard plan gates, phase windows, config warnings.
 * Run: npx --yes tsx scripts/test-partner-public-simple-phases.ts
 */
import assert from 'node:assert/strict'

import { buildPartnerMintConfigWarnings } from '../lib/owl-center/partner-mint-config-warnings'
import {
  isPartnerAllowlistPhaseWindowOpen,
  resolvePartnerAllowlistPhaseEndDateIso,
} from '../lib/owl-center/partner-phase-window'
import { formatPartnerPhaseGateSyncError, resolvePartnerPhaseOnChainGate } from '../lib/owl-center/partner-phase-gates'
import { buildPublicSimpleGuardPlanForLaunch } from '../lib/owl-center/public-simple-guard-plan'
import type { PartnerAllowlistPhase } from '../lib/owl-center/partner-allowlist-phases'

const DEST = 'DNoggcEL6DGdQAjaqxK7v5ktZchvXKtZdkaN6FPx2Fj1'

function phase(overrides: Partial<PartnerAllowlistPhase>): PartnerAllowlistPhase {
  return {
    key: 'wl',
    label: 'Whitelist',
    starts_at: '2026-08-24T11:48:00.000Z',
    supply: 222,
    price_usdc: 9,
    price_sol: null,
    wallet_mint_limit: 4,
    ...overrides,
  }
}

async function main() {
  const publicStart = '2026-08-24T13:45:00.000Z'
  const legacyEnd = resolvePartnerAllowlistPhaseEndDateIso(
    phase({}),
    0,
    [phase({})],
    publicStart
  )
  assert.equal(legacyEnd, publicStart)

  const openEnded = resolvePartnerAllowlistPhaseEndDateIso(
    phase({ concurrent_with_public: true }),
    0,
    [phase({ concurrent_with_public: true })],
    publicStart
  )
  assert.equal(openEnded, null)

  assert.equal(
    resolvePartnerPhaseOnChainGate(phase({}), {
      merkleRootBase58: null,
      merkleWalletCount: 0,
      phaseIndex: 0,
    }),
    null
  )
  assert.match(formatPartnerPhaseGateSyncError('WL'), /no on-chain gate/)

  const warnings = buildPartnerMintConfigWarnings({
    total_supply: 888,
    wallet_mint_limit: 888,
    public_supply: 50,
    wl_supply: 888,
    phase_schedule: { PUBLIC: '2026-01-01T12:00:00.000Z', WHITELIST: '2026-01-01T12:00:00.000Z' },
    partner_allowlist_phases: [
      phase({
        starts_at: '2026-01-01T12:00:00.000Z',
        supply: 888,
        wallet_mint_limit: 888,
      }),
    ],
  })
  assert.ok(warnings.some((w) => w.code === 'wl_public_same_minute'))
  assert.ok(warnings.some((w) => w.code === 'wallet_limit_ge_supply'))
  assert.ok(warnings.some((w) => w.code === 'phase_supply_split'))

  const concurrentOpen = isPartnerAllowlistPhaseWindowOpen(
    phase({ concurrent_with_public: true, starts_at: '2026-01-01T12:00:00.000Z' }),
    0,
    {
      phase_schedule: { PUBLIC: '2026-01-01T12:00:00.000Z' },
      partner_allowlist_phases: [phase({ concurrent_with_public: true })],
    },
    new Date('2026-01-01T13:00:00.000Z').getTime()
  )
  assert.equal(concurrentOpen, true)

  console.log('ok — partner public_simple phases')
}

void main()
