/**
 * Gen2 AIRDROP "switch wallet for mint" (delegation) invariants.
 *
 * Locks in the two guarantees behind the admin wallet switch:
 *  1. The source wallet (holds Gen1, delegated away) is BLOCKED from minting — both in
 *     the live eligibility decision and by being substituted out of the merkle snapshot.
 *  2. The mint wallet is credited 1:1 and ends up in the merkle allowlist instead.
 *
 * Pure functions only — no DB / Helius. Run: npx tsx scripts/test-gen2-gen1-delegations.ts
 */
import assert from 'node:assert/strict'

import { substituteGen1Delegations } from '../lib/db/gen2-gen1-delegations'
import { decideGen1Delegation } from '../lib/owl-center/gen2-mint-delegation'

// Real, valid base58 Solana addresses (normalizeSolanaWalletAddress validates as PublicKey).
const SOURCE = 'FQvwDPBzP3DX2aDXYgSJ9aKgsStUQqQQUtMjdgeQg8Nq' // holds Gen1
const MINT = 'Fb2uFQtBaajs9SuTVLH73NkzrqbTSBfkweR1rWdNvhLN' // mints Gen2 on behalf
const OTHER = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' // an unrelated Gen1 holder

const delegations = [{ source_wallet: SOURCE, mint_wallet: MINT }]

// --- 1) Eligibility decision: a delegated source wallet is always blocked ---
{
  const d = decideGen1Delegation(null, { mint_wallet: MINT })
  assert.equal(d.kind, 'delegated_away')
  assert.equal(d.kind === 'delegated_away' && d.mint_wallet, MINT)
}

// --- 2) Eligibility decision: the mint wallet is credited via the source ---
{
  const d = decideGen1Delegation({ source_wallet: SOURCE }, null)
  assert.equal(d.kind, 'on_behalf')
  assert.equal(d.kind === 'on_behalf' && d.source_wallet, SOURCE)
}

// --- 3) Eligibility decision: a normal wallet checks itself ---
assert.equal(decideGen1Delegation(null, null).kind, 'self')

// --- 4) Source-first precedence: if a wallet is somehow both, it stays blocked ---
{
  const d = decideGen1Delegation({ source_wallet: OTHER }, { mint_wallet: MINT })
  assert.equal(d.kind, 'delegated_away')
}

// --- 5) Merkle snapshot: source's count moves to the mint wallet; source is removed ---
{
  const out = substituteGen1Delegations(
    [
      { wallet: SOURCE, gen1_nft_count: 3 },
      { wallet: OTHER, gen1_nft_count: 2 },
    ],
    delegations
  )
  const byWallet = new Map(out.map((r) => [r.wallet, r.gen1_nft_count]))
  assert.equal(byWallet.has(SOURCE), false, 'source must be substituted out of the merkle list')
  assert.equal(byWallet.get(MINT), 3, 'mint wallet inherits the source count')
  assert.equal(byWallet.get(OTHER), 2, 'unrelated holders are untouched')
}

// --- 6) Source missing from rows (e.g. CSV omitted it): mint wallet still added (count 1) ---
{
  const out = substituteGen1Delegations([{ wallet: OTHER, gen1_nft_count: 1 }], delegations)
  const byWallet = new Map(out.map((r) => [r.wallet, r.gen1_nft_count]))
  assert.equal(byWallet.get(MINT), 1, 'mint wallet is allowlisted even without a scanned source row')
  assert.equal(byWallet.has(SOURCE), false)
}

// --- 7) Mint wallet also independently holds Gen1: counts are summed, source removed ---
{
  const out = substituteGen1Delegations(
    [
      { wallet: SOURCE, gen1_nft_count: 2 },
      { wallet: MINT, gen1_nft_count: 1 },
    ],
    delegations
  )
  const byWallet = new Map(out.map((r) => [r.wallet, r.gen1_nft_count]))
  assert.equal(byWallet.get(MINT), 3, 'mint own + delegated counts sum')
  assert.equal(byWallet.has(SOURCE), false)
}

// --- 8) No delegations: rows pass through unchanged ---
{
  const rows = [{ wallet: SOURCE, gen1_nft_count: 1 }]
  assert.equal(substituteGen1Delegations(rows, []), rows)
}

console.log('gen2-gen1-delegations: ok')
