import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

import { env } from '../config/env.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16; // 128-bit IV
const TAG_LENGTH = 16; // 128-bit auth tag
const ENCODING = 'base64' as const;

// ---------------------------------------------------------------------------
// Key derivation (deterministic — same key on every call)
// ---------------------------------------------------------------------------

/** Derive a 32-byte key from the variable-length SECRET_KEY via SHA-256. */
function deriveKey(): Buffer {
  return createHash('sha256').update(env.SECRET_KEY).digest();
}

const KEY = deriveKey();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Encrypt a plaintext string using AES-256-GCM.
 *
 * @returns A base64-encoded string in the format `iv:ciphertext:tag`.
 */
export function encrypt(plaintext: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, KEY, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);

  const tag = cipher.getAuthTag();

  return [
    iv.toString(ENCODING),
    encrypted.toString(ENCODING),
    tag.toString(ENCODING),
  ].join(':');
}

/**
 * Decrypt a string produced by {@link encrypt}.
 *
 * @param encrypted - A base64-encoded string in the format `iv:ciphertext:tag`.
 * @returns The original plaintext.
 */
export function decrypt(encrypted: string): string {
  const parts = encrypted.split(':');

  if (parts.length !== 3) {
    throw new Error(
      'Invalid encrypted payload — expected format "iv:ciphertext:tag"',
    );
  }

  const [ivB64, ciphertextB64, tagB64] = parts as [string, string, string];

  const iv = Buffer.from(ivB64, ENCODING);
  const ciphertext = Buffer.from(ciphertextB64, ENCODING);
  const tag = Buffer.from(tagB64, ENCODING);

  if (tag.length !== TAG_LENGTH) {
    throw new Error(
      `Invalid auth tag length: expected ${TAG_LENGTH} bytes, got ${tag.length}`,
    );
  }

  const decipher = createDecipheriv(ALGORITHM, KEY, iv);
  decipher.setAuthTag(tag);

  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString('utf8');
}
