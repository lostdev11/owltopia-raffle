/**
 * Shared on-chain mint batch outcome for Owl Center Candy Machine mints
 * (Token Metadata and Core). Not Gen2-specific — any launch can use this shape.
 */
export type OwlCenterMintResult =
  | {
      ok: true
      /** One signature per on-chain mint tx (batch = many txs, one wallet approval). */
      txSignatures: string[]
      mintedNftMints: string[]
    }
  | {
      ok: false
      error: string
      txSignatures?: string[]
      mintedNftMints?: string[]
      /** Planned mint addresses when the batch failed after keys were generated. */
      plannedMintB58s?: string[]
    }
