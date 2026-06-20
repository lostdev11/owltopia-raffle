// Minimal, dependency-free streaming ZIP writer (STORE / no compression).
//
// Built specifically so a full-supply NFT export (thousands of already-
// compressed PNGs) can be streamed straight to disk one entry at a time instead
// of accumulating the whole archive in memory — which is what made large
// exports crash mid-download. Standard ZIP (not ZIP64): supports up to 65,535
// entries and a < 4 GB archive, which comfortably covers a few-thousand-piece
// collection.

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buf: Uint8Array): number {
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function dosDateTime(date: Date): { time: number; date: number } {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (Math.floor(date.getSeconds() / 2) & 0x1f)
  const d = (((date.getFullYear() - 1980) & 0x7f) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  return { time, date: d }
}

export type ZipSink = (chunk: Uint8Array) => Promise<void> | void

/** Writes ZIP entries to a sink as they're added; small central directory is buffered until finish(). */
export class StreamingZip {
  private offset = 0
  private central: Uint8Array[] = []
  private count = 0
  private readonly encoder = new TextEncoder()

  constructor(private readonly sink: ZipSink) {}

  async add(name: string, data: Uint8Array, modified = new Date()): Promise<void> {
    const nameBytes = this.encoder.encode(name)
    const crc = crc32(data)
    const { time, date } = dosDateTime(modified)
    const localOffset = this.offset

    const local = new Uint8Array(30 + nameBytes.length)
    const ldv = new DataView(local.buffer)
    ldv.setUint32(0, 0x04034b50, true)
    ldv.setUint16(4, 20, true)
    ldv.setUint16(6, 0x0800, true) // UTF-8 filename flag
    ldv.setUint16(8, 0, true) // STORE
    ldv.setUint16(10, time, true)
    ldv.setUint16(12, date, true)
    ldv.setUint32(14, crc, true)
    ldv.setUint32(18, data.length, true)
    ldv.setUint32(22, data.length, true)
    ldv.setUint16(26, nameBytes.length, true)
    ldv.setUint16(28, 0, true)
    local.set(nameBytes, 30)

    await this.sink(local)
    await this.sink(data)
    this.offset += local.length + data.length

    const central = new Uint8Array(46 + nameBytes.length)
    const cdv = new DataView(central.buffer)
    cdv.setUint32(0, 0x02014b50, true)
    cdv.setUint16(4, 20, true)
    cdv.setUint16(6, 20, true)
    cdv.setUint16(8, 0x0800, true)
    cdv.setUint16(10, 0, true)
    cdv.setUint16(12, time, true)
    cdv.setUint16(14, date, true)
    cdv.setUint32(16, crc, true)
    cdv.setUint32(20, data.length, true)
    cdv.setUint32(24, data.length, true)
    cdv.setUint16(28, nameBytes.length, true)
    cdv.setUint16(30, 0, true)
    cdv.setUint16(32, 0, true)
    cdv.setUint16(34, 0, true)
    cdv.setUint16(36, 0, true)
    cdv.setUint32(38, 0, true)
    cdv.setUint32(42, localOffset, true)
    central.set(nameBytes, 46)
    this.central.push(central)
    this.count += 1
  }

  async finish(): Promise<void> {
    const cdStart = this.offset
    let cdSize = 0
    for (const record of this.central) {
      await this.sink(record)
      cdSize += record.length
    }
    this.offset += cdSize

    const end = new Uint8Array(22)
    const edv = new DataView(end.buffer)
    edv.setUint32(0, 0x06054b50, true)
    edv.setUint16(4, 0, true)
    edv.setUint16(6, 0, true)
    edv.setUint16(8, this.count, true)
    edv.setUint16(10, this.count, true)
    edv.setUint32(12, cdSize, true)
    edv.setUint32(16, cdStart, true)
    edv.setUint16(20, 0, true)
    await this.sink(end)
  }
}

type SaveFilePickerOptions = {
  suggestedName?: string
  types?: { description?: string; accept: Record<string, string[]> }[]
}
type FileSystemWritableStream = {
  write: (data: Uint8Array | Blob) => Promise<void>
  close: () => Promise<void>
  abort?: () => Promise<void>
}
type FileSystemFileHandleLike = { createWritable: () => Promise<FileSystemWritableStream> }

export function supportsFileSystemAccess(): boolean {
  return typeof window !== 'undefined' && typeof (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker === 'function'
}

/** Open a writable that streams to a user-chosen file (Chromium). Throws AbortError if cancelled. */
export async function openZipFileSink(
  suggestedName: string
): Promise<{ sink: ZipSink; close: () => Promise<void> }> {
  const picker = (window as unknown as {
    showSaveFilePicker: (o: SaveFilePickerOptions) => Promise<FileSystemFileHandleLike>
  }).showSaveFilePicker
  const handle = await picker({
    suggestedName,
    types: [{ description: 'ZIP archive', accept: { 'application/zip': ['.zip'] } }],
  })
  const writable = await handle.createWritable()
  return {
    sink: (chunk) => writable.write(chunk),
    close: () => writable.close(),
  }
}
