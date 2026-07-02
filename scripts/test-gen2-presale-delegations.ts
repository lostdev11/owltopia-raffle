/**
 * Gen2 PRESALE "switch wallet for mint" (delegation) invariants.
 *
 * Pure functions only — no DB / network. Run: npx tsx scripts/test-gen2-presale-delegations.ts
 */
import { substitutePresaleDelegations } from '../lib/db/gen2-presale-delegations'
import { decideGen1Delegation } from '../lib/owl-center/gen2-mint-delegation'

const SOURCE = 'CUxWSsDtDScrnU4mSsQ8wo9jd187jrjigG272HZrgKr2'
const MINT = 'HmcJ7ifDvZrZBsDdWXEEsFz7fVobDndDy4ommsh1ChwP'
const OTHER = '7BU48rrJwxJT5148TUmJ9VuQ1Ls4nSy9b2x1sg9THCKh'

const delegations = [{ source_wallet: SOURCE, mint_wallet: MINT }]

// --- 1) Source wallet maps to mint wallet in merkle list ---
{
  const out = substitutePresaleDelegations([SOURCE, OTHER], delegations)
  if (!out.includes(MINT) || out.includes(SOURCE)) {
    throw new Error('expected source replaced by mint in merkle list')
  }
}

// --- 2) No delegations: list unchanged ---
{
  const out = substitutePresaleDelegations([SOURCE, OTHER], [])
  if (out.length !== 2 || out[0] !== SOURCE) throw new Error('passthrough failed')
}

// --- 3) Mint wallet blocked when it delegated away as source ---
{
  const d = decideGen1Delegation(null, { mint_wallet: MINT })
  if (d.kind !== 'delegated_away' || d.mint_wallet !== MINT) throw new Error('delegated_away failed')
}

// --- 4) Mint wallet credits source ---
{
  const d = decideGen1Delegation({ source_wallet: SOURCE }, null)
  if (d.kind !== 'on_behalf' || d.source_wallet !== SOURCE) throw new Error('on_behalf failed')
}

console.log('gen2-presale-delegations: ok')
