/**
 * Verify Discord Interaction request signature (Ed25519).
 * @see https://discord.com/developers/docs/interactions/receiving-and-responding#security-and-authorization
 */
import nacl from 'tweetnacl'

const encoder = new TextEncoder()

export function verifyDiscordInteractionRequest(params: {
  rawBody: string
  signatureHeader: string | null
  timestampHeader: string | null
  applicationPublicKeyHex: string
}): boolean {
  const { rawBody, signatureHeader, timestampHeader, applicationPublicKeyHex } = params
  if (!signatureHeader || !timestampHeader) return false
  try {
    const message = encoder.encode(timestampHeader + rawBody)
    const sig = Buffer.from(signatureHeader, 'hex')
    const key = Buffer.from(applicationPublicKeyHex, 'hex')
    if (key.length !== nacl.sign.publicKeyLength || sig.length !== nacl.sign.signatureLength) {
      return false
    }
    return nacl.sign.detached.verify(message, sig, key)
  } catch {
    return false
  }
}
