import { Info } from "lucide-react";
import { auth } from "@/server/auth";
import { getProviderRegistry } from "@/lib/providers/registry";
import { defaultBudgetFromEnv } from "@/lib/env";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";

/**
 * Settings is intentionally read-only for provider keys.
 *
 * Keys live in server-side env vars and are never serialised to the client —
 * this page only reports whether a provider is configured.
 */
export default async function SettingsPage() {
  const session = await auth();
  const registry = getProviderRegistry();

  const providers = registry.list().map((provider) => ({
    id: provider.id,
    displayName: provider.displayName,
    configured: provider.isConfigured(),
    models: registry.allModels().filter((model) => model.provider === provider.id).length,
  }));

  const guardrails = [
    { label: "Max steps", value: defaultBudgetFromEnv.maxSteps },
    { label: "Max tool calls", value: defaultBudgetFromEnv.maxToolCalls },
    { label: "Max tokens", value: defaultBudgetFromEnv.maxTokens.toLocaleString("en-US") },
    { label: "Cost limit (USD)", value: defaultBudgetFromEnv.maxCostUsd },
    { label: "Run timeout", value: `${Math.round(defaultBudgetFromEnv.timeoutMs / 1000)}s` },
  ];

  return (
    <div className="p-6 lg:p-8">
      <PageHeader title="Settings" description="Account, providers and the default guardrails applied to every run." />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Account</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 p-5 pt-0 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Name</span>
              <span>{session?.user?.name ?? "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Email</span>
              <span>{session?.user?.email ?? "—"}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Model providers</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 p-5 pt-0">
            {providers.map((provider) => (
              <div key={provider.id} className="flex items-center justify-between gap-3 text-sm">
                <div>
                  <p>{provider.displayName}</p>
                  <p className="text-xs text-muted-foreground">
                    {provider.models} model{provider.models === 1 ? "" : "s"} in catalogue
                  </p>
                </div>
                <Badge variant={provider.configured ? "success" : "outline"}>
                  {provider.configured ? "configured" : "not configured"}
                </Badge>
              </div>
            ))}
            <p className="flex items-start gap-2 pt-2 text-xs text-muted-foreground">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Keys are read from server environment variables and are never sent to the browser. To use a local or
              self-hosted model, set <code className="font-mono">CUSTOM_LLM_BASE_URL</code> and{" "}
              <code className="font-mono">CUSTOM_LLM_MODELS</code>.
            </p>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Default run guardrails</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 p-5 pt-0 sm:grid-cols-3">
            {guardrails.map((row) => (
              <div key={row.label} className="rounded-lg border border-border p-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">{row.label}</p>
                <p className="mt-0.5 font-semibold tabular-nums">{row.value}</p>
              </div>
            ))}
            <p className="col-span-full text-xs text-muted-foreground">
              Any run can tighten these from the Run dialog, but never loosen them beyond the server limits.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
