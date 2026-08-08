/**
 * OwlSend mixed-asset approval queue (POC).
 *
 * Users select a mixed bag (classic / pNFT / Core / cNFT). We classify each NFT,
 * pack kind-pure chunks (never mix engines in one signature), and explain how many
 * wallet approvals are needed and why.
 */

import { chunkOwlSendBatches, type OwlSendLine } from '@/lib/owl-send/batch'
import {
  OWL_SEND_MAX_CNFT_PER_TX,
  OWL_SEND_MAX_CORE_PER_TX,
  OWL_SEND_MAX_PER_TX,
  OWL_SEND_MAX_PNFT_PER_TX,
} from '@/lib/owl-send/constants'
import {
  isOwlSendCompressedNft,
  isOwlSendProgrammableNft,
} from '@/lib/owl-send/picker-eligibility'
import type { WalletNft } from '@/lib/solana/wallet-tokens'

export type OwlSendAssetKind = 'classic' | 'pnft' | 'core' | 'cnft'

export type OwlSendApprovalChunk = {
  kind: OwlSendAssetKind
  lines: OwlSendLine[]
  /** Short reason for this approval (shown in Review). */
  why: string
  /** Human label for the kind. */
  kindLabel: string
}

const KIND_ORDER: OwlSendAssetKind[] = ['classic', 'pnft', 'core', 'cnft']

export function isOwlSendCoreNft(nft: Pick<WalletNft, 'interface'>): boolean {
  const v = (nft.interface ?? '').trim().toLowerCase()
  if (!v) return false
  return v === 'mplcoreasset' || v === 'mplcorecollection' || v.includes('mplcore') || v === 'core'
}

/** Classify a wallet NFT for OwlSend send-path routing. */
export function classifyOwlSendAssetKind(
  nft: Pick<WalletNft, 'interface' | 'compressed'>
): OwlSendAssetKind {
  if (isOwlSendCompressedNft(nft as WalletNft)) return 'cnft'
  if (isOwlSendCoreNft(nft)) return 'core'
  if (isOwlSendProgrammableNft(nft as WalletNft)) return 'pnft'
  return 'classic'
}

export function owlSendKindLabel(kind: OwlSendAssetKind): string {
  switch (kind) {
    case 'classic':
      return 'classic SPL'
    case 'pnft':
      return 'pNFT'
    case 'core':
      return 'Core'
    case 'cnft':
      return 'cNFT'
  }
}

export function owlSendMaxPerTxForKind(kind: OwlSendAssetKind): number {
  switch (kind) {
    case 'classic':
      return OWL_SEND_MAX_PER_TX
    case 'pnft':
      return OWL_SEND_MAX_PNFT_PER_TX
    case 'core':
      return OWL_SEND_MAX_CORE_PER_TX
    case 'cnft':
      return OWL_SEND_MAX_CNFT_PER_TX
  }
}

export function owlSendApprovalWhy(kind: OwlSendAssetKind, count: number): string {
  const max = owlSendMaxPerTxForKind(kind)
  switch (kind) {
    case 'classic':
      return count > max
        ? `Classic SPL — up to ${max} per approval`
        : `Classic SPL transfer (up to ${max}/approval)`
    case 'pnft':
      return max === 1
        ? 'pNFT — Token Metadata (one per approval for now)'
        : `pNFT — Token Metadata (up to ${max}/approval)`
    case 'core':
      return max === 1
        ? 'Metaplex Core — one per approval for now'
        : `Metaplex Core (up to ${max}/approval)`
    case 'cnft':
      return max === 1
        ? 'Compressed NFT — one per approval for now'
        : `Compressed NFT (up to ${max}/approval)`
  }
}

/**
 * Pack prepared send lines into kind-pure approval chunks.
 * `kindByMint` comes from the picker classification of the same selection.
 */
export function packOwlSendApprovalQueue(params: {
  lines: OwlSendLine[]
  kindByMint: Map<string, OwlSendAssetKind> | Record<string, OwlSendAssetKind>
}): OwlSendApprovalChunk[] {
  const kindMap =
    params.kindByMint instanceof Map
      ? params.kindByMint
      : new Map(Object.entries(params.kindByMint))

  const buckets: Record<OwlSendAssetKind, OwlSendLine[]> = {
    classic: [],
    pnft: [],
    core: [],
    cnft: [],
  }

  for (const line of params.lines) {
    const kind = kindMap.get(line.mint.trim()) ?? 'classic'
    buckets[kind].push(line)
  }

  const out: OwlSendApprovalChunk[] = []
  for (const kind of KIND_ORDER) {
    const group = buckets[kind]
    if (group.length < 1) continue
    const max = owlSendMaxPerTxForKind(kind)
    const chunks = chunkOwlSendBatches(group, max)
    for (const lines of chunks) {
      out.push({
        kind,
        lines,
        kindLabel: owlSendKindLabel(kind),
        why: owlSendApprovalWhy(kind, lines.length),
      })
    }
  }
  return out
}

/** Live preview: how many approvals a selection needs (before recipients are paired). */
export function previewOwlSendApprovalQueue(nfts: WalletNft[]): {
  totalApprovals: number
  byKind: Array<{ kind: OwlSendAssetKind; count: number; approvals: number; why: string }>
  summary: string
} {
  const counts: Record<OwlSendAssetKind, number> = {
    classic: 0,
    pnft: 0,
    core: 0,
    cnft: 0,
  }
  for (const nft of nfts) {
    counts[classifyOwlSendAssetKind(nft)] += 1
  }

  const byKind: Array<{
    kind: OwlSendAssetKind
    count: number
    approvals: number
    why: string
  }> = []
  let totalApprovals = 0
  for (const kind of KIND_ORDER) {
    const count = counts[kind]
    if (count < 1) continue
    const max = owlSendMaxPerTxForKind(kind)
    const approvals = Math.ceil(count / max)
    totalApprovals += approvals
    byKind.push({
      kind,
      count,
      approvals,
      why: owlSendApprovalWhy(kind, count),
    })
  }

  const parts = byKind.map((b) => {
    const label = owlSendKindLabel(b.kind)
    return `${b.count} ${label}${b.approvals > 1 ? ` → ${b.approvals} approvals` : ''}`
  })
  const summary =
    totalApprovals < 1
      ? 'Select NFTs to see approvals'
      : totalApprovals === 1
        ? `1 wallet approval · ${parts.join(' · ')}`
        : `${totalApprovals} wallet approvals · ${parts.join(' · ')}`

  return { totalApprovals, byKind, summary }
}

/** Build mint → kind map from the selected wallet NFTs. */
export function owlSendKindByMintFromNfts(nfts: WalletNft[]): Map<string, OwlSendAssetKind> {
  const map = new Map<string, OwlSendAssetKind>()
  for (const nft of nfts) {
    map.set(nft.mint.trim(), classifyOwlSendAssetKind(nft))
  }
  return map
}
