import 'server-only'

import bs58 from 'bs58'
import { isSome, publicKey } from '@metaplex-foundation/umi'
import {
  fetchCandyMachine as fetchTmCandyMachine,
  safeFetchCandyGuard as safeFetchTmCandyGuard,
  updateCandyGuard as updateTmCandyGuard,
} from '@metaplex-foundation/mpl-candy-machine'

import {
  publicSimpleCandyGuardUmiGuards,
  publicSimpleGuardOptsFromLaunch,
} from '@/lib/owl-center/sugar-public-simple-guards'
import { createIrysDeployerCoreUmi } from '@/lib/owl-center/core-cm-deploy-onchain'
import { createIrysDeployerUmi } from '@/lib/owl-center/sugar-deploy-onchain'
import {
  fetchCandyMachine,
  safeFetchCandyGuard,
  updateCandyGuard,
} from '@/lib/solana/core-candy-machine'
import { getLaunchCandyMachineId, resolveLaunchMintNetwork } from '@/lib/solana/launch-cm'
import type { OwlCenterLaunchPublic } from '@/lib/owl-center/types'

export type PublicSimpleGuardSyncResult =
  | { ok: true; status: 'updated'; signature: string }
  | { ok: true; status: 'skipped'; reason: string }
  | { ok: false; error: string }

/**
 * Push wallet mintLimit + startDate onto an already-deployed public_simple Candy Guard.
 * Best-effort: mint-config saves still succeed if the deployer key is not the guard authority.
 */
export async function syncPublicSimpleCandyGuards(
  launch: OwlCenterLaunchPublic
): Promise<PublicSimpleGuardSyncResult> {
  if (launch.mint_mode !== 'public_simple') {
    return { ok: true, status: 'skipped', reason: 'not_public_simple' }
  }

  const network = resolveLaunchMintNetwork(launch)
  const cmId = getLaunchCandyMachineId(launch, network)?.trim()
  if (!cmId) {
    return { ok: true, status: 'skipped', reason: 'no_candy_machine' }
  }

  const opts = publicSimpleGuardOptsFromLaunch(launch)
  const nextDefault = publicSimpleCandyGuardUmiGuards(opts)

  try {
    if (launch.mint_standard === 'token_metadata') {
      const umi = createIrysDeployerUmi(network)
      const cm = await fetchTmCandyMachine(umi, publicKey(cmId))
      const guard = await safeFetchTmCandyGuard(umi, cm.mintAuthority)
      if (!guard) return { ok: false, error: 'Candy Guard not found for this Candy Machine' }
      if (String(guard.authority) !== String(umi.identity.publicKey)) {
        return { ok: false, error: 'Deployer wallet is not the Candy Guard authority — on-chain cap/date were not updated' }
      }
      const builder = updateTmCandyGuard(umi, {
        candyGuard: guard.publicKey,
        guards: {
          ...guard.guards,
          botTax: isSome(guard.guards.botTax) ? guard.guards.botTax : nextDefault.botTax,
          mintLimit: nextDefault.mintLimit,
          startDate: nextDefault.startDate,
        },
        groups: guard.groups,
      })
      const result = await builder.sendAndConfirm(umi, { confirm: { commitment: 'confirmed' } })
      const signature = typeof result.signature === 'string' ? result.signature : bs58.encode(result.signature)
      return { ok: true, status: 'updated', signature }
    }

    const umi = createIrysDeployerCoreUmi(network)
    const cm = await fetchCandyMachine(umi, publicKey(cmId))
    const guard = await safeFetchCandyGuard(umi, cm.mintAuthority)
    if (!guard) return { ok: false, error: 'Candy Guard not found for this Candy Machine' }
    if (String(guard.authority) !== String(umi.identity.publicKey)) {
      return { ok: false, error: 'Deployer wallet is not the Candy Guard authority — on-chain cap/date were not updated' }
    }
    const builder = updateCandyGuard(umi, {
      candyGuard: guard.publicKey,
      guards: {
        ...guard.guards,
        botTax: isSome(guard.guards.botTax) ? guard.guards.botTax : nextDefault.botTax,
        mintLimit: nextDefault.mintLimit,
        startDate: nextDefault.startDate,
      },
      groups: guard.groups,
    })
    const result = await builder.sendAndConfirm(umi, { confirm: { commitment: 'confirmed' } })
    const signature = typeof result.signature === 'string' ? result.signature : bs58.encode(result.signature)
    return { ok: true, status: 'updated', signature }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg.toLowerCase().includes('irys_private_key') || msg.toLowerCase().includes('not configured')) {
      return { ok: true, status: 'skipped', reason: 'deployer_key_missing' }
    }
    return { ok: false, error: msg }
  }
}
