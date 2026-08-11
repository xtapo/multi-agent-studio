import { prisma } from "@/server/db";
import { decryptSecret, encryptSecret, last4 } from "@/lib/crypto";
import { AppError } from "@/lib/errors";
import type { ProviderKeyOverrides } from "@/lib/providers/context";

/**
 * User-supplied provider API keys.
 *
 * Stored encrypted with AES-256-GCM (`src/lib/crypto.ts`). The plaintext is
 * written once, read only by the run executor, and never returned by any API:
 * the client sees the provider, an optional label and the last four characters,
 * which is enough to recognise a key without being enough to use it.
 *
 * Only providers that authenticate with a simple bearer-style key are exposed.
 * A self-hosted endpoint is a deployment concern, not a per-user secret.
 */
export const USER_KEY_PROVIDERS = ["openai", "anthropic"] as const;
export type UserKeyProvider = (typeof USER_KEY_PROVIDERS)[number];

export interface ProviderKeySummary {
  id: string;
  provider: string;
  label: string | null;
  last4: string;
}

export async function listProviderKeys(userId: string): Promise<ProviderKeySummary[]> {
  const rows = await prisma.providerApiKey.findMany({
    where: { userId },
    select: { id: true, provider: true, label: true, last4: true },
    orderBy: { provider: "asc" },
  });
  return rows.map((row) => ({ ...row, label: row.label ?? null }));
}

export async function saveProviderKey(params: {
  userId: string;
  provider: UserKeyProvider;
  apiKey: string;
  label?: string;
}): Promise<ProviderKeySummary> {
  const { userId, provider, apiKey } = params;
  const label = params.label?.trim() || "default";

  const payload = encryptSecret(apiKey);
  const data = { ...payload, last4: last4(apiKey), label };

  // findFirst + update/create rather than upsert: one key per provider per user
  // is the product rule, and this keeps replacing a key a single obvious path
  // regardless of the label the user typed.
  const existing = await prisma.providerApiKey.findFirst({
    where: { userId, provider },
    select: { id: true },
  });

  const row = existing
    ? await prisma.providerApiKey.update({
        where: { id: existing.id },
        data,
        select: { id: true, provider: true, label: true, last4: true },
      })
    : await prisma.providerApiKey.create({
        data: { userId, provider, ...data },
        select: { id: true, provider: true, label: true, last4: true },
      });

  return { ...row, label: row.label ?? null };
}

export async function deleteProviderKey(userId: string, provider: string): Promise<void> {
  const result = await prisma.providerApiKey.deleteMany({ where: { userId, provider } });
  if (result.count === 0) throw new AppError("NOT_FOUND", `No stored key for "${provider}".`);
}

/**
 * Decrypt every key belonging to a user, for use during a run.
 *
 * A key that fails to decrypt (usually because ENCRYPTION_KEY was rotated) is
 * skipped rather than fatal: the run falls back to the server key instead of
 * dying, and the operator sees exactly which row is stale in the logs.
 */
export async function loadUserProviderKeys(userId: string): Promise<ProviderKeyOverrides> {
  const rows = await prisma.providerApiKey.findMany({
    where: { userId },
    select: { provider: true, ciphertext: true, iv: true, authTag: true },
  });

  const overrides: ProviderKeyOverrides = {};
  for (const row of rows) {
    try {
      overrides[row.provider] = decryptSecret(row);
    } catch (err) {
      console.error(`[provider-keys] could not decrypt ${row.provider} key for user ${userId}`, err);
    }
  }
  return overrides;
}
