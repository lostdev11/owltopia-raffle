import { Connection, PublicKey } from '@solana/web3.js'
import { getAssociatedTokenAddress } from '@solana/spl-token'

/**
 * Check if a wallet holds at least one NFT from a specific collection
 * @param walletAddress - The wallet address to check
 * @param mintAddress - The NFT mint address (collection) to check for
 * @returns true if wallet holds at least 1 NFT from the collection
 */
export async function isOwltopiaHolder(walletAddress: string): Promise<boolean> {
  try {
    // Get mint address from env var or use default Owltopia mint
    const mintAddress = process.env.OWLTOPIA_NFT_MINT || process.env.NEXT_PUBLIC_OWLTOPIA_NFT_MINT
    
    if (!mintAddress) {
      console.warn('OWLTOPIA_NFT_MINT not configured, skipping holder check')
      // In development, you might want to return true or false
      // For production, this should probably return false
      return false
    }

    const walletPubkey = new PublicKey(walletAddress)
    const mintPubkey = new PublicKey(mintAddress)

    // Get RPC URL
    let rpcUrl = process.env.SOLANA_RPC_URL?.trim() || 
                 process.env.NEXT_PUBLIC_SOLANA_RPC_URL?.trim() ||
                 'https://api.mainnet-beta.solana.com'
    
    if (rpcUrl && !rpcUrl.startsWith('http://') && !rpcUrl.startsWith('https://')) {
      if (rpcUrl && !rpcUrl.includes('://')) {
        rpcUrl = `https://${rpcUrl}`
      } else {
        rpcUrl = 'https://api.mainnet-beta.solana.com'
      }
    }
    
    if (!rpcUrl || (!rpcUrl.startsWith('http://') && !rpcUrl.startsWith('https://'))) {
      console.error('Invalid RPC URL configuration')
      return false
    }

    const connection = new Connection(rpcUrl, 'confirmed')

    // For NFT ownership, we need to check token accounts
    // This is a simplified check - in production you might want to use
    // a more robust method like checking Metaplex metadata or using Helius/QuickNode APIs
    
    // Get all token accounts for the wallet
    const tokenAccounts = await connection.getParsedTokenAccountsByOwner(walletPubkey, {
      mint: mintPubkey,
    })

    // Check if any token account has a balance > 0
    for (const accountInfo of tokenAccounts.value) {
      const balance = accountInfo.account.data.parsed.info.tokenAmount.uiAmount
      if (balance && balance > 0) {
        return true
      }
    }

    // Alternative: Check using getTokenAccountsByOwner for SPL tokens
    // This might be more reliable for NFTs
    try {
      const allTokenAccounts = await connection.getParsedTokenAccountsByOwner(walletPubkey, {
        programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'), // SPL Token program
      })

      for (const accountInfo of allTokenAccounts.value) {
        const mint = accountInfo.account.data.parsed.info.mint
        if (mint === mintAddress) {
          const balance = accountInfo.account.data.parsed.info.tokenAmount.uiAmount
          if (balance && balance > 0) {
            return true
          }
        }
      }
    } catch (error) {
      console.error('Error checking token accounts:', error)
    }

    return false
  } catch (error) {
    console.error('Error checking NFT ownership:', error)
    return false
  }
}
