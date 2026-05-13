import type { AccountInfo } from '@solana/web3.js'
import { Connection, PublicKey } from '@solana/web3.js'

const METADATA_PROGRAM_ID = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s')

function parseMetaplexMetadataAccountData(data: Uint8Array): { uri: string; name: string; symbol: string } | null {
  if (!data || data.length < 69) return null
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  let offset = 1 + 32 + 32
  const readU32 = () => {
    const v = view.getUint32(offset, true)
    offset += 4
    return v
  }
  const readString = (len: number) => {
    const slice = data.subarray(offset, offset + len)
    offset += len
    return new TextDecoder().decode(slice)
  }
  try {
    const nameLen = readU32()
    const name = nameLen > 0 ? readString(nameLen) : ''
    const symbolLen = readU32()
    const symbol = symbolLen > 0 ? readString(symbolLen) : ''
    const uriLen = readU32()
    const uri = uriLen > 0 ? readString(uriLen) : ''
    return { uri, name, symbol }
  } catch {
    return null
  }
}

function stripNullPadding(s: string): string {
  return s.replace(/\0/g, '').trim()
}

/** Read Metaplex token-metadata name + symbol for a mint (server / Node). */
export async function getMetaplexTokenMetadataNameSymbol(
  connection: Connection,
  mint: PublicKey
): Promise<{ name: string; symbol: string } | null> {
  const pda = PublicKey.findProgramAddressSync(
    [Buffer.from('metadata'), METADATA_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    METADATA_PROGRAM_ID
  )[0]
  let info: AccountInfo<Buffer> | null
  try {
    info = await connection.getAccountInfo(pda, 'confirmed')
  } catch {
    return null
  }
  if (!info?.data) return null
  const parsed = parseMetaplexMetadataAccountData(info.data)
  if (!parsed) return null
  return {
    name: stripNullPadding(parsed.name),
    symbol: stripNullPadding(parsed.symbol),
  }
}
