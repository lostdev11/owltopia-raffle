/**
 * Bubblegum leaf transfer: V2 trees require `transferV2` with MPL account compression + MPL noop.
 * V1 trees use `transfer` with SPL compression + SPL noop (pinned below).
 *
 * Some trees report `TreeConfig.version` as V1 while the merkle tree account is already owned by
 * MPL Account Compression; using V1 `transfer` then passes SPL noop and Bubblegum returns
 * InvalidProgramId on `log_wrapper` (expects MPL noop). We pick the instruction path from the
 * merkle tree's owner when possible, then fall back to tree config version.
 *
 * SPL Merkle trees use V1 `transfer` with SPL noop only. `getCompressionProgramsForV1Ixs` uses
 * `getGenesisHash` and returns MPL noop on “unknown” clusters; many hosted RPCs fail that match and
 * then Bubblegum fails with InvalidProgramId on `log_wrapper`. MPL-owned trees use `transferV2`
 * above, so this V1 path always pins SPL compression + SPL noop.
 */
import {
  fetchTreeConfigFromSeeds,
  transfer as bubblegumTransfer,
  transferV2 as bubblegumTransferV2,
  Version,
} from '@metaplex-foundation/mpl-bubblegum'
import { MPL_ACCOUNT_COMPRESSION_PROGRAM_ID } from '@metaplex-foundation/mpl-account-compression'
import {
  SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
  SPL_NOOP_PROGRAM_ID,
} from '@metaplex-foundation/spl-account-compression'
import { none, some } from '@metaplex-foundation/umi'

function shouldUseBubblegumTransferV2(
  treeCfgVersion: Version,
  merkleTreeOwner: string | null
): boolean {
  if (merkleTreeOwner === MPL_ACCOUNT_COMPRESSION_PROGRAM_ID) return true
  if (merkleTreeOwner === SPL_ACCOUNT_COMPRESSION_PROGRAM_ID) return false
  return treeCfgVersion === Version.V2
}

export async function buildBubblegumLeafTransferBuilder(
   
  umi: any,
   
  authoritySigner: any,
   
  leafOwner: any,
   
  newLeafOwner: any,
   
  asset: any
   
): Promise<any> {
  const treeCfg = await fetchTreeConfigFromSeeds(umi, { merkleTree: asset.merkleTree })

  let merkleTreeOwner: string | null = null
  try {
    const mt = await umi.rpc.getAccount(asset.merkleTree)
    if (mt.exists) {
      merkleTreeOwner = String(mt.owner)
    }
  } catch {
    // Fall back to treeCfg.version only.
  }

  const useV2 = shouldUseBubblegumTransferV2(treeCfg.version, merkleTreeOwner)

  if (useV2) {
    const assetDataHash =
      asset.asset_data_hash instanceof Uint8Array && asset.asset_data_hash.length === 32
        ? some(asset.asset_data_hash)
        : none()
    const flags =
      typeof asset.flags === 'number' && !Number.isNaN(asset.flags) ? some(asset.flags) : none()

    return bubblegumTransferV2(umi, {
      authority: authoritySigner,
      payer: authoritySigner,
      leafOwner,
      leafDelegate: asset.leafDelegate,
      newLeafOwner,
      merkleTree: asset.merkleTree,
      root: asset.root,
      dataHash: asset.dataHash,
      creatorHash: asset.creatorHash,
      nonce: BigInt(asset.nonce),
      index: asset.index,
      proof: asset.proof,
      assetDataHash,
      flags,
    })
  }

  return bubblegumTransfer(umi, {
    leafOwner,
    leafDelegate: asset.leafDelegate,
    newLeafOwner,
    merkleTree: asset.merkleTree,
    root: asset.root,
    dataHash: asset.dataHash,
    creatorHash: asset.creatorHash,
    nonce: BigInt(asset.nonce),
    index: asset.index,
    proof: asset.proof,
    compressionProgram: SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
    logWrapper: SPL_NOOP_PROGRAM_ID,
  })
}
