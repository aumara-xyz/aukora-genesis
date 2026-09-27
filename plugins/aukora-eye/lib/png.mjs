/**
 * A PNG reader, because a release cannot be assumed to have an image library.
 *
 * The diff needs pixel values, and the running release carries no `sharp` (measured: the module is
 * absent from its `node_modules`). Node's own `zlib` is enough: a window capture from Electron is
 * 8-bit RGBA, non-interlaced, and filter 0 or 1 on the first row, which is the whole of what this
 * decodes. Anything else is REFUSED BY NAME rather than returned as plausible pixels — a diff built
 * on a half-decoded image would report changes that are not there.
 *
 * @module @aukora/dsh-plugin-eye/png
 */

import { inflateSync } from 'node:zlib'

/** The eight bytes every PNG file starts with. */
export const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** Raised for bytes this reader will not guess about. */
export class PngError extends Error {
  /**
   * @param message - what is wrong with the bytes.
   * @param code - a stable code a caller can branch on.
   */
  constructor(message, code) {
    super(message)
    this.name = 'PngError'
    this.code = code
  }
}

/** @returns the bytes as a Buffer without copying when they already are one. */
function bytesOf(value) {
  if (Buffer.isBuffer(value)) return value
  if (value instanceof Uint8Array) return Buffer.from(value.buffer, value.byteOffset, value.byteLength)
  throw new PngError('not image bytes', 'png.not-bytes')
}

/**
 * Read the size a PNG declares in its IHDR.
 * @param input - PNG bytes.
 * @returns the declared width and height.
 */
export function readPngSize(input) {
  const data = bytesOf(input)
  if (data.length < 24 || !data.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new PngError('not a PNG: signature does not match', 'png.not-png')
  }
  if (data.subarray(12, 16).toString('ascii') !== 'IHDR') {
    throw new PngError('not a PNG: first chunk is not IHDR', 'png.not-png')
  }
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) }
}

/**
 * The chunks one PNG carries, in order.
 * @param data - PNG bytes.
 * @returns every chunk's type and payload.
 */
function readChunks(data) {
  const chunks = []
  let offset = 8
  while (offset + 8 <= data.length) {
    const length = data.readUInt32BE(offset)
    const type = data.subarray(offset + 4, offset + 8).toString('ascii')
    const body = data.subarray(offset + 8, offset + 8 + length)
    if (body.length !== length) throw new PngError(`truncated ${type} chunk`, 'png.truncated')
    chunks.push({ type, body })
    offset += 12 + length
    if (type === 'IEND') break
  }
  return chunks
}

/**
 * Undo one PNG row filter.
 *
 * All five filter types are implemented because a capture's filters are the encoder's business, not
 * this reader's assumption; the bytes-per-pixel stride is what makes `average` and `paeth` correct.
 * @param type - the filter byte preceding the row.
 * @param raw - the filtered row bytes.
 * @param previous - the already-reconstructed row above, or undefined for the first row.
 * @param bpp - bytes per complete pixel.
 * @returns the reconstructed row.
 */
function unfilter(type, raw, previous, bpp) {
  const out = Buffer.alloc(raw.length)
  for (let i = 0; i < raw.length; i += 1) {
    const left = i >= bpp ? out[i - bpp] : 0
    const up = previous === undefined ? 0 : previous[i]
    const upLeft = previous === undefined || i < bpp ? 0 : previous[i - bpp]
    let value = raw[i]
    if (type === 1) value += left
    else if (type === 2) value += up
    else if (type === 3) value += Math.floor((left + up) / 2)
    else if (type === 4) {
      const estimate = left + up - upLeft
      const dLeft = Math.abs(estimate - left)
      const dUp = Math.abs(estimate - up)
      const dUpLeft = Math.abs(estimate - upLeft)
      value += (dLeft <= dUp && dLeft <= dUpLeft) ? left : (dUp <= dUpLeft ? up : upLeft)
    }
    out[i] = value & 0xff
  }
  return out
}

/**
 * Decode a PNG into RGBA bytes.
 *
 * The output is always RGBA, whatever the file's colour type: the diff compares one layout, and
 * normalizing here keeps that comparison honest.
 * @param input - PNG bytes.
 * @returns width, height and the RGBA pixels in row order.
 */
export function decodePng(input) {
  const data = bytesOf(input)
  const chunks = readChunks(data)
  const header = chunks.find(chunk => chunk.type === 'IHDR')
  if (header === undefined) throw new PngError('not a PNG: no IHDR', 'png.not-png')
  const width = header.body.readUInt32BE(0)
  const height = header.body.readUInt32BE(4)
  const depth = header.body[8]
  const colorType = header.body[9]
  const interlace = header.body[12]
  if (depth !== 8) throw new PngError(`unsupported PNG: bit depth ${depth}, expected 8`, 'png.unsupported')
  if (interlace !== 0) throw new PngError('unsupported PNG: interlaced', 'png.unsupported')
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : 0
  if (channels === 0) throw new PngError(`unsupported PNG: colour type ${colorType}`, 'png.unsupported')

  const compressed = Buffer.concat(chunks.filter(chunk => chunk.type === 'IDAT').map(chunk => chunk.body))
  const raw = inflateSync(compressed)
  const stride = width * channels
  if (raw.length < height * (1 + stride)) {
    throw new PngError(`truncated PNG: ${raw.length} bytes for ${width}x${height}`, 'png.truncated')
  }

  const rgba = Buffer.alloc(width * height * 4)
  let previous
  for (let y = 0; y < height; y += 1) {
    const at = y * (1 + stride)
    const row = unfilter(raw[at], raw.subarray(at + 1, at + 1 + stride), previous, channels)
    previous = row
    for (let x = 0; x < width; x += 1) {
      const source = x * channels
      const target = (y * width + x) * 4
      if (channels === 4) {
        rgba[target] = row[source]
        rgba[target + 1] = row[source + 1]
        rgba[target + 2] = row[source + 2]
        rgba[target + 3] = row[source + 3]
      } else if (channels === 3) {
        rgba[target] = row[source]
        rgba[target + 1] = row[source + 1]
        rgba[target + 2] = row[source + 2]
        rgba[target + 3] = 255
      } else {
        rgba[target] = row[source]
        rgba[target + 1] = row[source]
        rgba[target + 2] = row[source]
        rgba[target + 3] = 255
      }
    }
  }
  return { width, height, rgba }
}
