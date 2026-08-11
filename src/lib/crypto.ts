import crypto from "node:crypto";
import { env } from "./env";
import { AppError } from "./errors";

/**
 * AES-256-GCM helpers for user-supplied provider API keys.
 *
 * Trade-off: we use a single symmetric key from the environment rather than a
 * KMS/envelope scheme. That is the right level for a self-hosted studio; the
 * interface below (encrypt -> {ciphertext, iv, authTag}) is deliberately shaped
 * like an envelope so swapping in KMS later touches only this file.
 */
function key(): Buffer {
  if (!env.ENCRYPTION_KEY) {
    throw new AppError("INTERNAL", "ENCRYPTION_KEY is not configured; cannot store user API keys.");
  }
  const buf = Buffer.from(env.ENCRYPTION_KEY, "base64");
  if (buf.length !== 32) {
    throw new AppError("INTERNAL", "ENCRYPTION_KEY must decode to exactly 32 bytes (base64 of 32 random bytes).");
  }
  return buf;
}

export interface EncryptedPayload {
  ciphertext: string;
  iv: string;
  authTag: string;
}

export function encryptSecret(plaintext: string): EncryptedPayload {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    ciphertext: enc.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
  };
}

export function decryptSecret(payload: EncryptedPayload): string {
  const decipher = crypto.createDecipheriv("aes-256-gcm", key(), Buffer.from(payload.iv, "base64"));
  decipher.setAuthTag(Buffer.from(payload.authTag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(payload.ciphertext, "base64")), decipher.final()]).toString("utf8");
}

export function last4(secret: string): string {
  return secret.slice(-4);
}
