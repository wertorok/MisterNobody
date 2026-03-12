import { createWriteStream, existsSync, readdirSync, statSync, unlinkSync, mkdirSync } from 'fs'
import https from 'https'
import path from 'path'
import { fileURLToPath } from 'url'
import { TELEGRAM_BOT_TOKEN } from './config.js'
import { logger } from './logger.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const UPLOADS_DIR = path.join(__dirname, '..', 'workspace', 'uploads')

export function ensureUploadsDir(): void {
  mkdirSync(UPLOADS_DIR, { recursive: true })
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '-')
}

function downloadUrl(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = createWriteStream(dest)
    https.get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close()
        downloadUrl(res.headers.location!, dest).then(resolve).catch(reject)
        return
      }
      res.pipe(file)
      file.on('finish', () => file.close(() => resolve()))
      file.on('error', reject)
    }).on('error', reject)
  })
}

export async function downloadMedia(
  fileId: string,
  originalFilename?: string
): Promise<string> {
  ensureUploadsDir()

  // Get file path from Telegram
  const fileInfoUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getFile?file_id=${fileId}`
  const fileInfo = await new Promise<{ file_path: string }>((resolve, reject) => {
    https.get(fileInfoUrl, (res) => {
      let data = ''
      res.on('data', chunk => (data += chunk))
      res.on('end', () => {
        try {
          const json = JSON.parse(data) as { ok: boolean; result: { file_path: string } }
          if (!json.ok) reject(new Error('getFile failed'))
          else resolve(json.result)
        } catch (e) {
          reject(e)
        }
      })
    }).on('error', reject)
  })

  const telegramFilePath = fileInfo.file_path
  const ext = path.extname(telegramFilePath) || path.extname(originalFilename ?? '') || ''
  const baseName = originalFilename
    ? sanitizeFilename(path.basename(originalFilename, ext))
    : sanitizeFilename(path.basename(telegramFilePath, ext))

  const localPath = path.join(UPLOADS_DIR, `${Date.now()}_${baseName}${ext}`)
  const downloadFileUrl = `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${telegramFilePath}`

  await downloadUrl(downloadFileUrl, localPath)
  logger.info({ localPath }, 'Downloaded media')
  return localPath
}

export function buildPhotoMessage(localPath: string, caption?: string): string {
  return [
    `I'm sending you a photo saved at: ${localPath}`,
    'Please analyze this image and describe what you see.',
    caption ? `User caption: ${caption}` : '',
  ].filter(Boolean).join('\n')
}

export function buildDocumentMessage(localPath: string, filename: string, caption?: string): string {
  return [
    `I'm sending you a document: ${filename}`,
    `It's saved at: ${localPath}`,
    'Please read and summarize this document.',
    caption ? `User note: ${caption}` : '',
  ].filter(Boolean).join('\n')
}

export function buildVideoMessage(localPath: string, caption?: string): string {
  return [
    `I'm sending you a video saved at: ${localPath}`,
    'Please use the gemini-api-dev skill with the GOOGLE_API_KEY from .env to analyze this video.',
    caption ? `User caption: ${caption}` : '',
  ].filter(Boolean).join('\n')
}

export function cleanupOldUploads(maxAgeMs = 24 * 60 * 60 * 1000): void {
  if (!existsSync(UPLOADS_DIR)) return
  const now = Date.now()
  try {
    for (const file of readdirSync(UPLOADS_DIR)) {
      const filePath = path.join(UPLOADS_DIR, file)
      const stat = statSync(filePath)
      if (now - stat.mtimeMs > maxAgeMs) {
        unlinkSync(filePath)
        logger.debug({ filePath }, 'Deleted old upload')
      }
    }
  } catch (err) {
    logger.warn({ err }, 'cleanupOldUploads error')
  }
}
