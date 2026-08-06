/**
 * Support: diagnose nesting claim fee payments that never received OWL.
 * Usage: npx --yes tsx scripts/inspect-claim-fee-orphans.ts <wallet>
 *
 * Reads platform-fee treasury on-chain (no DB required). Flags duplicate claim-sized
 * SOL payments with no linked OWL payout in the same window.
 */
import { Connection, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js'

const UNIT_LAMPORTS = 1_000_000 // 0.001 SOL default nesting fee
const LOOKBACK = 50

function rpcUrl(): string {
  return (
    process.env.SOLANA_RPC_URL?.trim() ||
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL?.trim() ||
    'https://api.mainnet-beta.solana.com'
  )
}

function treasury(): string {
  return (
    process.env.OWL_PLATFORM_FEE_TREASURY_WALLET?.trim() ||
    process.env.NEXT_PUBLIC_OWL_PLATFORM_FEE_TREASURY_WALLET?.trim() ||
    '7YxQg8HkwvH1L6iuY28JNWzJ96GWEx4qD8CK4M6nYkAY'
  )
}

function owlMint(): string | null {
  return process.env.NEXT_PUBLIC_OWL_MINT_ADDRESS?.trim() || null
}

async function main() {
  const wallet = process.argv[2]?.trim()
  if (!wallet) {
    console.error('Usage: npx --yes tsx scripts/inspect-claim-fee-orphans.ts <wallet>')
    process.exit(1)
  }

  const conn = new Connection(rpcUrl(), 'confirmed')
  const treasuryPk = new PublicKey(treasury())
  const walletPk = new PublicKey(wallet)

  const sigs = await conn.getSignaturesForAddress(walletPk, { limit: LOOKBACK })
  const feePayments: Array<{
    signature: string
    units: number
    sol: number
    blockTime: string | null
  }> = []

  for (const s of sigs) {
    if (s.err) continue
    const tx = await conn.getParsedTransaction(s.signature, {
      maxSupportedTransactionVersion: 0,
      commitment: 'confirmed',
    })
    if (!tx?.meta || tx.meta.err) continue
    const keys = tx.transaction.message.accountKeys.map((k) =>
      typeof k === 'string' ? k : k.pubkey.toBase58()
    )
    const tIdx = keys.findIndex((k) => k === treasuryPk.toBase58())
    if (tIdx < 0) continue
    const delta = (tx.meta.postBalances[tIdx] ?? 0) - (tx.meta.preBalances[tIdx] ?? 0)
    if (delta < UNIT_LAMPORTS) continue
    if (delta % UNIT_LAMPORTS !== 0) continue
    const units = delta / UNIT_LAMPORTS
    feePayments.push({
      signature: s.signature,
      units,
      sol: delta / LAMPORTS_PER_SOL,
      blockTime: s.blockTime ? new Date(s.blockTime * 1000).toISOString() : null,
    })
  }

  let owlBalance: string | null = null
  const mint = owlMint()
  if (mint) {
    try {
      const atas = await conn.getParsedTokenAccountsByOwner(walletPk, {
        mint: new PublicKey(mint),
      })
      owlBalance =
        atas.value[0]?.account.data.parsed?.info?.tokenAmount?.uiAmountString ?? '0'
    } catch {
      owlBalance = 'unreadable'
    }
  }

  const byUnits = new Map<number, typeof feePayments>()
  for (const p of feePayments) {
    const list = byUnits.get(p.units) ?? []
    list.push(p)
    byUnits.set(p.units, list)
  }

  const duplicates = [...byUnits.entries()].filter(([, list]) => list.length > 1)

  console.log(
    JSON.stringify(
      {
        wallet,
        treasury: treasuryPk.toBase58(),
        owl_mint: mint,
        owl_balance_ui: owlBalance,
        claim_sized_fee_payments: feePayments,
        duplicate_unit_groups: duplicates.map(([units, list]) => ({
          units,
          count: list.length,
          total_sol_paid: list.reduce((s, p) => s + p.sol, 0),
          refund_candidate_signatures: list.slice(1).map((p) => p.signature),
          keep_for_claim_retry: list[0]?.signature ?? null,
          note:
            'Newest payment is kept for Claim retry (fee reuse). Older duplicates are refund candidates if no OWL claim tx exists.',
        })),
        support: {
          do_not_ask_third_fee:
            'Tell user to wait for fee-reuse deploy (PR #71) or retry Claim without approving a new SOL fee.',
          refund:
            'Refund 0.001 SOL × units for each duplicate orphan fee from platform fee treasury.',
        },
      },
      null,
      2
    )
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
