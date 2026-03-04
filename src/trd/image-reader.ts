import { dirname, isAbsolute, join } from 'path'
import { mkdtemp, writeFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { exec } from 'child_process'
import { promisify } from 'util'
import type { ParsedImage } from './types.js'

const execAsync = promisify(exec)

export interface ImageReaderOptions {
  enabled: boolean
  command: string
  timeoutMs: number
  retries: number
}

function isRemoteUrl(source: string): boolean {
  return /^https?:\/\//i.test(source)
}

async function downloadImage(url: string): Promise<string> {
  const tempDir = await mkdtemp(join(tmpdir(), 'magpie-trd-img-'))
  const target = join(tempDir, 'image')

  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }

  const bytes = Buffer.from(await response.arrayBuffer())
  await writeFile(target, bytes)
  return target
}

function resolveLocalImage(source: string, prdPath: string): string {
  if (isAbsolute(source)) return source
  return join(dirname(prdPath), source)
}

async function runOcr(commandTemplate: string, imagePath: string, timeoutMs: number): Promise<string> {
  const command = commandTemplate.replace('{image}', `"${imagePath}"`)
  const { stdout } = await execAsync(command, {
    timeout: timeoutMs,
    maxBuffer: 2 * 1024 * 1024,
  })
  return stdout.trim()
}

export async function enrichImagesWithOcr(
  images: ParsedImage[],
  prdPath: string,
  options: ImageReaderOptions
): Promise<ParsedImage[]> {
  if (!options.enabled) return images

  const result: ParsedImage[] = []
  for (const image of images) {
    let tempFile: string | null = null
    try {
      const resolved = isRemoteUrl(image.source)
        ? await downloadImage(image.source)
        : resolveLocalImage(image.source, prdPath)
      if (isRemoteUrl(image.source)) tempFile = resolved

      let lastError: Error | null = null
      let ocrText = ''
      for (let i = 0; i <= options.retries; i++) {
        try {
          ocrText = await runOcr(options.command, resolved, options.timeoutMs)
          break
        } catch (error) {
          lastError = error as Error
        }
      }

      if (!ocrText && lastError) {
        throw lastError
      }

      result.push({
        ...image,
        resolvedPath: resolved,
        ocrText,
      })
    } catch (error) {
      result.push({
        ...image,
        error: error instanceof Error ? error.message : String(error),
      })
    } finally {
      if (tempFile) {
        const tempDir = dirname(tempFile)
        await rm(tempDir, { recursive: true, force: true })
      }
    }
  }

  return result
}

