import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

/**
 * Get encryption key from env. INTEGRATIONS_TOKEN_KEY must be base64-encoded 32 bytes.
 */
function getKey(): Buffer {
  const raw = process.env.INTEGRATIONS_TOKEN_KEY;
  if (!raw || raw.length < 32) {
    throw new Error("INTEGRATIONS_TOKEN_KEY must be set (base64, 32+ bytes decoded)");
  }
  const key = Buffer.from(raw, "base64");
  if (key.length < 32) {
    throw new Error("INTEGRATIONS_TOKEN_KEY decoded length must be at least 32 bytes");
  }
  return key.subarray(0, 32);
}

/**
 * Encrypt a plaintext string. Returns a single base64 blob: iv + authTag + ciphertext.
 * Do not log the result.
 */
export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, enc]).toString("base64");
}

/**
 * Decrypt a blob produced by encrypt(). Do not log the input or output.
 */
export function decrypt(blob: string): string {
  const key = getKey();
  const buf = Buffer.from(blob, "base64");
  if (buf.length < IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new Error("Invalid encrypted blob");
  }
  const iv = buf.subarray(0, IV_LENGTH);
  const authTag = buf.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = buf.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return decipher.update(ciphertext) + decipher.final("utf8");
}
