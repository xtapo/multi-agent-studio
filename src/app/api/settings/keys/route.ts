import { z } from "zod";
import { AppError } from "@/lib/errors";
import { parseBody, route } from "@/server/api-helpers";
import { RATE_LIMITS } from "@/server/rate-limit";
import {
  USER_KEY_PROVIDERS,
  deleteProviderKey,
  listProviderKeys,
  saveProviderKey,
} from "@/server/repositories/provider-key-repo";

/**
 * Provider API keys for the signed-in user.
 *
 * GET returns metadata only — there is no endpoint anywhere that returns a
 * stored key in plaintext, not even to its owner. Once submitted, a key can be
 * replaced or deleted, never read back.
 */
const saveSchema = z.object({
  provider: z.enum(USER_KEY_PROVIDERS),
  apiKey: z.string().trim().min(20, "That does not look like an API key."),
  label: z.string().trim().max(60).optional(),
});

export const GET = route(async ({ userId }) => ({
  providers: USER_KEY_PROVIDERS,
  keys: await listProviderKeys(userId),
}));

export const POST = route(
  async ({ userId, req }) => {
    const body = await parseBody(req, saveSchema);
    return { key: await saveProviderKey({ userId, ...body }) };
  },
  { rateLimit: RATE_LIMITS.write, key: "settings-keys" },
);

export const DELETE = route(
  async ({ userId, req }) => {
    const provider = new URL(req.url).searchParams.get("provider");
    if (!provider) throw new AppError("VALIDATION", "A provider query parameter is required.");
    await deleteProviderKey(userId, provider);
    return { deleted: provider };
  },
  { rateLimit: RATE_LIMITS.write, key: "settings-keys" },
);
