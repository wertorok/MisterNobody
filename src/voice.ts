import { readFileSync, renameSync } from 'fs'
import https from 'https'
import path from 'path'
import { GROQ_API_KEY, ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID } from './config.js'
import { logger } from './logger.js'

export function voiceCapabilities(): { stt: boolean; tts: boolean } {
  return {
    stt: Boolean(GROQ_API_KEY),
    tts: Boolean(ELEVENLABS_API_KEY && ELEVENLABS_VOICE_ID),
  }
}

export async function transcribeAudio(filePath: string): Promise<string> {
  // Groq requires .ogg extension, not .oga
  let audioPath = filePath
  if (filePath.endsWith('.oga')) {
    const newPath = filePath.replace(/\.oga$/, '.ogg')
    renameSync(filePath, newPath)
    audioPath = newPath
  }

  const fileBuffer = readFileSync(audioPath)
  const filename = path.basename(audioPath)

  // Build multipart/form-data manually
  const boundary = `----FormBoundary${Date.now()}`
  const CRLF = '\r\n'

  const fieldPart = [
    `--${boundary}`,
    'Content-Disposition: form-data; name="model"',
    '',
    'whisper-large-v3',
    `--${boundary}`,
    `Content-Disposition: form-data; name="file"; filename="${filename}"`,
    'Content-Type: audio/ogg',
    '',
  ].join(CRLF)

  const closingPart = `${CRLF}--${boundary}--${CRLF}`

  const body = Buffer.concat([
    Buffer.from(fieldPart + CRLF),
    fileBuffer,
    Buffer.from(closingPart),
  ])

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'api.groq.com',
        path: '/openai/v1/audio/transcriptions',
        method: 'POST',
        headers: {
          Authorization: `Bearer ${GROQ_API_KEY}`,
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': body.length,
        },
      },
      (res) => {
        let data = ''
        res.on('data', chunk => (data += chunk))
        res.on('end', () => {
          try {
            const json = JSON.parse(data) as { text?: string; error?: { message: string } }
            if (json.error) {
              reject(new Error(json.error.message))
            } else {
              resolve(json.text ?? '')
            }
          } catch {
            reject(new Error(`Failed to parse Groq response: ${data}`))
          }
        })
      }
    )
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

export async function synthesizeSpeech(text: string): Promise<Buffer> {
  const body = JSON.stringify({
    text,
    model_id: 'eleven_turbo_v2_5',
    voice_settings: {
      stability: 0.5,
      similarity_boost: 0.75,
    },
  })

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'api.elevenlabs.io',
        path: `/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`,
        method: 'POST',
        headers: {
          'xi-api-key': ELEVENLABS_API_KEY,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', chunk => chunks.push(chunk as Buffer))
        res.on('end', () => {
          const buf = Buffer.concat(chunks)
          if (res.statusCode !== 200) {
            reject(new Error(`ElevenLabs error ${res.statusCode}: ${buf.toString()}`))
          } else {
            resolve(buf)
          }
        })
      }
    )
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

logger.debug(voiceCapabilities(), 'Voice capabilities')
