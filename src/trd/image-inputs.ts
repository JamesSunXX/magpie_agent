import { existsSync } from 'fs'
import { dirname, isAbsolute, join } from 'path'
import type { ChatImageInput } from '../providers/types.js'
import type { ParsedImage } from './types.js'

function isRemoteSource(source: string): boolean {
  return /^https?:\/\//i.test(source)
}

function resolveImageSource(image: ParsedImage, prdPath: string): string | null {
  if (isRemoteSource(image.source)) {
    return image.source
  }

  const localPath = isAbsolute(image.source)
    ? image.source
    : join(dirname(prdPath), image.source)

  return existsSync(localPath) ? localPath : null
}

export interface CollectChatImagesResult {
  images: ChatImageInput[]
  warnings: string[]
}

export function collectChatImages(
  parsedImages: ParsedImage[],
  prdPath: string
): CollectChatImagesResult {
  const images: ChatImageInput[] = []
  const warnings: string[] = []
  const seen = new Set<string>()

  for (const image of parsedImages) {
    const source = resolveImageSource(image, prdPath)
    if (!source) {
      warnings.push(`图片资源不存在，已跳过: ${image.source}`)
      continue
    }
    if (seen.has(source)) continue
    seen.add(source)

    images.push({
      source,
      label: image.alt || `IMG-${String(image.index).padStart(3, '0')}`,
    })
  }

  return { images, warnings }
}
