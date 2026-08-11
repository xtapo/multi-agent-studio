"use client";

import { useEffect, useState } from "react";
import { KeyRound, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/input";

interface ProviderKey {
  id: string;
  provider: string;
  label: string | null;
  last4: string;
}

const PROVIDER_LABELS: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
};

/**
 * Bring-your-own-key form.
 *
 * The input is write-only by design: a saved key is shown as ••••last4 and can
 * be replaced or removed, never revealed. Nothing here ever holds a plaintext
 * key after the request completes.
 */
export function ApiKeysCard() {
  const [keys, setKeys] = useState<ProviderKey[]>([]);
  const [providers, setProviders] = useState<string[]>([]);
  const [provider, setProvider] = useState("openai");
  const [apiKey, setApiKey] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  async function load() {
    try {
      const data = await api.get<{ providers: string[]; keys: ProviderKey[] }>("/api/settings/keys");
      setProviders(data.providers);
      setKeys(data.keys);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not load your keys.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      await api.post("/api/settings/keys", { provider, apiKey });
      setApiKey("");
      toast.success(`${PROVIDER_LABELS[provider] ?? provider} key saved.`);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the key.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(target: string) {
    try {
      await api.delete(`/api/settings/keys?provider=${encodeURIComponent(target)}`);
      toast.success("Key removed.");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not remove the key.");
    }
  }

  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <KeyRound className="h-4 w-4" />
          Your API keys
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 p-5 pt-0">
        <p className="text-xs text-muted-foreground">
          Optional. A key you add here is encrypted with AES-256-GCM and used for your runs instead of the server key.
          It is never sent back to the browser and never appears in logs.
        </p>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : keys.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground">
            No personal keys yet — runs use the server configuration.
          </p>
        ) : (
          <ul className="space-y-2">
            {keys.map((key) => (
              <li
                key={key.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-border p-3 text-sm"
              >
                <div>
                  <p className="font-medium">{PROVIDER_LABELS[key.provider] ?? key.provider}</p>
                  <p className="font-mono text-xs text-muted-foreground">••••••••{key.last4}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="success">active</Badge>
                  <Button variant="ghost" size="sm" onClick={() => void remove(key.provider)} aria-label="Remove key">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <form onSubmit={save} className="grid gap-3 sm:grid-cols-[160px_1fr_auto] sm:items-end">
          <Field label="Provider">
            <Select value={provider} onChange={(e) => setProvider(e.target.value)}>
              {(providers.length ? providers : ["openai", "anthropic"]).map((id) => (
                <option key={id} value={id}>
                  {PROVIDER_LABELS[id] ?? id}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="API key" hint="Stored encrypted. Saving again replaces the existing key.">
            <Input
              type="password"
              autoComplete="off"
              placeholder="sk-…"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
          </Field>
          <Button type="submit" disabled={saving || apiKey.trim().length < 20}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Save key
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
