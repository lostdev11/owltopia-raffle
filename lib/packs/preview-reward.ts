import type { PackOpenClientResult } from '@/lib/client/execute-pack-purchase'

export type PackPreviewInventoryItem = {
  id: string
  mint_address: string
  name: string | null
  image_url?: string | null
  fair_value_sol: number
  status: string
}

export function packOpenRewardFromInventory(
  category: 'owl' | 'sol' | 'nft',
  inventoryItem?: PackPreviewInventoryItem | null
): PackOpenClientResult {
  if (category === 'nft' && inventoryItem) {
    const prizeLabel =
      inventoryItem.name || `NFT ${inventoryItem.mint_address.slice(0, 8)}…`
    return {
      openId: `preview-${inventoryItem.id}`,
      category: 'nft',
      prizeLabel,
      owlAmount: null,
      solAmount: null,
      nftMint: inventoryItem.mint_address,
      nftName: inventoryItem.name,
      nftImageUrl: inventoryItem.image_url ?? null,
      freeTicketCredits: 0,
      payoutSignature: null,
      openSeed: 'preview-seed',
      openCommitHash: 'preview-commit',
      revealMessage: `You won ${prizeLabel} (preview)`,
    }
  }
  return mockPackOpenReward(category)
}

export function mockPackOpenReward(category: 'owl' | 'sol' | 'nft'): PackOpenClientResult {
  if (category === 'sol') {
    return {
      openId: '00000000-0000-4000-8000-000000000001',
      category: 'sol',
      prizeLabel: '0.1 SOL',
      owlAmount: null,
      solAmount: 0.1,
      nftMint: null,
      nftName: null,
      nftImageUrl: null,
      freeTicketCredits: 0,
      payoutSignature: null,
      openSeed: 'preview-seed',
      openCommitHash: 'preview-commit',
      revealMessage: 'You won 0.1 SOL (preview)',
    }
  }
  if (category === 'nft') {
    return {
      openId: '00000000-0000-4000-8000-000000000002',
      category: 'nft',
      prizeLabel: 'Preview Owl NFT',
      owlAmount: null,
      solAmount: null,
      nftMint: 'Prev1ew111111111111111111111111111111111111',
      nftName: 'Preview Owl NFT',
      nftImageUrl: '/logo.gif',
      freeTicketCredits: 0,
      payoutSignature: null,
      openSeed: 'preview-seed',
      openCommitHash: 'preview-commit',
      revealMessage: 'You won Preview Owl NFT (preview)',
    }
  }
  return {
    openId: '00000000-0000-4000-8000-000000000003',
    category: 'owl',
    prizeLabel: '25 $OWL',
    owlAmount: 25,
    solAmount: null,
    nftMint: null,
    nftName: null,
    nftImageUrl: null,
    freeTicketCredits: 0,
    payoutSignature: null,
    openSeed: 'preview-seed',
    openCommitHash: 'preview-commit',
    revealMessage: 'You won 25 $OWL — sent to your wallet (preview)',
  }
}
