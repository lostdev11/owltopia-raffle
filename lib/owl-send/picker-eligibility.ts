import type { WalletNft } from '@/lib/solana/wallet-tokens'
import {
  isProgrammableNftInterface,
  isWalletNftTransferLocked,
} from '@/lib/solana/nft-transfer-lock'
import { OWL_SEND_MAX_SPECIAL_PER_TX, owlSendClassicApprovalSize } from '@/lib/owl-send/constants'

/** Compressed NFT from DAS `compression.compressed` (or interface hint). */
export function isOwlSendCompressedNft(nft: WalletNft): boolean {
  if (nft.compressed === true) return true
  const iface = (nft.interface ?? '').toLowerCase()
  return iface.includes('compressed')
}

/** Metaplex programmable NFT — needs Token Metadata path, not classic SPL multi-send. */
export function isOwlSendProgrammableNft(nft: WalletNft): boolean {
  return isProgrammableNftInterface(nft.interface)
}

/** Picker bucket for mix rules (cNFT / pNFT / classic SPL cannot share a send). */
export type OwlSendPickerKind = 'cnft' | 'pnft' | 'classic'

export function owlSendPickerKind(nft: Pick<WalletNft, 'compressed' | 'interface'>): OwlSendPickerKind {
  if (isOwlSendCompressedNft(nft as WalletNft)) return 'cnft'
  if (isOwlSendProgrammableNft(nft as WalletNft)) return 'pnft'
  return 'classic'
}

/** Classic SPL 3–4 per approval (packet headroom); cNFT / pNFT ≤1 (sequential). */
export function owlSendSelectionApprovalSize(
  selected: Array<Pick<WalletNft, 'compressed' | 'interface'>>,
  opts?: { uniqueRecipients?: number }
): number {
  if (selected.some((n) => owlSendPickerKind(n) !== 'classic')) return OWL_SEND_MAX_SPECIAL_PER_TX
  return owlSendClassicApprovalSize(opts?.uniqueRecipients ?? 1)
}

function kindLabel(kind: OwlSendPickerKind): string {
  if (kind === 'cnft') return 'cNFTs'
  if (kind === 'pnft') return 'pNFTs'
  return 'classic NFTs'
}

function mixGate(
  selectedKind: OwlSendPickerKind,
  candidateKind: OwlSendPickerKind,
  conflictMints: string[]
): OwlSendAssetGate {
  return {
    ok: false,
    title: `Keep ${kindLabel(selectedKind)} separate`,
    detail: `${kindLabel(candidateKind)} can’t mix with ${kindLabel(selectedKind)} in one send. Deselect the others first, or finish this send and start a new one.`,
    cnftMints: conflictMints,
  }
}

/**
 * Immediate mix check when toggling one NFT on.
 * Empty selection always allows the candidate.
 */
export function owlSendCanAddToSelection(params: {
  selected: WalletNft[]
  candidate: WalletNft
}): OwlSendAssetGate {
  const { selected, candidate } = params
  if (selected.length < 1) return { ok: true }
  const selectedKind = owlSendPickerKind(selected[0]!)
  // Defend against a corrupted mixed selection.
  for (const n of selected) {
    if (owlSendPickerKind(n) !== selectedKind) {
      return mixGate(selectedKind, owlSendPickerKind(n), selected.map((s) => s.mint))
    }
  }
  const candidateKind = owlSendPickerKind(candidate)
  if (candidateKind === selectedKind) return { ok: true }
  return mixGate(selectedKind, candidateKind, [candidate.mint])
}

/**
 * Filter a bulk select (e.g. select-all filtered) to one compatible kind.
 * Prefers the current selection’s kind; otherwise the first candidate’s kind.
 */
export function owlSendFilterCompatibleSelection(params: {
  currentSelected: WalletNft[]
  candidates: WalletNft[]
}): {
  mints: string[]
  keptKind: OwlSendPickerKind | null
  rejected: WalletNft[]
  gate: OwlSendAssetGate | null
} {
  const { currentSelected, candidates } = params
  if (candidates.length < 1) {
    return { mints: [], keptKind: null, rejected: [], gate: null }
  }

  const keptKind: OwlSendPickerKind =
    currentSelected.length > 0
      ? owlSendPickerKind(currentSelected[0]!)
      : owlSendPickerKind(candidates[0]!)

  const kept: WalletNft[] = []
  const rejected: WalletNft[] = []
  // Preserve already-selected of the kept kind, then add compatible candidates.
  const byMint = new Map<string, WalletNft>()
  for (const n of currentSelected) {
    if (owlSendPickerKind(n) === keptKind) byMint.set(n.mint, n)
  }
  for (const n of candidates) {
    if (owlSendPickerKind(n) === keptKind) byMint.set(n.mint, n)
    else rejected.push(n)
  }
  for (const n of byMint.values()) kept.push(n)

  const gate =
    rejected.length > 0
      ? mixGate(
          keptKind,
          owlSendPickerKind(rejected[0]!),
          rejected.map((r) => r.mint)
        )
      : null

  return {
    mints: kept.map((n) => n.mint),
    keptKind,
    rejected,
    gate,
  }
}

/**
 * Informational picker badge — only true nest/stake locks.
 * Leftover Gen2 Candy Machine delegates after thaw are NOT nested.
 * pNFTs that look frozen without a lock delegate are still transferable.
 */
export function owlSendNftLockLabel(nft: WalletNft): string | null {
  if (isOwlSendCompressedNft(nft)) return 'cNFT'
  if (isOwlSendProgrammableNft(nft)) return 'pNFT'
  if (isWalletNftTransferLocked(nft)) return 'Nested / frozen'
  return null
}

/** Badge when this mint failed a send (highlighted in the picker). */
export function owlSendNftProblemLabel(
  nft: WalletNft,
  problemMints: Set<string> | undefined
): string | null {
  if (problemMints?.has(nft.mint)) return 'Can’t send · see retry'
  return owlSendNftLockLabel(nft)
}

export type OwlSendFrozenPartition = {
  sendable: WalletNft[]
  frozen: WalletNft[]
}

/**
 * Split a selection so nested/frozen Gen2s never share a multi-send batch with
 * sendable ones (one frozen account poisons Phantom pre-sim for the whole tx).
 * pNFT freeze-without-delegate stays sendable (Token Metadata / special path).
 */
export function partitionOwlSendByFrozen(selected: WalletNft[]): OwlSendFrozenPartition {
  const sendable: WalletNft[] = []
  const frozen: WalletNft[] = []
  for (const nft of selected) {
    if (isWalletNftTransferLocked(nft)) frozen.push(nft)
    else sendable.push(nft)
  }
  return { sendable, frozen }
}

/**
 * After a live ATA freeze read: keep pNFT freeze-without-delegate as sendable.
 * Classic SPL frozen (or pNFT with a lock delegate) stay nest-locked.
 */
export function partitionLiveFrozenForOwlSend(params: {
  candidates: WalletNft[]
  liveFrozenMints: Iterable<string>
}): OwlSendFrozenPartition {
  const frozenSet = new Set([...params.liveFrozenMints].map((m) => m.trim()).filter(Boolean))
  const sendable: WalletNft[] = []
  const frozen: WalletNft[] = []
  for (const nft of params.candidates) {
    if (!frozenSet.has(nft.mint.trim())) {
      sendable.push(nft)
      continue
    }
    // Live freeze + known pNFT without lock delegate → Token Metadata path, not nest lock.
    if (isOwlSendProgrammableNft(nft) && nft.delegated !== true) {
      sendable.push(nft)
      continue
    }
    frozen.push({ ...nft, frozen: true })
  }
  return { sendable, frozen }
}

/** Short Review notice when frozen NFTs were auto-skipped. */
export function owlSendSkippedFrozenNotice(frozenCount: number, sendableCount: number): string {
  const skipped =
    frozenCount === 1
      ? 'Skipped 1 nested/frozen NFT'
      : `Skipped ${frozenCount} nested/frozen NFTs`
  if (sendableCount < 1) {
    return `${skipped} — thaw locks / unnest on Nesting first, then send.`
  }
  return `${skipped} — thaw locks / unnest on Nesting to send those. Continuing with the rest.`
}

export type OwlSendAssetGate =
  | { ok: true }
  | {
      ok: false
      /** Short popup copy — keep minimal for mobile. */
      title: string
      detail: string
      cnftMints: string[]
    }

/** @deprecated alias — same shape as {@link OwlSendAssetGate}. */
export type OwlSendCnftGate = OwlSendAssetGate

/**
 * cNFTs cannot share a send with classic SPL / pNFTs.
 * Multiple cNFTs are allowed — each gets its own wallet approval (sequential).
 */
export function gateOwlSendCnftSelection(selected: WalletNft[]): OwlSendAssetGate {
  const cnfts = selected.filter(isOwlSendCompressedNft)
  if (cnfts.length === 0) return { ok: true }

  const others = selected.filter((n) => !isOwlSendCompressedNft(n))
  if (others.length > 0) {
    return {
      ok: false,
      title: 'Keep cNFTs separate',
      detail:
        'Compressed NFTs can’t mix with other NFTs in one send. Deselect the others, or deselect cNFTs.',
      cnftMints: cnfts.map((n) => n.mint),
    }
  }

  return { ok: true }
}

/**
 * pNFTs cannot share a send with classic SPL / cNFTs.
 * Multiple pNFTs are allowed — each gets its own Token Metadata approval (sequential).
 */
export function gateOwlSendPnftSelection(selected: WalletNft[]): OwlSendAssetGate {
  const pnfts = selected.filter(isOwlSendProgrammableNft)
  if (pnfts.length === 0) return { ok: true }

  const others = selected.filter((n) => !isOwlSendProgrammableNft(n))
  if (others.length > 0) {
    return {
      ok: false,
      title: 'Keep pNFTs separate',
      detail:
        'Programmable NFTs can’t mix with other NFTs in one send. Deselect the others, or deselect pNFTs.',
      cnftMints: pnfts.map((n) => n.mint),
    }
  }

  return { ok: true }
}

/** Run cNFT then pNFT gates (first failure wins). */
export function gateOwlSendSpecialAssetSelection(selected: WalletNft[]): OwlSendAssetGate {
  const cnft = gateOwlSendCnftSelection(selected)
  if (!cnft.ok) return cnft
  return gateOwlSendPnftSelection(selected)
}
