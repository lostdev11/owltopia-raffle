/**
 * Dry-run (default) audit of rent-exempt minimum vs balance on Owl Center platform accounts.
 * After SIMD-0437, funded accounts may hold withdrawable excess lamports.
 *
 * Usage:
 *   npx --yes tsx --env-file=.env.local scripts/audit-owl-center-rent-excess.ts
 *   npx --yes tsx --env-file=.env.local scripts/audit-owl-center-rent-excess.ts --execute
 *
 * `--execute` sends SPL Token WithdrawExcessLamports for controlled mint accounts only
 * (requires IRYS_PRIVATE_KEY or GEN2_GUARD_AUTHORITY_SECRET_KEY matching mint authority).
 * Never touches user wallets. Candy Machine / Candy Guard rows are always report-only.
 */
import bs58 from 'bs58'
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  sendAndConfirmTransaction,
  Transaction,
} from '@solana/web3.js'
import { getMint } from '@solana/spl-token'

import { getGen2MintProceedsWalletAddress } from '@/lib/owl-center/gen2-mint-proceeds'
import { getOwlCenterPlatformTreasuryWallet } from '@/lib/owl-center/platform-treasury'
import {
  auditCandyMachineLaunchCandidate,
  CM_GUARD_RECLAIM_DISCLAIMER,
  dedupeCmCandidates,
  formatCmGuardRentRow,
  type OwlCenterCmAuditCandidate,
} from '@/lib/solana/owl-center-cm-rent-audit'
import { resolveServerSolanaRpcUrl } from '@/lib/solana-rpc-url'
import {
  auditAccountRentExcess,
  createSplWithdrawExcessLamportsInstruction,
  type RentExcessAccountRow,
} from '@/lib/solana/rent-excess-lamports'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

function parseSecretKey(): Keypair | null {
  const raw =
    process.env.GEN2_GUARD_AUTHORITY_SECRET_KEY?.trim() || process.env.IRYS_PRIVATE_KEY?.trim()
  if (!raw) return null
  try {
    return Keypair.fromSecretKey(bs58.decode(raw))
  } catch {
    try {
      const arr = JSON.parse(raw) as number[]
      if (Array.isArray(arr) && arr.length >= 64) return Keypair.fromSecretKey(Uint8Array.from(arr))
    } catch {
      // ignore
    }
  }
  return null
}

function addUnique(set: Set<string>, value: string | null | undefined): void {
  const v = value?.trim()
  if (!v) return
  set.add(v)
}

type AuditCollectResult = {
  addresses: string[]
  controlled: Set<string>
  cmCandidates: OwlCenterCmAuditCandidate[]
}

async function collectAuditTargets(): Promise<AuditCollectResult> {
  const addresses = new Set<string>()
  const controlled = new Set<string>()
  const cmCandidates: OwlCenterCmAuditCandidate[] = []

  const pushCm = (id: string | null | undefined, network: 'mainnet' | 'devnet', launchSlug?: string) => {
    const v = id?.trim()
    if (!v) return
    cmCandidates.push({ candyMachineId: v, network, launchSlug })
  }

  addUnique(addresses, getOwlCenterPlatformTreasuryWallet())
  addUnique(addresses, getGen2MintProceedsWalletAddress())
  addUnique(addresses, process.env.NEXT_PUBLIC_GEN2_COLLECTION_MINT)
  pushCm(process.env.NEXT_PUBLIC_GEN2_CANDY_MACHINE_ID, 'mainnet', 'env-gen2')
  pushCm(process.env.GEN2_CANDY_MACHINE_ID, 'mainnet', 'env-gen2')
  addUnique(addresses, process.env.GEN2_COLLECTION_MINT)

  const extra = process.env.OWL_CENTER_RENT_AUDIT_EXTRA_ADDRS?.split(/[\s,]+/) ?? []
  for (const a of extra) addUnique(addresses, a)

  const kp = parseSecretKey()
  if (kp) {
    const b58 = kp.publicKey.toBase58()
    controlled.add(b58)
    addUnique(addresses, b58)
  }

  try {
    const { data: launches } = await getSupabaseAdmin()
      .from('owl_center_launches')
      .select('slug,candy_machine_id,collection_mint,devnet_candy_machine_id,devnet_collection_mint,mint_network')
    for (const row of launches ?? []) {
      pushCm(row.candy_machine_id, 'mainnet', row.slug ?? undefined)
      pushCm(row.devnet_candy_machine_id, 'devnet', row.slug ? `${row.slug}-devnet` : undefined)
      addUnique(addresses, row.collection_mint)
      addUnique(addresses, row.devnet_collection_mint)
    }
  } catch (e) {
    console.warn('Could not load owl_center_launches from Supabase — using env addresses only.', e)
  }

  const dedupedCm = dedupeCmCandidates(cmCandidates)
  const cmIdSet = new Set(dedupedCm.map((c) => c.candyMachineId))
  for (const id of cmIdSet) addresses.delete(id)

  return { addresses: [...addresses], controlled, cmCandidates: dedupedCm }
}

function printRow(row: RentExcessAccountRow): void {
  const excessSol = Number(row.excessLamports) / LAMPORTS_PER_SOL
  if (row.excessLamports <= 0n) return
  console.log(
    `  ${row.address}  excess ~${excessSol.toFixed(6)} SOL  owner=${row.ownerProgram}  data=${row.dataLen}B  ${row.reclaimKind}${row.reclaimNote ? ` — ${row.reclaimNote}` : ''}`
  )
}

async function tryExecuteSplWithdraw(
  connection: Connection,
  row: RentExcessAccountRow,
  authority: Keypair,
  destination: PublicKey
): Promise<void> {
  if (row.reclaimKind !== 'spl_withdraw_excess' || row.excessLamports <= 0n) return
  const mintPk = new PublicKey(row.address)
  const mint = await getMint(connection, mintPk, 'confirmed')
  if (!mint.mintAuthority || !mint.mintAuthority.equals(authority.publicKey)) {
    console.log(`  skip ${row.address} — mint authority is not the configured server key`)
    return
  }
  const ix = createSplWithdrawExcessLamportsInstruction({
    source: mintPk,
    destination,
    authority: authority.publicKey,
  })
  const tx = new Transaction().add(ix)
  const sig = await sendAndConfirmTransaction(connection, tx, [authority], { commitment: 'confirmed' })
  console.log(`  reclaimed from mint ${row.address}  tx=${sig}`)
}

async function main() {
  const execute = process.argv.includes('--execute')
  const rpc = resolveServerSolanaRpcUrl()
  const connection = new Connection(rpc, 'confirmed')
  const { addresses, controlled, cmCandidates } = await collectAuditTargets()

  console.log(`Owl Center rent excess audit (${execute ? 'EXECUTE (SPL mints only)' : 'dry-run'})`)
  console.log(`RPC: ${rpc}`)
  console.log('')

  console.log('=== Candy Machine / Candy Guard (Metaplex — report only) ===')
  console.log(CM_GUARD_RECLAIM_DISCLAIMER)
  console.log('')
  console.log(`CM candidates: ${cmCandidates.length}`)
  console.log('')

  let cmGuardExcess = 0n
  let cmGuardRows = 0

  for (const candidate of cmCandidates) {
    const bundle = await auditCandyMachineLaunchCandidate(connection, candidate)
    if (bundle.error) {
      console.log(
        `  CM ${bundle.candyMachineId} (${candidate.network})${bundle.launchSlug ? ` [${bundle.launchSlug}]` : ''}  — could not decode: ${bundle.error}`
      )
      continue
    }
    if (bundle.rows.length === 0) {
      console.log(`  CM ${bundle.candyMachineId} (${bundle.flavor}, ${candidate.network}) — no on-chain accounts found`)
      continue
    }
    console.log(
      `--- CM ${bundle.candyMachineId}  flavor=${bundle.flavor}  network=${candidate.network}${bundle.launchSlug ? `  launch=${bundle.launchSlug}` : ''} ---`
    )
    for (const row of bundle.rows) {
      console.log(`  ${formatCmGuardRentRow(row)}`)
      cmGuardExcess += row.excessLamports
      cmGuardRows += 1
    }
    console.log('')
  }

  console.log(
    `CM/guard excess subtotal: ~${(Number(cmGuardExcess) / LAMPORTS_PER_SOL).toFixed(6)} SOL across ${cmGuardRows} Metaplex account(s)`
  )
  console.log(
    'Next step when mint is fully done: close via Metaplex (deleteCandyMachine / withdraw + separate guard close) — not automated here.'
  )
  console.log('')

  console.log('=== Other platform addresses (treasury, collection mints, etc.) ===')
  console.log(`Accounts to scan: ${addresses.length}`)
  console.log('')

  let totalExcess = 0n
  let reclaimableSpl = 0n
  const rows: RentExcessAccountRow[] = []

  for (const addr of addresses) {
    const row = await auditAccountRentExcess(connection, addr, controlled)
    if (!row) {
      console.log(`  ${addr}  (missing)`)
      continue
    }
    rows.push(row)
    totalExcess += row.excessLamports
    if (row.reclaimKind === 'spl_withdraw_excess') reclaimableSpl += row.excessLamports
    printRow(row)
  }

  console.log('')
  console.log(
    `Other-address excess: ~${(Number(totalExcess) / LAMPORTS_PER_SOL).toFixed(6)} SOL across ${rows.length} accounts`
  )
  console.log(
    `SPL mint WithdrawExcessLamports candidates (controlled set): ~${(Number(reclaimableSpl) / LAMPORTS_PER_SOL).toFixed(6)} SOL`
  )
  console.log(
    `Combined excess (CM/guard + other): ~${(Number(cmGuardExcess + totalExcess) / LAMPORTS_PER_SOL).toFixed(6)} SOL`
  )

  if (!execute) {
    console.log('')
    console.log('Dry-run only. Re-run with --execute to send SPL mint WithdrawExcessLamports (platform key only).')
    return
  }

  const authority = parseSecretKey()
  if (!authority) {
    throw new Error('--execute requires IRYS_PRIVATE_KEY or GEN2_GUARD_AUTHORITY_SECRET_KEY')
  }
  const destination =
    getGen2MintProceedsWalletAddress() != null
      ? new PublicKey(getGen2MintProceedsWalletAddress()!)
      : authority.publicKey

  console.log('')
  console.log(`Executing SPL withdraw excess → ${destination.toBase58()} (CM/guard skipped)`)
  for (const row of rows) {
    await tryExecuteSplWithdraw(connection, row, authority, destination)
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('audit failed:', e)
    process.exit(1)
  })
