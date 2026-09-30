// SPDX-License-Identifier: AGPL-3.0-or-later
import jsQR from '#jsqr'

type FrameSource = HTMLVideoElement | HTMLImageElement | HTMLCanvasElement | ImageBitmap
type NativeDetector = { detect(source: FrameSource): Promise<readonly { rawValue?: string }[]> }
type NativeConstructor = new (options: { formats: string[] }) => NativeDetector
let nativeDetector: NativeDetector | null | undefined

function detector(): NativeDetector | null {
  if (nativeDetector !== undefined) return nativeDetector
  try {
    const Constructor = (globalThis as typeof globalThis & { BarcodeDetector?: NativeConstructor }).BarcodeDetector
    nativeDetector = Constructor ? new Constructor({ formats: ['qr_code'] }) : null
  } catch {
    nativeDetector = null
  }
  return nativeDetector
}

function dimensions(source: FrameSource): { width: number; height: number } {
  if ('videoWidth' in source) {
    return source.readyState < 2 ? { width: 0, height: 0 } : { width: source.videoWidth, height: source.videoHeight }
  }
  if ('naturalWidth' in source) {
    return source.complete ? { width: source.naturalWidth, height: source.naturalHeight } : { width: 0, height: 0 }
  }
  return { width: source.width, height: source.height }
}

export async function decodeQrFrame(source: FrameSource, canvas?: HTMLCanvasElement): Promise<string | null> {
  const size = dimensions(source)
  if (!Number.isFinite(size.width) || !Number.isFinite(size.height) || size.width <= 0 || size.height <= 0) return null
  const native = detector()
  if (native) {
    try {
      const codes = await native.detect(source)
      const found = codes.find(code => typeof code.rawValue === 'string' && code.rawValue.length > 0)
      if (found?.rawValue) return found.rawValue
    } catch {
      nativeDetector = null
    }
  }
  // Keep dense contact QRs legible while bounding pixel buffers on mobile WebKit.
  const scale = Math.min(1, 4096 / size.width, 4096 / size.height, Math.sqrt((8 * 1024 * 1024) / (size.width * size.height)))
  const width = Math.max(1, Math.floor(size.width * scale))
  const height = Math.max(1, Math.floor(size.height * scale))
  try {
    let surface = canvas
    if (!surface || (surface === source && (surface.width !== width || surface.height !== height))) {
      surface = document.createElement('canvas')
    }
    if (surface.width !== width) surface.width = width
    if (surface.height !== height) surface.height = height
    const context = surface.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('qr:unavailable')
    if (surface !== source) {
      context.clearRect(0, 0, width, height)
      context.drawImage(source, 0, 0, width, height)
    }
    const pixels = context.getImageData(0, 0, width, height)
    return jsQR(pixels.data, width, height, { inversionAttempts: 'attemptBoth' })?.data || null
  } catch {
    throw new Error('qr:unavailable')
  }
}

async function decodeImage(source: HTMLImageElement | ImageBitmap): Promise<string> {
  const { width, height } = dimensions(source)
  if (width <= 0 || height <= 0) throw new Error('qr:image-unreadable')
  const result = await decodeQrFrame(source)
  if (result === null) throw new Error('qr:not-found')
  return result
}

export async function decodeQrImage(file: File): Promise<string> {
  let bitmap: ImageBitmap | undefined
  if (typeof createImageBitmap === 'function') {
    try {
      bitmap = await createImageBitmap(file)
    } catch {
      // Safari may expose createImageBitmap but reject a supported image format.
    }
  }
  if (bitmap) {
    try {
      return await decodeImage(bitmap)
    } finally {
      bitmap.close()
    }
  }
  let url: string | undefined
  let image: HTMLImageElement | undefined
  try {
    try {
      const objectUrl = URL.createObjectURL(file)
      url = objectUrl
      const element = new Image()
      image = element
      await new Promise<void>((resolve, reject) => {
        element.onload = () => resolve()
        element.onerror = () => reject(new Error('qr:image-unreadable'))
        element.src = objectUrl
      })
    } catch {
      throw new Error('qr:image-unreadable')
    }
    return await decodeImage(image)
  } finally {
    if (image) {
      image.onload = null
      image.onerror = null
    }
    if (url !== undefined) URL.revokeObjectURL(url)
  }
}
