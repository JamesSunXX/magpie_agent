import { extname } from 'path'
import { readFile } from 'fs/promises'

interface LoadedImage {
  mimeType: string
  base64: string
}

export type SupportedImageMimeType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'

const imageCache = new Map<string, LoadedImage>()

function mimeTypeFromExt(source: string): string {
  const ext = extname(source).toLowerCase()
  switch (ext) {
    case '.png': return 'image/png'
    case '.jpg':
    case '.jpeg': return 'image/jpeg'
    case '.webp': return 'image/webp'
    case '.gif': return 'image/gif'
    default: return 'application/octet-stream'
  }
}

function isRemoteUrl(source: string): boolean {
  return /^https?:\/\//i.test(source)
}

export async function loadImageAsBase64(source: string): Promise<LoadedImage> {
  const cached = imageCache.get(source)
  if (cached) return cached

  let bytes: Buffer
  let mimeType = mimeTypeFromExt(source)

  if (isRemoteUrl(source)) {
    const response = await fetch(source)
    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.status}`)
    }
    const contentType = response.headers.get('content-type')
    if (contentType) {
      mimeType = contentType.split(';')[0].trim()
    }
    bytes = Buffer.from(await response.arrayBuffer())
  } else {
    bytes = await readFile(source)
  }

  const loaded: LoadedImage = {
    mimeType,
    base64: bytes.toString('base64'),
  }

  imageCache.set(source, loaded)
  return loaded
}

export async function loadImageAsDataUrl(source: string): Promise<string> {
  const image = await loadImageAsBase64(source)
  return `data:${image.mimeType};base64,${image.base64}`
}

export function toSupportedImageMimeType(mimeType: string): SupportedImageMimeType {
  switch (mimeType) {
    case 'image/png':
    case 'image/jpeg':
    case 'image/webp':
    case 'image/gif':
      return mimeType
    default:
      return 'image/png'
  }
}
