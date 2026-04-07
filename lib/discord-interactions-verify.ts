/**
 * Verify Discord Interaction request signature (Ed25519).
 * @see https://discord.com/developers/docs/interactions/receiving-and-responding#security-and-authorization
 */
import nacl from 'tweetnacl'

const encoder = new TextEncoder()

/** Discord “Public Key” from the portal: hex, sometimes pasted with 0x or spaces. */
export function normalizeDiscordApplicationPublicKeyHex(hex: string): string {
  return hex.trim().replace(/^0x/i, '').replace(/\s+/g, '')
}

export function verifyDiscordInteractionRequest(params: {
  rawBody: string
  signatureHeader: string | null
  timestampHeader: string | null
  applicationPublicKeyHex: string
}): boolean {
  const { rawBody, signatureHeader, timestampHeader, applicationPublicKeyHex } = params
  const sigHeader = signatureHeader?.trim() ?? ''
  const tsHeader = timestampHeader?.trim() ?? ''
  if (!sigHeader || !tsHeader) return false
  const keyHex = normalizeDiscordApplicationPublicKeyHex(applicationPublicKeyHex)
  try {
    const message = encoder.encode(tsHeader + rawBody)
    const sig = Buffer.from(sigHeader, 'hex')
    const key = Buffer.from(keyHex, 'hex')
    if (key.length !== nacl.sign.publicKeyLength || sig.length !== nacl.sign.signatureLength) {
      return false
    }
    return nacl.sign.detached.verify(message, sig, key)
  } catch {
    return false
  }
}
