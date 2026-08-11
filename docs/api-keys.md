# Bring your own API key

A user can store a personal OpenAI or Anthropic key in **Settings → Your API
keys**. Their runs then bill that key instead of the deployment's.

## How it is stored

`src/lib/crypto.ts` encrypts the key with AES-256-GCM using `ENCRYPTION_KEY`
from the environment. Only the ciphertext, IV, auth tag and the last four
characters reach the database (`ProviderApiKey`).

There is **no endpoint that returns a stored key**, not even to its owner.
`GET /api/settings/keys` returns `{ provider, label, last4 }`. A key can be
replaced or deleted, never read back. The form input is `type="password"` and
the value is dropped from React state the moment the request succeeds.

Trade-off: a single symmetric key in the environment rather than KMS envelope
encryption. That is the right level for a self-hosted studio, and the
`encrypt -> { ciphertext, iv, authTag }` shape means swapping in KMS later
touches exactly one file.

## How it reaches the model call

The provider layer sits five calls below the orchestrator:

```
runner → engine → strategy → agent executor → provider registry
```

Threading a credential argument through all of those would change every
strategy signature for something none of them care about. Instead
`src/lib/providers/context.ts` uses `AsyncLocalStorage`: the runner decrypts the
user's keys once and wraps the whole run, and `getProviderRegistry()` builds a
registry bound to those keys for anything executing inside that context.

Properties this gives us:

- concurrent runs in the same worker never see each other's credentials;
- the domain layer stays free of auth concerns;
- a user without a stored key transparently falls back to the server key.

Registries built from user keys are cached (bounded at 50) so a run does not
construct a new SDK client on every model call.

## Failure modes

| Situation | Behaviour |
| --- | --- |
| No personal key | Server env key is used |
| Key fails to decrypt (`ENCRYPTION_KEY` rotated) | Logged, that provider falls back to the server key; the run continues |
| `ENCRYPTION_KEY` missing entirely | Saving a key fails with a clear error; runs are unaffected |
| Key is invalid at the vendor | Normal `PROVIDER_ERROR` on the failing step, visible in the run timeline |

## Not overridable per user

The custom / local provider (`CUSTOM_LLM_BASE_URL`) is a deployment concern, not
a personal secret — pointing individual users at arbitrary endpoints would be an
SSRF surface. It stays environment-only. See [custom-models.md](custom-models.md).
