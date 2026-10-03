import { createCipheriv, createDecipheriv, randomBytes, scrypt } from 'node:crypto'
import { stableJson } from './util.js'

const keyBytes = 32
const ivBytes = 12
const saltBytes = 16
const authenticationTagBytes = 16
const scryptParameters = Object.freeze({ N: 131_072, r: 8, p: 1 })
const scryptMaximumMemory = 256 * 1024 * 1024

export const encryptedExportFormat = 'steward-encrypted-export-v1' as const
export const minimumExportPassphraseCharacters = 12

export interface CarveEncryptedExport {
  format: typeof encryptedExportFormat
  createdAt: string
  encryption: {
    cipher: 'aes-256-gcm'
    kdf: 'scrypt'
    parameters: { N: number; r: number; p: number }
    salt: string
    iv: string
  }
  ciphertext: string
  authenticationTag: string
}

/**
 * Produces a portable, authenticated envelope. The passphrase is deliberately
 * not normalized or trimmed: changing what the person typed would create an
 * export that looks valid but cannot be recovered with the original secret.
 */
export async function encryptCarveExport(payload: unknown, passphrase: string, createdAt = new Date().toISOString()): Promise<CarveEncryptedExport> {
  validateNewPassphrase(passphrase)
  const salt = randomBytes(saltBytes)
  const iv = randomBytes(ivBytes)
  const header: Omit<CarveEncryptedExport, 'ciphertext' | 'authenticationTag'> = {
    format: encryptedExportFormat,
    createdAt,
    encryption: {
      cipher: 'aes-256-gcm',
      kdf: 'scrypt',
      parameters: { ...scryptParameters },
      salt: salt.toString('base64url'),
      iv: iv.toString('base64url'),
    },
  }
  const key = await deriveKey(passphrase, salt, scryptParameters)
  try {
    const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: authenticationTagBytes })
    cipher.setAAD(Buffer.from(stableJson(header), 'utf8'))
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(payload), 'utf8'),
      cipher.final(),
    ])
    return {
      ...header,
      ciphertext: ciphertext.toString('base64url'),
      authenticationTag: cipher.getAuthTag().toString('base64url'),
    }
  } finally {
    key.fill(0)
  }
}

/** Used by the recovery utility and tests. Authentication failures are kept
 * deliberately uniform so callers cannot distinguish a wrong passphrase from
 * a modified envelope. */
export async function decryptCarveExport(envelopeValue: unknown, passphrase: string): Promise<unknown> {
  try {
    const envelope = parseEnvelope(envelopeValue)
    if (typeof passphrase !== 'string' || Buffer.byteLength(passphrase, 'utf8') > 1_024) throw new Error('invalid passphrase')
    const salt = decodeBase64Url(envelope.encryption.salt, saltBytes)
    const iv = decodeBase64Url(envelope.encryption.iv, ivBytes)
    const tag = decodeBase64Url(envelope.authenticationTag, authenticationTagBytes)
    const ciphertext = decodeBase64Url(envelope.ciphertext)
    const header: Omit<CarveEncryptedExport, 'ciphertext' | 'authenticationTag'> = {
      format: envelope.format,
      createdAt: envelope.createdAt,
      encryption: envelope.encryption,
    }
    const key = await deriveKey(passphrase, salt, envelope.encryption.parameters)
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: authenticationTagBytes })
      decipher.setAAD(Buffer.from(stableJson(header), 'utf8'))
      decipher.setAuthTag(tag)
      const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])
      return JSON.parse(plaintext.toString('utf8')) as unknown
    } finally {
      key.fill(0)
    }
  } catch {
    throw new Error('Export could not be decrypted. The passphrase is wrong or the file was modified.')
  }
}

export function validateNewPassphrase(passphrase: string): void {
  if (typeof passphrase !== 'string') throw new Error('Export passphrase must be a string')
  if ([...passphrase].length < minimumExportPassphraseCharacters) {
    throw new Error(`Export passphrase must contain at least ${minimumExportPassphraseCharacters} characters`)
  }
  if (!passphrase.trim()) throw new Error('Export passphrase cannot contain only whitespace')
  if (Buffer.byteLength(passphrase, 'utf8') > 1_024) throw new Error('Export passphrase is too long')
}

function deriveKey(passphrase: string, salt: Buffer, parameters: { N: number; r: number; p: number }): Promise<Buffer> {
  return new Promise((resolvePromise, reject) => {
    scrypt(passphrase, salt, keyBytes, { ...parameters, maxmem: scryptMaximumMemory }, (error, derived) => {
      if (error) reject(error)
      else resolvePromise(derived)
    })
  })
}

function parseEnvelope(value: unknown): CarveEncryptedExport {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid envelope')
  const candidate = value as Partial<CarveEncryptedExport>
  if (candidate.format !== encryptedExportFormat || typeof candidate.createdAt !== 'string' || Number.isNaN(Date.parse(candidate.createdAt))) throw new Error('invalid header')
  const encryption = candidate.encryption
  if (!encryption || encryption.cipher !== 'aes-256-gcm' || encryption.kdf !== 'scrypt') throw new Error('unsupported encryption')
  const parameters = encryption.parameters
  if (!parameters || parameters.N !== scryptParameters.N || parameters.r !== scryptParameters.r || parameters.p !== scryptParameters.p) throw new Error('unsupported KDF')
  if (typeof encryption.salt !== 'string' || typeof encryption.iv !== 'string' || typeof candidate.ciphertext !== 'string' || typeof candidate.authenticationTag !== 'string') throw new Error('invalid encoding')
  return candidate as CarveEncryptedExport
}

function decodeBase64Url(value: string, expectedBytes?: number): Buffer {
  if (!/^[A-Za-z0-9_-]*$/u.test(value)) throw new Error('invalid base64url')
  const decoded = Buffer.from(value, 'base64url')
  if (decoded.toString('base64url') !== value || (expectedBytes !== undefined && decoded.length !== expectedBytes)) throw new Error('invalid base64url length')
  return decoded
}
