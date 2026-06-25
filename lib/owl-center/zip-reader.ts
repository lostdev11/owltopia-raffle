import 'server-only'

import { inflateRaw } from 'node:zlib'
import { promisify } from 'node:util'

const inflateRawAsync = promisify(inflateRaw)

/**
 * Low-memory, zero-dependency ZIP reader for the Owl Center asset pipeline.
 *
 * Why not JSZip: JSZip.loadAsync inflates/holds the whole archive in memory, so
 * a ~1GB Sugar export OOM-killed the 3009MB serverless function before a single
 * file was uploaded. This reader instead parses ONLY the central directory
 * (entry metadata) up front, keeps the source buffer, and inflates one entry at
 * a time on demand. Peak memory ≈ source buffer + the entries currently being
 * read (the worker reads at most `concurrency` small files at once).
 *
 * Random access (read any entry by name) preserves the worker's resumable,
 * image-before-metadata upload model. Reads are independent buffer slices +
 * async inflate, so concurrent reads are safe.
 *
 * Scope: standard (non-ZIP64) archives < 4GB with stored (0) or deflate (8)
 * entries — which is what Sugar exports produce.
 */

const EOCD_SIGNATURE = 0x06054b50 // End of central directory record
const CDH_SIGNATURE = 0x02014b50 // Central directory file header
const LFH_SIGNATURE = 0x04034b50 // Local file header

type CentralEntry = {
  fileName: string
  compressionMethod: number
  compressedSize: number
  localHeaderOffset: number
}

function findEndOfCentralDirectory(buf: Buffer): number {
  // The EOCD record is 22 bytes + an optional comment of up to 65535 bytes, so
  // scan backwards from the end for its signature.
  const minPos = Math.max(0, buf.length - 22 - 0xffff)
  for (let i = buf.length - 22; i >= minPos; i -= 1) {
    if (buf.readUInt32LE(i) === EOCD_SIGNATURE) return i
  }
  throw new Error('ZIP: end-of-central-directory record not found (corrupt or not a ZIP)')
}

function parseCentralDirectory(buf: Buffer): Map<string, CentralEntry> {
  const eocd = findEndOfCentralDirectory(buf)
  const entryCount = buf.readUInt16LE(eocd + 10)
  const cdOffset = buf.readUInt32LE(eocd + 16)

  if (cdOffset === 0xffffffff || entryCount === 0xffff) {
    throw new Error('ZIP: ZIP64 archives are not supported by this reader')
  }

  const entries = new Map<string, CentralEntry>()
  let p = cdOffset
  for (let i = 0; i < entryCount; i += 1) {
    if (buf.readUInt32LE(p) !== CDH_SIGNATURE) {
      throw new Error('ZIP: malformed central directory header')
    }
    const compressionMethod = buf.readUInt16LE(p + 10)
    const compressedSize = buf.readUInt32LE(p + 20)
    const fileNameLength = buf.readUInt16LE(p + 28)
    const extraFieldLength = buf.readUInt16LE(p + 30)
    const fileCommentLength = buf.readUInt16LE(p + 32)
    const localHeaderOffset = buf.readUInt32LE(p + 42)
    const fileName = buf.toString('utf8', p + 46, p + 46 + fileNameLength)

    p += 46 + fileNameLength + extraFieldLength + fileCommentLength

    // Skip directory entries (names ending in "/").
    if (!fileName.endsWith('/')) {
      entries.set(fileName, { fileName, compressionMethod, compressedSize, localHeaderOffset })
    }
  }
  return entries
}

async function readEntry(buf: Buffer, entry: CentralEntry): Promise<Buffer> {
  const o = entry.localHeaderOffset
  if (buf.readUInt32LE(o) !== LFH_SIGNATURE) {
    throw new Error(`ZIP: bad local header for ${entry.fileName}`)
  }
  // The local header's name/extra lengths can differ from the central directory,
  // so read them here to locate the start of the file data.
  const localNameLength = buf.readUInt16LE(o + 26)
  const localExtraLength = buf.readUInt16LE(o + 28)
  const dataStart = o + 30 + localNameLength + localExtraLength
  const dataEnd = dataStart + entry.compressedSize
  // subarray is a zero-copy view into the source buffer.
  const slice = buf.subarray(dataStart, dataEnd)

  if (entry.compressionMethod === 0) {
    // Stored — copy out so the returned buffer doesn't pin the whole archive.
    return Buffer.from(slice)
  }
  if (entry.compressionMethod === 8) {
    return inflateRawAsync(slice)
  }
  throw new Error(`ZIP: unsupported compression method ${entry.compressionMethod} for ${entry.fileName}`)
}

export class StagedZip {
  private readonly buf: Buffer
  private readonly entries: Map<string, CentralEntry>
  /** File entry names (excludes directories). */
  readonly paths: string[]

  private constructor(buf: Buffer, entries: Map<string, CentralEntry>) {
    this.buf = buf
    this.entries = entries
    this.paths = [...entries.keys()]
  }

  /** Parse the central directory only (cheap) — does not inflate any file. */
  static open(buffer: Buffer): StagedZip {
    return new StagedZip(buffer, parseCentralDirectory(buffer))
  }

  has(path: string): boolean {
    return this.entries.has(path)
  }

  /** Inflate a single entry on demand. Returns null if the path is absent. */
  async read(path: string): Promise<Buffer | null> {
    const entry = this.entries.get(path)
    if (!entry) return null
    return readEntry(this.buf, entry)
  }

  async readText(path: string): Promise<string | null> {
    const buf = await this.read(path)
    return buf ? buf.toString('utf8') : null
  }
}
