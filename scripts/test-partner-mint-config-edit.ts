import assert from 'node:assert/strict'
import { buildMintDetailsPatchFromBody } from '@/lib/owl-center/launch-mint-config-patch'
import {
  applyMintOpensDate,
  defaultMintDetailsFormValues,
  mintDetailsFormFromLaunch,
  mintDetailsPayloadFromForm,
  parseMintDetailsConfig,
  resolveMintOpensAt,
  resolveMintOpensIsoForPatch,
} from '@/lib/owl-center/launch-mint-config'
import { datetimeLocalToIso, isoToDatetimeLocal } from '@/lib/owl-center/phase-schedule'
import type { OwlCenterLaunchPublic } from '@/lib/owl-center/types'

function baseLaunch(overrides: Partial<OwlCenterLaunchPublic> = {}): OwlCenterLaunchPublic {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    slug: 'sub-test',
    name: 'Test',
    symbol: 'TST',
    description: null,
    image_url: null,
    mint_standard: 'core',
    total_supply: 5,
    minted_count: 0,
    active_phase: 'PUBLIC',
    active_phases: [],
    status: 'PENDING_REVIEW',
    presale_supply: 0,
    wl_supply: 0,
    public_supply: 5,
    airdrop_supply: 0,
    presale_overage_supply: 0,
    presale_price_usdc: null,
    wl_price_usdc: null,
    public_price_usdc: null,
    wallet_mint_limit: 5,
    magic_eden_url: null,
    tensor_url: null,
    orbis_url: null,
    is_featured: false,
    is_paused: true,
    launch_deadline_at: null,
    phase_schedule: {},
    candy_machine_id: null,
    collection_mint: null,
    devnet_candy_machine_id: null,
    devnet_collection_mint: null,
    mint_mode: 'public_simple',
    mint_network: 'mainnet',
    creator_wallet: 'Creator1111111111111111111111111111111111111',
    treasury_wallet: 'Creator1111111111111111111111111111111111111',
    royalty_splits: [{ address: 'Creator1111111111111111111111111111111111111', share: 100 }],
    mint_fund_splits: [{ address: 'Creator1111111111111111111111111111111111111', share: 100 }],
    seller_fee_basis_points: 500,
    creator_presale_enabled: false,
    creator_wl_enabled: false,
    creator_mint_price: 0,
    creator_mint_currency: 'SOL',
    creator_launch_date: null,
    assets_ready: false,
    metadata_ready: false,
    marketplace_ready: false,
    generator_project_id: null,
    reveal_mode: null,
    reveal_status: 'disabled',
    reveal_at: null,
    reveal_completed_at: null,
    reveal_payment_tx_signature: null,
    placeholder_metadata_uri: null,
    reveal_progress: null,
    freeze_enabled: false,
    unfreeze_date: null,
    freeze_status: 'disabled',
    freeze_authority: null,
    freeze_thawed_at: null,
    freeze_progress: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  } as OwlCenterLaunchPublic
}

const unlocked = buildMintDetailsPatchFromBody(
  {
    total_supply: 222,
    mint_standard: 'core',
    public_price: '0',
    currency: 'SOL',
    wallet_mint_limit: 5,
    royalty_percent: 5,
  },
  baseLaunch()
)
assert.ok(!('error' in unlocked), 'unlocked supply edit should succeed')
assert.equal(unlocked.total_supply, 222)
assert.equal(unlocked.public_supply, 222)
assert.equal(unlocked.mint_standard, 'core')

const locked = buildMintDetailsPatchFromBody(
  { total_supply: 222, mint_standard: 'core', public_price: '1', currency: 'SOL', wallet_mint_limit: 5 },
  baseLaunch({ candy_machine_id: 'Cm11111111111111111111111111111111111111111', total_supply: 5 })
)
assert.ok('error' in locked, 'supply change should fail when CM exists')
assert.match(String(locked.error), /locked/i)

console.log('ok: partner mint-config supply/core patch locks')

// datetime-local without seconds must parse (Safari's Date() rejects this form).
const localKickoff = '2026-08-20T14:00'
const localIso = datetimeLocalToIso(localKickoff)
assert.ok(localIso, 'datetime-local without seconds should parse')
assert.match(localIso!, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
assert.equal(datetimeLocalToIso('2026-08-20T18:00:00.000Z'), '2026-08-20T18:00:00.000Z')
assert.equal(datetimeLocalToIso('2026-06-26T16:00:00+00'), '2026-06-26T16:00:00.000Z')
assert.equal(datetimeLocalToIso(''), null)
assert.equal(isoToDatetimeLocal(localIso), localKickoff)

const creatorWallet = 'Creator1111111111111111111111111111111111111'
function dateForm(partial: Parameters<typeof defaultMintDetailsFormValues>[0]) {
  return defaultMintDetailsFormValues({
    royalty_splits: [{ address: creatorWallet, share: '100' }],
    mint_fund_splits: [{ address: creatorWallet, share: '100' }],
    ...partial,
  })
}

const simplePayload = mintDetailsPayloadFromForm(
  dateForm({
    total_supply: '100',
    public_price: '1',
    launch_date: localKickoff,
    public_start: '',
  })
)
assert.equal(simplePayload.launch_date, localIso)
assert.ok(!(simplePayload.launch_date == null), 'mint opens must not be sent as null')

const simpleParsed = parseMintDetailsConfig(simplePayload)
assert.ok(!('error' in simpleParsed), 'simple mint date parse should succeed')
assert.equal(simpleParsed.launch_deadline_at, localIso)
assert.equal(simpleParsed.phase_schedule.PUBLIC, localIso, 'single-phase copies mint opens → PUBLIC')
assert.equal(simpleParsed.phase_schedule.AIRDROP, localIso)

const simplePatch = buildMintDetailsPatchFromBody(simplePayload, baseLaunch())
assert.ok(!('error' in simplePatch), 'simple mint date patch should succeed')
assert.equal(simplePatch.launch_deadline_at, localIso)
assert.equal(simplePatch.creator_launch_date, localIso)
assert.equal(simplePatch.phase_schedule?.PUBLIC, localIso)

const leftoverPublic = '2026-08-26T16:30'
const movedBack = mintDetailsPayloadFromForm(
  dateForm({
    total_supply: '100',
    public_price: '1',
    launch_date: localKickoff,
    public_start: leftoverPublic,
  })
)
assert.equal(movedBack.launch_date, localIso)
assert.equal(movedBack.public_start, localIso, 'simple mint: Mint opens overwrites a later Public start')
const movedBackParsed = parseMintDetailsConfig(movedBack)
assert.ok(!('error' in movedBackParsed))
assert.equal(movedBackParsed.launch_deadline_at, localIso)
assert.equal(movedBackParsed.phase_schedule.PUBLIC, localIso)
const movedBackPatch = buildMintDetailsPatchFromBody(
  movedBack,
  baseLaunch({
    launch_deadline_at: datetimeLocalToIso(leftoverPublic),
    phase_schedule: { PUBLIC: datetimeLocalToIso(leftoverPublic)! },
  })
)
assert.ok(!('error' in movedBackPatch))
assert.equal(movedBackPatch.launch_deadline_at, localIso)
assert.equal(movedBackPatch.phase_schedule?.PUBLIC, localIso)

const publicEditedOnly = '2026-09-24T08:44'
const publicEditedIso = datetimeLocalToIso(publicEditedOnly)
const publicEditedPayload = mintDetailsPayloadFromForm(
  dateForm({
    total_supply: '100',
    public_price: '1',
    launch_date: leftoverPublic,
    public_start: publicEditedOnly,
  })
)
const publicEditedPatch = buildMintDetailsPatchFromBody(
  {
    ...publicEditedPayload,
    launch_date: datetimeLocalToIso(leftoverPublic),
    public_start: publicEditedIso,
  },
  baseLaunch({
    launch_deadline_at: datetimeLocalToIso(leftoverPublic),
    phase_schedule: { PUBLIC: datetimeLocalToIso(leftoverPublic)! },
  })
)
assert.ok(!('error' in publicEditedPatch))
assert.equal(publicEditedPatch.launch_deadline_at, publicEditedIso, 'editing only Public start still moves mint opens')
assert.equal(publicEditedPatch.phase_schedule?.PUBLIC, publicEditedIso)

const sepLocal = '2026-09-24T09:44'
const sepIso = datetimeLocalToIso(sepLocal)
const allowlistSepPatch = buildMintDetailsPatchFromBody(
  mintDetailsPayloadFromForm(
    applyMintOpensDate(
      dateForm({
        total_supply: '100',
        public_price: '1',
        launch_date: leftoverPublic,
        public_start: leftoverPublic,
        wl_enabled: true,
        allowlist_phases: [{ key: 'wl', label: 'Whitelist', start: '2026-08-20T12:00', supply: '20', price: '10' }],
      }),
      sepLocal
    )
  ),
  baseLaunch({
    launch_deadline_at: datetimeLocalToIso(leftoverPublic),
    phase_schedule: { PUBLIC: datetimeLocalToIso(leftoverPublic)! },
    creator_wl_enabled: true,
    wl_supply: 20,
  })
)
assert.ok(!('error' in allowlistSepPatch))
assert.equal(allowlistSepPatch.launch_deadline_at, sepIso, 'allowlist Aug→Sep mint opens')
assert.equal(allowlistSepPatch.phase_schedule?.PUBLIC, sepIso)

assert.equal(
  resolveMintOpensIsoForPatch({
    kickoff: datetimeLocalToIso(leftoverPublic),
    requestedPublic: sepIso,
    previousKickoff: datetimeLocalToIso(leftoverPublic),
    previousPublic: datetimeLocalToIso(leftoverPublic),
    hasQueuedPhases: true,
  }),
  sepIso,
  'allowlist: editing only Public start moves mint opens'
)

assert.equal(datetimeLocalToIso('2026-08-24 15:44:00+00'), '2026-08-24T15:44:00.000Z')

const publicOnly = '2026-08-22T16:30'
const publicIso = datetimeLocalToIso(publicOnly)
const publicPayload = mintDetailsPayloadFromForm(
  dateForm({
    total_supply: '100',
    public_price: '1',
    launch_date: '',
    public_start: publicOnly,
  })
)
const publicParsed = parseMintDetailsConfig(publicPayload)
assert.ok(!('error' in publicParsed))
assert.equal(publicParsed.launch_deadline_at, null)
assert.equal(publicParsed.phase_schedule.PUBLIC, publicIso)

const wlStart = '2026-08-20T12:00'
const publicStart = '2026-08-20T18:00'
const wlPayload = mintDetailsPayloadFromForm(
  dateForm({
    total_supply: '100',
    public_price: '1',
    launch_date: localKickoff,
    public_start: publicStart,
    wl_enabled: true,
    allowlist_phases: [{ key: 'wl', label: 'Whitelist', start: wlStart, supply: '20', price: '10' }],
  })
)
const wlStartIso = datetimeLocalToIso(wlStart)
const publicStartIso = datetimeLocalToIso(publicStart)
assert.equal((wlPayload.allowlist_phases as { start: string }[])[0]?.start, wlStartIso)

const wlParsed = parseMintDetailsConfig(wlPayload)
assert.ok(!('error' in wlParsed), 'allowlist mint dates should parse')
assert.equal(wlParsed.launch_deadline_at, localIso)
assert.equal(wlParsed.phase_schedule.PUBLIC, publicStartIso)
assert.equal(wlParsed.phase_schedule.WHITELIST, wlStartIso)
assert.equal(wlParsed.partner_allowlist_phases[0]?.starts_at, wlStartIso)

const wlPatch = buildMintDetailsPatchFromBody(wlPayload, baseLaunch({ creator_wl_enabled: true, wl_supply: 20 }))
assert.ok(!('error' in wlPatch))
assert.equal(wlPatch.launch_deadline_at, localIso)
assert.equal(wlPatch.phase_schedule?.PUBLIC, publicStartIso)
assert.equal(wlPatch.partner_allowlist_phases?.[0]?.starts_at, wlStartIso)

const leftoverPublicIso = datetimeLocalToIso(leftoverPublic)
const wlLeftoverForm = applyMintOpensDate(
  dateForm({
    total_supply: '100',
    public_price: '1',
    launch_date: leftoverPublic,
    public_start: leftoverPublic,
    wl_enabled: true,
    allowlist_phases: [{ key: 'wl', label: 'Whitelist', start: wlStart, supply: '20', price: '10' }],
  }),
  localKickoff
)
assert.equal(wlLeftoverForm.launch_date, localKickoff)
assert.equal(wlLeftoverForm.public_start, localKickoff, 'changing Mint opens also moves Public start')

const wlSyncedPayload = mintDetailsPayloadFromForm(wlLeftoverForm)
assert.equal(wlSyncedPayload.launch_date, localIso)
assert.equal(wlSyncedPayload.public_start, localIso)

const wlSyncedPatch = buildMintDetailsPatchFromBody(
  wlSyncedPayload,
  baseLaunch({
    launch_deadline_at: leftoverPublicIso,
    phase_schedule: { PUBLIC: leftoverPublicIso! },
    creator_wl_enabled: true,
    wl_supply: 20,
  })
)
assert.ok(!('error' in wlSyncedPatch))
assert.equal(wlSyncedPatch.launch_deadline_at, localIso)
assert.equal(wlSyncedPatch.phase_schedule?.PUBLIC, localIso, 'allowlist: Mint opens copy must persist PUBLIC')

const wlUnchangedPublicPayload = mintDetailsPayloadFromForm(
  dateForm({
    total_supply: '100',
    public_price: '1',
    launch_date: localKickoff,
    public_start: leftoverPublic,
    wl_enabled: true,
    allowlist_phases: [{ key: 'wl', label: 'Whitelist', start: wlStart, supply: '20', price: '10' }],
  })
)
const wlUnchangedPublicPatch = buildMintDetailsPatchFromBody(
  wlUnchangedPublicPayload,
  baseLaunch({
    launch_deadline_at: leftoverPublicIso,
    phase_schedule: { PUBLIC: leftoverPublicIso! },
    creator_wl_enabled: true,
    wl_supply: 20,
  })
)
assert.ok(!('error' in wlUnchangedPublicPatch))
assert.equal(wlUnchangedPublicPatch.launch_deadline_at, localIso)
assert.equal(
  wlUnchangedPublicPatch.phase_schedule?.PUBLIC,
  localIso,
  'allowlist: leftover Public start matching previous PUBLIC follows Mint opens'
)

assert.equal(
  resolveMintOpensAt({
    launch_deadline_at: localIso,
    phase_schedule: { PUBLIC: leftoverPublicIso! },
  }),
  localIso,
  'cards show Mint opens, not a leftover later PUBLIC'
)

const reloaded = mintDetailsFormFromLaunch(
  baseLaunch({
    launch_deadline_at: localIso,
    phase_schedule: { PUBLIC: publicStartIso!, WHITELIST: wlStartIso!, AIRDROP: localIso! },
    creator_wl_enabled: true,
    wl_supply: 20,
    partner_allowlist_phases: [
      { key: 'wl', label: 'Whitelist', starts_at: wlStartIso!, supply: 20, price_usdc: 10 },
    ],
  })
)
assert.equal(reloaded.launch_date, localKickoff)
assert.equal(reloaded.public_start, publicStart)
assert.equal(reloaded.allowlist_phases[0]?.start, wlStart)

const bad = parseMintDetailsConfig({
  total_supply: 10,
  public_price: 1,
  currency: 'SOL',
  wallet_mint_limit: 5,
  launch_date: 'not-a-date',
})
assert.ok('error' in bad)
assert.match(String(bad.error), /mint open date/i)

const rawLocal = parseMintDetailsConfig({
  total_supply: 10,
  public_price: 1,
  currency: 'SOL',
  wallet_mint_limit: 5,
  launch_date: localKickoff,
})
assert.ok(!('error' in rawLocal), 'server must accept datetime-local mint opens')
assert.equal(rawLocal.launch_deadline_at, localIso)
assert.equal(rawLocal.phase_schedule.PUBLIC, localIso)

const jsonRoundTrip = parseMintDetailsConfig(JSON.parse(JSON.stringify(simplePayload)) as Record<string, unknown>)
assert.ok(!('error' in jsonRoundTrip))
assert.equal(jsonRoundTrip.launch_deadline_at, localIso)

const syncedAllowlistForm = applyMintOpensDate(
  dateForm({
    total_supply: '100',
    public_price: '1',
    launch_date: localKickoff,
    public_start: localKickoff,
    wl_enabled: true,
    allowlist_phases: [{ key: 'wl', label: 'Whitelist', start: localKickoff, supply: '20', price: '10' }],
  }),
  sepLocal
)
assert.equal(syncedAllowlistForm.allowlist_phases[0]?.start, sepLocal, 'allowlist start tied to mint opens follows kickoff')

const staleWlIso = datetimeLocalToIso('2026-08-24T11:48')
const staleWlPatch = buildMintDetailsPatchFromBody(
  mintDetailsPayloadFromForm(
    dateForm({
      total_supply: '100',
      public_price: '1',
      launch_date: sepLocal,
      public_start: sepLocal,
      wl_enabled: true,
      allowlist_phases: [{ key: 'wl', label: 'Whitelist', start: '2026-08-24T11:48', supply: '20', price: '10' }],
    })
  ),
  baseLaunch({
    launch_deadline_at: staleWlIso,
    phase_schedule: { PUBLIC: staleWlIso!, WHITELIST: staleWlIso! },
    creator_wl_enabled: true,
    wl_supply: 20,
    partner_allowlist_phases: [
      { key: 'wl', label: 'Whitelist', starts_at: staleWlIso!, supply: 20, price_usdc: 10 },
    ],
  })
)
assert.ok(!('error' in staleWlPatch))
assert.equal(staleWlPatch.launch_deadline_at, sepIso, 'stale WL save moves mint opens')
assert.equal(staleWlPatch.partner_allowlist_phases?.[0]?.starts_at, sepIso, 'stale WL before kickoff clamps to mint opens')

console.log('ok: partner mint-config date save round-trip')

