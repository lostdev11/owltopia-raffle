import type { WalletAdapter } from '@solana/wallet-adapter-base'
import bs58 from 'bs58'
import { publicKey, generateSigner } from '@metaplex-foundation/umi'
import { fetchMetadata, findMetadataPda, findMasterEditionPda } from '@metaplex-foundation/mpl-token-metadata'
import { mintV2 } from '@metaplex-foundation/mpl-candy-machine'

import type { OwlCenterPhase } from '@/lib/owl-center/types'
import { getGen2CandyMachineId, getGen2CollectionMint, getSolanaCluster, isDevnetMintEnabled } from '@/lib/solana/network'
import { createOwlCenterUmi } from '@/lib/solana/umi'

/** Optional DB-backed overrides (see `owl_center_launches` devnet columns). */
export type Gen2MintLaunchRefs = {
  candy_machine_id?: string | null
  collection_mint?: string | null
  devnet_candy_machine_id?: string | null
  devnet_collection_mint?: string | null
}

export type MintGen2Params = {
  walletAdapter: WalletAdapter
  candyMachineId: string
  collectionMint: string
  quantity: number
  phase: OwlCenterPhase
  /** When provided, resolves CM + collection from env + launch row (devnet vs mainnet). */
  launch?: Gen2MintLaunchRefs | null
}

export type MintGen2Result =
  | {
      ok: true
      /** One signature per sequential mint (CM typically one NFT per tx). */
      txSignatures: string[]
      mintedNftMints: string[]
    }
  | { ok: false; error: string }

/**
 * Prepare + sign + confirm Candy Machine `mintV2` txs via Phantom / Solflare (wallet-standard adapter).
 *
 * Required packages: see `lib/solana/umi.ts` / `candy-machine-v3.ts` header comments.
 *
 * TODO(mainnet): mintArgs per guard (solPayment, merkle WL); optional multi-mint single tx when guards allow.
 * TODO: Collection authority / delegate flows if CM uses a separate update authority.
 */
export async function mintGen2FromCandyMachine(params: MintGen2Params): Promise<MintGen2Result> {
  void params.phase
  const { walletAdapter, candyMachineId, collectionMint, quantity, launch } = params
  if (!walletAdapter.publicKey) {
    return { ok: false, error: 'Wallet not connected' }
  }
  if (!Number.isInteger(quantity) || quantity <= 0 || quantity > 10) {
    return { ok: false, error: 'Invalid quantity (max 10 per run)' }
  }

  if (isDevnetMintEnabled() && getSolanaCluster().toLowerCase() !== 'devnet') {
    return {
      ok: false,
      error:
        'Wrong network / devnet required — use NEXT_PUBLIC_SOLANA_CLUSTER=devnet with NEXT_PUBLIC_GEN2_USE_DEVNET_MINT=true.',
    }
  }

  let cmId = candyMachineId.trim() || getGen2CandyMachineId(launch ?? undefined)
  let colMint = collectionMint.trim() || getGen2CollectionMint(launch ?? undefined)
  if (!cmId) {
    return { ok: false, error: 'Missing Candy Machine ID — set env or Owl Center admin devnet fields.' }
  }
  if (!colMint) {
    return { ok: false, error: 'Missing Collection Mint — set env or Owl Center admin devnet fields.' }
  }

  try {
    const umi = createOwlCenterUmi(walletAdapter)
    const candyMachine = publicKey(cmId)
    const collectionMintPk = publicKey(colMint)
    const collectionMetadata = findMetadataPda(umi, { mint: collectionMintPk })
    const md = await fetchMetadata(umi, collectionMetadata)
    const collectionUpdateAuthority = md.updateAuthority
    const collectionMasterEdition = findMasterEditionPda(umi, { mint: collectionMintPk })

    const txSignatures: string[] = []
    const mintedNftMints: string[] = []

    for (let i = 0; i < quantity; i++) {
      const nftMint = generateSigner(umi)
      const builder = mintV2(umi, {
        candyMachine,
        nftMint,
        collectionMint: collectionMintPk,
        collectionUpdateAuthority,
        collectionMetadata,
        collectionMasterEdition,
        mintArgs: {},
      })
      const res = await builder.sendAndConfirm(umi, { confirm: { commitment: 'confirmed' } })
      const sig = res.signature as string | Uint8Array
      const sigStr = typeof sig === 'string' ? sig : bs58.encode(sig)
      txSignatures.push(sigStr)
      mintedNftMints.push(String(nftMint.publicKey))
    }

    return { ok: true, txSignatures, mintedNftMints }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const low = msg.toLowerCase()
    if (low.includes('could not find candy machine') || low.includes('account does not exist')) {
      return { ok: false, error: 'Candy Machine fetch failed — check RPC cluster and Candy Machine ID.' }
    }
    if (low.includes('user rejected') || low.includes('cancel')) {
      return { ok: false, error: 'Mint transaction rejected in wallet' }
    }
    return { ok: false, error: msg.includes('Simulation failed') ? 'Mint transaction failed on-chain (simulation)' : msg }
  }
}
