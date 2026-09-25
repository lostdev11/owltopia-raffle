/**
 * Ops: top up prize escrow SOL shortfall from the dedicated VRF fee wallet.
 *
 * Usage (from a machine that has production secrets — never commit them):
 *   npx --yes tsx --env-file=.env.local scripts/ops-topup-prize-escrow-from-vrf.ts
 *   npx --yes tsx --env-file=.env.local scripts/ops-topup-prize-escrow-from-vrf.ts --amount-sol=0.48
 *   npx --yes tsx --env-file=.env.local scripts/ops-topup-prize-escrow-from-vrf.ts --dry-run
 *
 * Requires VRF_FEE_PAYER_SECRET_KEY. Destination defaults to GET /api/config/prize-escrow
 * or PRIZE_ESCROW public key derived from PRIZE_ESCROW_SECRET_KEY / --to=.
 */
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js'
import { DEFAULT_VRF_FEE_PAYER_WALLET } from '../lib/raffles/vrf-fee-payer'

const FEE_BUFFER_LAMPORTS = 5_000
const VRF_LEAVE_LAMPORTS = 50_000_000 // keep ~0.05 SOL in VRF after send
const DEFAULT_PRIZE_NEED_LAMPORTS = 1_000_000_000 + FEE_BUFFER_LAMPORTS // 1 SOL prize + fee

function parseSecretKey(raw: string | undefined): Keypair | null {
  const trimmed = raw?.trim()
  if (!trimmed) return null
  try {
    const parsed = JSON.parse(trimmed) as number[]
    if (Array.isArray(parsed) && parsed.length >= 64) {
      return Keypair.fromSecretKey(Uint8Array.from(parsed))
    }
  } catch {
    // not JSON
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const bs58 = require('bs58') as { decode: (s: string) => Uint8Array }
    return Keypair.fromSecretKey(bs58.decode(trimmed))
  } catch {
    return null
  }
}

function argValue(name: string): string | null {
  const prefix = `--${name}=`
  const hit = process.argv.find((a) => a.startsWith(prefix))
  return hit ? hit.slice(prefix.length) : null
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`)
}

async function resolvePrizeEscrowAddress(): Promise<string> {
  const fromArg = argValue('to')?.trim()
  if (fromArg) return fromArg

  const fromEnv = process.env.PRIZE_ESCROW_WALLET?.trim() || process.env.NEXT_PUBLIC_PRIZE_ESCROW_WALLET?.trim()
  if (fromEnv) return fromEnv

  const prizeKp = parseSecretKey(process.env.PRIZE_ESCROW_SECRET_KEY)
  if (prizeKp) return prizeKp.publicKey.toBase58()

  const base = (process.env.OWLTOPIA_BASE_URL || 'https://www.owltopia.xyz').replace(/\/$/, '')
  const res = await fetch(`${base}/api/config/prize-escrow`)
  if (!res.ok) {
    throw new Error(`Failed to fetch prize escrow address from ${base}/api/config/prize-escrow (${res.status})`)
  }
  const json = (await res.json()) as { address?: string }
  if (!json.address?.trim()) throw new Error('prize-escrow config returned no address')
  return json.address.trim()
}

function resolveRpc(): string {
  return (
    process.env.SOLANA_RPC_URL?.trim() ||
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL?.trim() ||
    'https://api.mainnet-beta.solana.com'
  )
}

async function main() {
  const dryRun = hasFlag('dry-run')
  const vrfKp = parseSecretKey(process.env.VRF_FEE_PAYER_SECRET_KEY)
  if (!vrfKp) {
    throw new Error('VRF_FEE_PAYER_SECRET_KEY is required (JSON byte array or base58).')
  }

  const expected =
    process.env.VRF_FEE_PAYER_EXPECTED_WALLET?.trim() || DEFAULT_VRF_FEE_PAYER_WALLET
  const vrfPk = vrfKp.publicKey.toBase58()
  if (vrfPk !== expected) {
    throw new Error(
      `VRF key pubkey ${vrfPk} does not match expected ${expected}. Aborting.`
    )
  }

  const prizeAddress = await resolvePrizeEscrowAddress()
  const prizePk = new PublicKey(prizeAddress)
  const connection = new Connection(resolveRpc(), 'confirmed')

  const [vrfBal, prizeBal] = await Promise.all([
    connection.getBalance(vrfKp.publicKey, 'confirmed'),
    connection.getBalance(prizePk, 'confirmed'),
  ])

  const amountSolArg = argValue('amount-sol')
  let sendLamports: number
  if (amountSolArg != null) {
    const sol = Number(amountSolArg)
    if (!Number.isFinite(sol) || sol <= 0) throw new Error(`Invalid --amount-sol=${amountSolArg}`)
    sendLamports = Math.round(sol * LAMPORTS_PER_SOL)
  } else {
    const needArg = argValue('need-lamports')
    const need = needArg != null ? Number(needArg) : DEFAULT_PRIZE_NEED_LAMPORTS
    if (!Number.isFinite(need) || need <= 0) throw new Error('Invalid --need-lamports')
    sendLamports = Math.max(0, Math.floor(need - prizeBal))
  }

  if (sendLamports <= 0) {
    console.log(
      JSON.stringify(
        {
          ok: true,
          skipped: true,
          reason: 'Prize escrow already covers need; no top-up required',
          prizeEscrow: prizeAddress,
          prizeSol: prizeBal / LAMPORTS_PER_SOL,
          vrfSol: vrfBal / LAMPORTS_PER_SOL,
        },
        null,
        2
      )
    )
    return
  }

  const maxSend = Math.max(0, vrfBal - VRF_LEAVE_LAMPORTS - FEE_BUFFER_LAMPORTS)
  if (sendLamports > maxSend) {
    throw new Error(
      `Need to send ${sendLamports / LAMPORTS_PER_SOL} SOL but VRF only has ` +
        `${vrfBal / LAMPORTS_PER_SOL} SOL (leaving ${VRF_LEAVE_LAMPORTS / LAMPORTS_PER_SOL} SOL buffer). ` +
        `Max sendable: ${maxSend / LAMPORTS_PER_SOL} SOL.`
    )
  }

  const plan = {
    dryRun,
    from: vrfPk,
    to: prizeAddress,
    sendSol: sendLamports / LAMPORTS_PER_SOL,
    sendLamports,
    prizeBeforeSol: prizeBal / LAMPORTS_PER_SOL,
    prizeAfterSol: (prizeBal + sendLamports) / LAMPORTS_PER_SOL,
    vrfBeforeSol: vrfBal / LAMPORTS_PER_SOL,
    vrfAfterSol: (vrfBal - sendLamports) / LAMPORTS_PER_SOL,
  }
  console.log(JSON.stringify(plan, null, 2))

  if (dryRun) {
    console.log('dry-run: not sending')
    return
  }

  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: vrfKp.publicKey,
      toPubkey: prizePk,
      lamports: sendLamports,
    })
  )
  const sig = await sendAndConfirmTransaction(connection, tx, [vrfKp], {
    commitment: 'confirmed',
  })
  console.log(
    JSON.stringify(
      {
        ok: true,
        signature: sig,
        solscan: `https://solscan.io/tx/${sig}`,
        ...plan,
        dryRun: false,
      },
      null,
      2
    )
  )
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
