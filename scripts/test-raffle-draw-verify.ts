import assert from 'node:assert/strict'
import { Keypair, Transaction, PublicKey, SystemProgram } from '@solana/web3.js'
import {
  buildDrawLedger,
  encodeDrawRevealMemo,
  parseDrawRevealMemo,
  performDraw,
  performDrawV1,
  pickWinnerIndexV1,
  verifyDraw,
  walletForTicketIndex,
  hashDrawCommit,
  generateDrawSeed,
  seedFromVrfBytes,
  seedFromVrfHex,
  extractVrfValueHex,
  isSwitchboardRandomnessRevealed,
  keypairWallet,
  resolveVrfDrawLedger,
  vrfRequestReachedChain,
  isSwitchboardGatewayTransientError,
  isVrfRevealTimeoutError,
  isInvalidVrfSecpSignatureError,
  isRetryableVrfRevealError,
  resolveVrfRevealWaitMs,
  vrfRevealRetryDelayMs,
  shouldAutoForceNewVrfRequest,
  resolveAdminVrfForceNewRequest,
  DRAW_ALGO_V1,
  DRAW_ALGO_V2_COMMIT_REVEAL,
  DRAW_ALGO_V3_VRF,
} from '../lib/raffles/draw'

const entries = [
  {
    id: 'b',
    wallet_address: 'WalletBbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    ticket_quantity: 2,
    status: 'confirmed',
    verified_at: '2026-01-02T00:00:00.000Z',
  },
  {
    id: 'a',
    wallet_address: 'WalletAaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    ticket_quantity: 3,
    status: 'confirmed',
    verified_at: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'c',
    wallet_address: 'WalletCccccccccccccccccccccccccccccccccc',
    ticket_quantity: 1,
    status: 'pending',
  },
  {
    id: 'd',
    wallet_address: 'WalletAaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    ticket_quantity: 1,
    status: 'confirmed',
    refunded_at: '2026-01-03T00:00:00.000Z',
  },
]

const ledger = buildDrawLedger(entries)
assert.equal(ledger.soldCount, 5, 'pending + refunded excluded')
assert.equal(ledger.ranges.length, 2)
assert.equal(ledger.ranges[0]!.wallet.startsWith('WalletA'), true)
assert.equal(ledger.ranges[0]!.tickets, 3)
assert.equal(ledger.ranges[0]!.startIndex, 0)
assert.equal(ledger.ranges[0]!.endIndex, 3)
assert.equal(ledger.ranges[1]!.tickets, 2)
assert.equal(ledger.ranges[1]!.startIndex, 3)
assert.equal(ledger.ranges[1]!.endIndex, 5)

assert.equal(walletForTicketIndex(ledger.ranges, 0), ledger.ranges[0]!.wallet)
assert.equal(walletForTicketIndex(ledger.ranges, 2), ledger.ranges[0]!.wallet)
assert.equal(walletForTicketIndex(ledger.ranges, 3), ledger.ranges[1]!.wallet)
assert.equal(walletForTicketIndex(ledger.ranges, 4), ledger.ranges[1]!.wallet)
assert.equal(walletForTicketIndex(ledger.ranges, 5), null)

const seed = 'By8uYnrSXufy4gVaXi1E9qC8XNGq6FtFadxUTDgLZVUn'
const idx = pickWinnerIndexV1(seed, 5)
assert.ok(idx >= 0 && idx < 5)
assert.equal(pickWinnerIndexV1(seed, 5), idx, 'deterministic')

const draw = performDrawV1(entries, seed)
assert.equal(draw.algo, DRAW_ALGO_V1)
assert.equal(draw.soldCount, 5)
assert.equal(draw.winnerIndex, idx)
assert.equal(draw.ledgerHash, ledger.ledgerHash)
assert.equal(draw.winnerWallet, walletForTicketIndex(ledger.ranges, idx))

const memo = encodeDrawRevealMemo({
  algo: DRAW_ALGO_V1,
  raffleId: 'raffle-uuid-1',
  drawSeed: seed,
  soldCount: draw.soldCount,
  winnerIndex: draw.winnerIndex,
  ledgerHash: draw.ledgerHash,
})
const parsed = parseDrawRevealMemo(memo)
assert.ok(parsed)
assert.equal(parsed!.algo, DRAW_ALGO_V1)
assert.equal(parsed!.raffleId, 'raffle-uuid-1')
assert.equal(parsed!.drawSeed, seed)
assert.equal(parsed!.soldCount, 5)
assert.equal(parsed!.winnerIndex, draw.winnerIndex)
assert.equal(parsed!.ledgerHash, draw.ledgerHash)

const ok = verifyDraw({
  algo: DRAW_ALGO_V1,
  drawSeed: seed,
  soldCount: draw.soldCount,
  winnerIndex: draw.winnerIndex,
  winnerWallet: draw.winnerWallet,
  ledgerHash: draw.ledgerHash,
  entries,
})
assert.equal(ok.ok, true)

const bad = verifyDraw({
  algo: DRAW_ALGO_V1,
  drawSeed: seed,
  soldCount: draw.soldCount,
  winnerIndex: (draw.winnerIndex + 1) % draw.soldCount,
  winnerWallet: draw.winnerWallet,
  ledgerHash: draw.ledgerHash,
  entries,
})
assert.equal(bad.ok, false)

// --- v2 commit–reveal ---
const v2Seed = generateDrawSeed()
const commit = hashDrawCommit(v2Seed)
assert.equal(hashDrawCommit(v2Seed), commit, 'commit hash deterministic')
assert.notEqual(hashDrawCommit(generateDrawSeed()), commit, 'different seeds → different commits')

const v2Draw = performDraw(entries, {
  algo: DRAW_ALGO_V2_COMMIT_REVEAL,
  drawSeed: v2Seed,
  drawCommitHash: commit,
})
assert.equal(v2Draw.algo, DRAW_ALGO_V2_COMMIT_REVEAL)
assert.equal(v2Draw.drawSeed, v2Seed)
assert.equal(v2Draw.drawCommitHash, commit)
assert.equal(v2Draw.winnerIndex, pickWinnerIndexV1(v2Seed, 5))

assert.throws(
  () =>
    performDraw(entries, {
      algo: DRAW_ALGO_V2_COMMIT_REVEAL,
      drawSeed: v2Seed,
      drawCommitHash: hashDrawCommit('wrong-seed-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
    }),
  /does not match/
)

const v2Ok = verifyDraw({
  algo: DRAW_ALGO_V2_COMMIT_REVEAL,
  drawSeed: v2Seed,
  drawCommitHash: commit,
  soldCount: v2Draw.soldCount,
  winnerIndex: v2Draw.winnerIndex,
  winnerWallet: v2Draw.winnerWallet,
  ledgerHash: v2Draw.ledgerHash,
  entries,
})
assert.equal(v2Ok.ok, true)
if (v2Ok.ok) {
  assert.equal(v2Ok.recomputedCommitHash, commit)
}

const v2BadCommit = verifyDraw({
  algo: DRAW_ALGO_V2_COMMIT_REVEAL,
  drawSeed: v2Seed,
  drawCommitHash: hashDrawCommit('other-seed-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'),
  soldCount: v2Draw.soldCount,
  winnerIndex: v2Draw.winnerIndex,
  winnerWallet: v2Draw.winnerWallet,
  ledgerHash: v2Draw.ledgerHash,
  entries,
})
assert.equal(v2BadCommit.ok, false)

const v2MissingCommit = verifyDraw({
  algo: DRAW_ALGO_V2_COMMIT_REVEAL,
  drawSeed: v2Seed,
  soldCount: v2Draw.soldCount,
  winnerIndex: v2Draw.winnerIndex,
  winnerWallet: v2Draw.winnerWallet,
  ledgerHash: v2Draw.ledgerHash,
  entries,
})
assert.equal(v2MissingCommit.ok, false)

// --- v3 VRF seed mapping (same index math; entropy from VRF bytes) ---
const vrfBytes = Buffer.alloc(32, 7)
const vrfSeed = seedFromVrfBytes(vrfBytes)
assert.equal(vrfSeed.length, 64)
assert.equal(seedFromVrfHex(vrfSeed), vrfSeed)
assert.equal(seedFromVrfHex('0x' + vrfSeed), vrfSeed)

// Revealed Switchboard value is often a number[] (Anchor decode) — not Buffer/Uint8Array.
const revealedArr = Array.from({ length: 32 }, (_, i) => (i === 0 ? 155 : i + 40))
assert.equal(
  extractVrfValueHex(revealedArr),
  '9b292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f4041424344454647'
)
assert.equal(extractVrfValueHex(Buffer.alloc(32, 0)), null)
assert.equal(extractVrfValueHex(null), null)
assert.equal(isSwitchboardRandomnessRevealed({ revealSlot: 0, value: Buffer.alloc(32, 0) }), false)
assert.equal(isSwitchboardRandomnessRevealed({ revealSlot: 437080823, value: Buffer.alloc(32, 0) }), true)
assert.equal(isSwitchboardRandomnessRevealed({ revealSlot: 0, value: revealedArr }), true)
assert.equal(
  isSwitchboardRandomnessRevealed({ revealSlot: { toNumber: () => 99 }, value: null }),
  true
)

// --- VRF reveal resilience policy (gateway 503 / timeout auto-recovery) ---
{
  assert.equal(
    isSwitchboardGatewayTransientError(
      'Gateway: fetchRandomnessReveal failed (status 503, code ERR_BAD_RESPONSE)'
    ),
    true
  )
  assert.equal(
    isVrfRevealTimeoutError(
      'VRF reveal timed out after 45000ms: Gateway: fetchRandomnessReveal failed (status 503, code ERR_BAD_RESPONSE)'
    ),
    true
  )
  assert.equal(
    isRetryableVrfRevealError(
      'VRF reveal timed out after 75000ms: Gateway: fetchRandomnessReveal failed (status 503, code ERR_BAD_RESPONSE)'
    ),
    true
  )
  assert.equal(isSwitchboardGatewayTransientError('Account does not exist'), false)
  assert.equal(
    isInvalidVrfSecpSignatureError(
      'VRF reveal timed out after 75000ms: Simulation failed. custom program error: 0x1780. InvalidSecpSignature'
    ),
    true
  )
  assert.equal(
    isRetryableVrfRevealError(
      'VRF reveal timed out after 75000ms: Simulation failed. custom program error: 0x1780. InvalidSecpSignature'
    ),
    true
  )
  assert.equal(
    resolveAdminVrfForceNewRequest({
      draw_vrf_account: 'Rand111111111111111111111111111111111111111',
      draw_vrf_status: 'failed',
      draw_vrf_error:
        'VRF reveal timed out after 75000ms: Simulation failed. Error Code: InvalidSecpSignature. Error Number: 6016.',
      draw_vrf_requested_at: '2026-08-04T16:59:30.000Z',
    }),
    false
  )
  assert.ok(resolveVrfRevealWaitMs() >= 10_000)
  assert.equal(resolveVrfRevealWaitMs(12_000), 12_000)
  assert.ok(vrfRevealRetryDelayMs({ attemptIndex: 0, lastError: 'status 503' }) >= 4000)
  assert.ok(
    vrfRevealRetryDelayMs({ attemptIndex: 0, lastError: 'Randomness not ready' }) <
      vrfRevealRetryDelayMs({ attemptIndex: 0, lastError: 'status 503' })
  )
  assert.equal(
    vrfRevealRetryDelayMs({
      attemptIndex: 0,
      lastError: 'Simulation failed. InvalidSecpSignature. Error Number: 6016',
    }),
    2000
  )

  const now = Date.parse('2026-08-04T17:00:00.000Z')
  assert.equal(
    shouldAutoForceNewVrfRequest({
      drawVrfStatus: 'failed',
      drawVrfAccount: 'Rand111111111111111111111111111111111111111',
      drawVrfError:
        'VRF reveal timed out after 45000ms: Gateway: fetchRandomnessReveal failed (status 503, code ERR_BAD_RESPONSE)',
      drawVrfRequestedAt: '2026-08-04T16:50:00.000Z',
      nowMs: now,
    }),
    true
  )
  assert.equal(
    shouldAutoForceNewVrfRequest({
      drawVrfStatus: 'pending',
      drawVrfAccount: 'Rand111111111111111111111111111111111111111',
      drawVrfError: null,
      drawVrfRequestedAt: '2026-08-04T16:59:00.000Z',
      nowMs: now,
    }),
    false
  )
  assert.equal(
    shouldAutoForceNewVrfRequest({
      drawVrfStatus: 'failed',
      drawVrfAccount: 'Rand111111111111111111111111111111111111111',
      drawVrfError: 'Missing VRF account secret for pending request — use admin retry',
      drawVrfRequestedAt: '2026-08-04T16:59:30.000Z',
      nowMs: now,
    }),
    true
  )
  assert.equal(
    shouldAutoForceNewVrfRequest({
      drawVrfStatus: 'failed',
      drawVrfAccount: 'Rand111111111111111111111111111111111111111',
      drawVrfError:
        'VRF reveal timed out after 75000ms: Simulation failed. InvalidSecpSignature. Error Number: 6016.',
      drawVrfRequestedAt: '2026-08-04T16:59:30.000Z',
      nowMs: now,
    }),
    false
  )
  assert.equal(
    shouldAutoForceNewVrfRequest({
      drawVrfStatus: 'failed',
      drawVrfAccount: 'Rand111111111111111111111111111111111111111',
      drawVrfError:
        'VRF reveal timed out after 75000ms: Simulation failed. InvalidSecpSignature. Error Number: 6016.',
      drawVrfRequestedAt: '2026-08-04T16:56:00.000Z',
      nowMs: now,
    }),
    true
  )

  assert.equal(
    resolveAdminVrfForceNewRequest({
      draw_vrf_account: 'Rand111111111111111111111111111111111111111',
      draw_vrf_status: 'failed',
      draw_vrf_error:
        'VRF reveal timed out after 75000ms: Gateway: fetchRandomnessReveal failed (status 503, code ERR_BAD_RESPONSE)',
    }),
    true
  )
  assert.equal(
    resolveAdminVrfForceNewRequest({
      draw_vrf_account: 'Rand111111111111111111111111111111111111111',
      draw_vrf_status: 'pending',
      draw_vrf_error: null,
    }),
    false
  )
  assert.equal(resolveAdminVrfForceNewRequest({ draw_vrf_account: null }), true)
}

const v3Draw = performDraw(entries, { algo: DRAW_ALGO_V3_VRF, drawSeed: vrfSeed })
assert.equal(v3Draw.algo, DRAW_ALGO_V3_VRF)
assert.equal(v3Draw.winnerIndex, pickWinnerIndexV1(vrfSeed, 5))

assert.throws(
  () => performDraw(entries, { algo: DRAW_ALGO_V3_VRF }),
  /VRF|drawSeed/i
)

const v3Ok = verifyDraw({
  algo: DRAW_ALGO_V3_VRF,
  drawSeed: vrfSeed,
  soldCount: v3Draw.soldCount,
  winnerIndex: v3Draw.winnerIndex,
  winnerWallet: v3Draw.winnerWallet,
  ledgerHash: v3Draw.ledgerHash,
  entries,
})
assert.equal(v3Ok.ok, true)

// --- VRF wallet adapter (Anchor browser build has no Wallet constructor) ---
async function assertVrfKeypairWallet() {
  // Reproduce the production failure mode Next.js can hit via package "browser" field.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const browserAnchor = require('@coral-xyz/anchor-31/dist/browser/index.js') as {
    Wallet?: unknown
  }
  assert.equal(typeof browserAnchor.Wallet, 'undefined')
  assert.throws(() => {
    // Same shape as the old VRF path: `new (await import(...)).Wallet(payer)`
    // eslint-disable-next-line no-new, @typescript-eslint/no-explicit-any
    new (browserAnchor as any).Wallet(Keypair.generate())
  }, /Wallet is not a constructor/)

  const payer = Keypair.generate()
  const wallet = keypairWallet(payer)
  assert.ok(wallet.publicKey.equals(payer.publicKey))

  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: PublicKey.unique(),
      lamports: 1,
    })
  )
  tx.feePayer = payer.publicKey
  tx.recentBlockhash = PublicKey.default.toBase58()
  await wallet.signTransaction(tx)
  assert.equal(tx.signatures.filter((s) => s.signature != null).length >= 1, true)
}

// --- VRF ledger refresh when commit never reached chain (decentric-527-2 class) ---
{
  const liveEntries = entries.filter((e) => e.status === 'confirmed' && !e.refunded_at)
  const live = buildDrawLedger(liveEntries)
  assert.equal(vrfRequestReachedChain({ draw_vrf_account: null, draw_vrf_request_tx: null }), false)
  assert.equal(
    vrfRequestReachedChain({
      draw_vrf_account: 'Rand111111111111111111111111111111111111111',
      draw_vrf_request_tx: null,
    }),
    true
  )

  // Stale freeze from a Wallet-constructor failure (51 tickets) vs live 5 drawable tickets in fixture:
  // never reached chain → refresh to current ledger.
  const refreshed = resolveVrfDrawLedger({
    raffle: {
      draw_sold_count: 51,
      draw_ledger_hash: 'ff323f9376a337f788e6604d394b21fb548729984140befca433948a4a4fb550',
      draw_vrf_account: null,
      draw_vrf_request_tx: null,
    },
    entries: liveEntries,
  })
  assert.ok(!('error' in refreshed))
  if (!('error' in refreshed)) {
    assert.equal(refreshed.soldCount, live.soldCount)
    assert.equal(refreshed.ledgerHash, live.ledgerHash)
    assert.equal(refreshed.refreshed, true)
  }

  // Once randomness is on-chain, refuse ledger drift.
  const refused = resolveVrfDrawLedger({
    raffle: {
      draw_sold_count: 51,
      draw_ledger_hash: 'ff323f9376a337f788e6604d394b21fb548729984140befca433948a4a4fb550',
      draw_vrf_account: 'Rand111111111111111111111111111111111111111',
      draw_vrf_request_tx: 'CommitTx1111111111111111111111111111111111111',
    },
    entries: liveEntries,
  })
  assert.ok('error' in refused)
  if ('error' in refused) {
    assert.match(refused.error, /Frozen draw ledger/)
  }

  // Matching freeze + on-chain request → keep freeze.
  const kept = resolveVrfDrawLedger({
    raffle: {
      draw_sold_count: live.soldCount,
      draw_ledger_hash: live.ledgerHash,
      draw_vrf_account: 'Rand111111111111111111111111111111111111111',
      draw_vrf_request_tx: 'CommitTx1111111111111111111111111111111111111',
    },
    entries: liveEntries,
  })
  assert.ok(!('error' in kept))
  if (!('error' in kept)) {
    assert.equal(kept.refreshed, false)
    assert.equal(kept.soldCount, live.soldCount)
  }
}

// --- Switchboard commitIx must receive authority before account exists on-chain ---
async function assertVrfCommitIxNeedsAuthority() {
  // Networked regression: reproduces the Force-draw error
  // "Account does not exist or has no data <pubkey>" when commitIx() omits authority.
  if (process.env.SKIP_SWITCHBOARD_NETWORK_TEST === '1') {
    console.log('skip Switchboard network commitIx check (SKIP_SWITCHBOARD_NETWORK_TEST=1)')
    return
  }
  const sb = await import('@switchboard-xyz/on-demand')
  const connection = new (await import('@solana/web3.js')).Connection(
    'https://api.mainnet-beta.solana.com',
    'confirmed'
  )
  const payer = Keypair.generate()
  const wallet = keypairWallet(payer)
  const program = await sb.AnchorUtils.loadProgramFromConnection(connection, wallet)
  const queue = await sb.getDefaultQueue(connection.rpcEndpoint)
  const rngKp = Keypair.generate()
  const [randomness] = await sb.Randomness.create(
    program,
    rngKp,
    queue.pubkey,
    payer.publicKey
  )
  await assert.rejects(
    () => randomness.commitIx(queue.pubkey),
    /Account does not exist or has no data/
  )
  const commitIx = await randomness.commitIx(queue.pubkey, payer.publicKey)
  assert.ok(commitIx.keys?.length >= 1)
}

assertVrfKeypairWallet()
  .then(() => assertVrfCommitIxNeedsAuthority())
  .then(() => {
    console.log(
      'raffle draw verify ok (v1 + v2 commit–reveal + v3 VRF seed + wallet + ledger + commitIx)'
    )
  })
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
