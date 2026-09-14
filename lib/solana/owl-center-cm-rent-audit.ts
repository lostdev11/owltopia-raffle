import { createUmi } from '@metaplex-foundation/umi-bundle-defaults'
import { mplCore } from '@metaplex-foundation/mpl-core'
import { fetchCandyMachine as fetchClassicCandyMachine, mplCandyMachine } from '@metaplex-foundation/mpl-candy-machine'
import { publicKey } from '@metaplex-foundation/umi'
import { Connection, PublicKey } from '@solana/web3.js'

import {
  fetchCandyMachine as fetchCoreCandyMachine,
  mplCoreCandyMachine,
  MPL_CORE_CANDY_GUARD_PROGRAM_ID,
  MPL_CORE_CANDY_MACHINE_CORE_PROGRAM_ID,
} from '@/lib/solana/core-candy-machine'
import type { OwlMintNetwork } from '@/lib/solana/network'
import { fetchMinRentLamports } from '@/lib/solana/rent-excess-lamports'
import { sanitizeRpcUrl } from '@/lib/solana-rpc-url'

const CLASSIC_CANDY_MACHINE_PROGRAM_ID = 'CndyV3LdqHUfDLmE5naZjVN8rBZz4tqhdefbAnjHG3JR'
const CLASSIC_CANDY_GUARD_PROGRAM_ID = 'Guard1JwRhJkVH6XZhzoYxeBVQe872VH6QggF4BWmS9g'

export type OwlCenterCmAuditCandidate = {
  candyMachineId: string
  network: OwlMintNetwork
  launchSlug?: string
}

export type CmGuardRentAuditRow = {
  address: string
  accountKind:
    | 'classic_candy_machine'
    | 'core_candy_machine'
    | 'classic_candy_guard'
    | 'core_candy_guard'
  ownerProgram: string
  balanceLamports: bigint
  minRentLamports: bigint
  excessLamports: bigint
  mintStatusHint: string
  launchSlug?: string
  candyMachineId: string
}

export type CmGuardRentAuditBundle = {
  candyMachineId: string
  launchSlug?: string
  flavor: 'classic' | 'core' | 'unknown'
  rows: CmGuardRentAuditRow[]
  error?: string
}

export const CM_GUARD_RECLAIM_DISCLAIMER =
  'Metaplex Candy Machine / Candy Guard accounts do NOT support WithdrawExcessLamports while the mint is open. ' +
  'Rent recovery is only after mint is finished: Core → deleteCandyMachine (+ close Core Candy Guard separately); ' +
  'classic Token Metadata CM → withdraw (+ close Candy Guard separately). This audit is report-only for CM/guard — no auto-close.'

function rpcForNetwork(network: OwlMintNetwork): string {
  if (network === 'devnet') {
    return sanitizeRpcUrl(
      process.env.SOLANA_RPC_DEVNET_URL?.trim() ||
        process.env.NEXT_PUBLIC_DEV_SOLANA_RPC_URL?.trim() ||
        'https://api.devnet.solana.com'
    )
  }
  return sanitizeRpcUrl(
    process.env.SOLANA_RPC_URL?.trim() ||
      process.env.NEXT_PUBLIC_SOLANA_RPC_URL?.trim() ||
      'https://api.mainnet-beta.solana.com'
  )
}

function formatMintStatus(itemsLoaded: number, itemsRedeemed: number): string {
  const remaining = Math.max(0, itemsLoaded - itemsRedeemed)
  if (itemsLoaded <= 0) return 'supply unreadable (itemsLoaded=0)'
  if (remaining === 0) return `sold out on-chain (${itemsRedeemed}/${itemsLoaded} minted)`
  if (itemsRedeemed === 0) return `not started (${itemsLoaded} loaded, 0 minted)`
  return `minting (${remaining} remaining · ${itemsRedeemed}/${itemsLoaded} minted)`
}

async function rowFromAccount(
  connection: Connection,
  address: string,
  accountKind: CmGuardRentAuditRow['accountKind'],
  mintStatusHint: string,
  candyMachineId: string,
  launchSlug?: string
): Promise<CmGuardRentAuditRow | null> {
  const info = await connection.getAccountInfo(new PublicKey(address), 'confirmed')
  if (!info) return null
  const minRent = await fetchMinRentLamports(connection, info.data.length)
  const balance = BigInt(info.lamports)
  const excess = balance > minRent ? balance - minRent : 0n
  return {
    address,
    accountKind,
    ownerProgram: info.owner.toBase58(),
    balanceLamports: balance,
    minRentLamports: minRent,
    excessLamports: excess,
    mintStatusHint,
    candyMachineId,
    launchSlug,
  }
}

export async function auditCandyMachineLaunchCandidate(
  connection: Connection,
  candidate: OwlCenterCmAuditCandidate
): Promise<CmGuardRentAuditBundle> {
  const cmId = candidate.candyMachineId.trim()
  const rpc = rpcForNetwork(candidate.network)
  const pk = publicKey(cmId)
  const bundle: CmGuardRentAuditBundle = {
    candyMachineId: cmId,
    launchSlug: candidate.launchSlug,
    flavor: 'unknown',
    rows: [],
  }

  let itemsLoaded = 0
  let itemsRedeemed = 0
  let guardAddress: string | null = null
  let cmKind: CmGuardRentAuditRow['accountKind'] | null = null

  try {
    const umi = createUmi(rpc, { commitment: 'confirmed' }).use(mplCandyMachine())
    const cm = await fetchClassicCandyMachine(umi, pk)
    bundle.flavor = 'classic'
    cmKind = 'classic_candy_machine'
    itemsLoaded = Number(cm.itemsLoaded)
    itemsRedeemed = Number(cm.itemsRedeemed)
    guardAddress = String(cm.mintAuthority)
  } catch {
    try {
      const umi = createUmi(rpc, { commitment: 'confirmed' }).use(mplCore()).use(mplCoreCandyMachine())
      const cm = await fetchCoreCandyMachine(umi, pk)
      bundle.flavor = 'core'
      cmKind = 'core_candy_machine'
      itemsLoaded = Number(cm.itemsLoaded)
      itemsRedeemed = Number(cm.itemsRedeemed)
      guardAddress = String(cm.mintAuthority)
    } catch (e) {
      bundle.error = e instanceof Error ? e.message : String(e)
      return bundle
    }
  }

  const statusHint = formatMintStatus(itemsLoaded, itemsRedeemed)

  const cmRow = await rowFromAccount(connection, cmId, cmKind!, statusHint, cmId, candidate.launchSlug)
  if (cmRow) bundle.rows.push(cmRow)

  if (guardAddress && guardAddress !== cmId) {
    const guardInfo = await connection.getAccountInfo(new PublicKey(guardAddress), 'confirmed')
    if (guardInfo) {
      const owner = guardInfo.owner.toBase58()
      let guardKind: CmGuardRentAuditRow['accountKind'] | null = null
      if (owner === CLASSIC_CANDY_GUARD_PROGRAM_ID) guardKind = 'classic_candy_guard'
      else if (owner === String(MPL_CORE_CANDY_GUARD_PROGRAM_ID)) guardKind = 'core_candy_guard'
      else if (
        owner !== CLASSIC_CANDY_MACHINE_PROGRAM_ID &&
        owner !== String(MPL_CORE_CANDY_MACHINE_CORE_PROGRAM_ID)
      ) {
        /* mintAuthority is not a candy guard PDA — skip guard row */
      }

      if (guardKind) {
        const guardRow = await rowFromAccount(
          connection,
          guardAddress,
          guardKind,
          `linked CM status: ${statusHint}`,
          cmId,
          candidate.launchSlug
        )
        if (guardRow) bundle.rows.push(guardRow)
      }
    }
  }

  return bundle
}

/** Dedupe by candyMachineId + network. */
export function dedupeCmCandidates(candidates: OwlCenterCmAuditCandidate[]): OwlCenterCmAuditCandidate[] {
  const seen = new Set<string>()
  const out: OwlCenterCmAuditCandidate[] = []
  for (const c of candidates) {
    const key = `${c.network}:${c.candyMachineId}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(c)
  }
  return out
}

export function formatCmGuardRentRow(row: CmGuardRentAuditRow): string {
  const bal = Number(row.balanceLamports) / 1e9
  const min = Number(row.minRentLamports) / 1e9
  const ex = Number(row.excessLamports) / 1e9
  const slug = row.launchSlug ? `slug=${row.launchSlug}  ` : ''
  return (
    `${slug}${row.accountKind.padEnd(22)} ${row.address}  ` +
    `owner=${row.ownerProgram.slice(0, 8)}…  ` +
    `balance=${bal.toFixed(6)} SOL  min_rent=${min.toFixed(6)}  excess=${ex.toFixed(6)}  ` +
    `${row.mintStatusHint}`
  )
}
