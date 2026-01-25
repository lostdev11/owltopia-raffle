import { PublicKey } from '@solana/web3.js'
import nacl from 'tweetnacl'
import bs58 from 'bs58'

/**
 * Verify a wallet signature for a message
 * @param message - The original message that was signed
 * @param signature - The signature (base58 string, base64 string, or Uint8Array)
 * @param publicKey - The wallet's public key (base58 string)
 * @returns true if signature is valid
 */
export async function verifyWalletSignature(
  message: string,
  signature: string | Uint8Array,
  publicKey: string
): Promise<boolean> {
  try {
    const publicKeyObj = new PublicKey(publicKey)
    
    // Convert signature to Uint8Array
    let signatureBytes: Uint8Array
    if (typeof signature === 'string') {
      // Try base58 decode first (Solana standard)
      try {
        signatureBytes = bs58.decode(signature)
      } catch {
        // If base58 fails, try base64
        try {
          signatureBytes = Uint8Array.from(atob(signature), c => c.charCodeAt(0))
        } catch {
          // If base64 fails, try hex
          signatureBytes = Uint8Array.from(
            signature.match(/.{1,2}/g)?.map(byte => parseInt(byte, 16)) || []
          )
        }
      }
    } else {
      signatureBytes = signature
    }

    // Validate signature length (Ed25519 signatures are 64 bytes)
    if (signatureBytes.length !== 64) {
      console.error(`Invalid signature length: ${signatureBytes.length}, expected 64`)
      return false
    }

    // Convert message to Uint8Array
    const messageBytes = new TextEncoder().encode(message)

    // Get public key bytes
    const publicKeyBytes = publicKeyObj.toBytes()

    // Verify signature using Ed25519 (Solana's signature algorithm)
    return nacl.sign.detached.verify(messageBytes, signatureBytes, publicKeyBytes)
  } catch (error) {
    console.error('Error verifying wallet signature:', error)
    return false
  }
}

/**
 * Generate a message for signing (standard format)
 */
export function generateSignMessage(walletAddress: string, action: string, timestamp?: number): string {
  const ts = timestamp || Date.now()
  return `Sign this message to ${action}\n\nWallet: ${walletAddress}\nTimestamp: ${ts}\n\nThis signature will not cost any SOL.`
}
