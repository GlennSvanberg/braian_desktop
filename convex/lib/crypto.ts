/**
 * AES-GCM helpers for encrypting per-user secrets at rest.
 *
 * The master key lives in the `BRAIAN_KEY_ENCRYPTION_KEY` Convex env var as
 * a 64-character hex string (32 bytes). Generate one with:
 *   `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
 * then store via `npx convex env set BRAIAN_KEY_ENCRYPTION_KEY <hex>`.
 *
 * AES-GCM is authenticated; tampering or wrong key fails on decrypt. We
 * generate a fresh random IV per encryption and store it alongside the
 * ciphertext (both base64-encoded) so two users with the same plaintext key
 * never produce the same ciphertext.
 */

declare const process: { env: Record<string, string | undefined> }

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) {
    throw new Error('BRAIAN_KEY_ENCRYPTION_KEY must be a hex string')
  }
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i += 1) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return out
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i)
  return out
}

async function getMasterKey(): Promise<CryptoKey> {
  const hex = process.env.BRAIAN_KEY_ENCRYPTION_KEY
  if (!hex) {
    throw new Error(
      'Missing BRAIAN_KEY_ENCRYPTION_KEY Convex env var. Generate 32 random bytes (hex) and set it via `npx convex env set BRAIAN_KEY_ENCRYPTION_KEY <hex>`.',
    )
  }
  const raw = hexToBytes(hex)
  if (raw.length !== 32) {
    throw new Error(
      `BRAIAN_KEY_ENCRYPTION_KEY must decode to 32 bytes (got ${raw.length}). ` +
        'AES-256-GCM needs 64 hex characters. Regenerate with ' +
        '`node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"` ' +
        'or `openssl rand -hex 32`, then `npx convex env set BRAIAN_KEY_ENCRYPTION_KEY <64-char-hex>`.',
    )
  }
  return crypto.subtle.importKey(
    'raw',
    raw as BufferSource,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt'],
  )
}

export async function encryptSecret(
  plaintext: string,
): Promise<{ cipherText: string; iv: string }> {
  const key = await getMasterKey()
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    new TextEncoder().encode(plaintext) as BufferSource,
  )
  return {
    cipherText: bytesToBase64(new Uint8Array(ciphertext)),
    iv: bytesToBase64(iv),
  }
}

export async function decryptSecret(args: {
  cipherText: string
  iv: string
}): Promise<string> {
  const key = await getMasterKey()
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(args.iv) as BufferSource },
    key,
    base64ToBytes(args.cipherText) as BufferSource,
  )
  return new TextDecoder().decode(plaintext)
}

export function lastFourOf(secret: string): string {
  const trimmed = secret.trim()
  return trimmed.length <= 4 ? trimmed : trimmed.slice(-4)
}
