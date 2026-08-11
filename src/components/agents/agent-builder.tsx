"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Save, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Slider, Spinner, Switch } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";

interface ToolInfo {
  name: string;
  displayName: string;
  description: string;
  dangerous?: boolean;
}
interface ModelInfo {
  id: string;
  label: string;
  available: boolean;
}

export interface AgentFormValue {
  id?: string;
  name: string;
  description?: string;
  role: string;
  systemPrompt: string;
  model: string;
  temperature: number;
  maxTokens: number;
  outputFormat: "TEXT" | "MARKDOWN" | "JSON";
  outputSchema?: Record<string, unknown> | null;
  tools: Array<{ name: string; enabled: boolean; maxCalls?: number }>;
  memoryConfig: { shortTerm: boolean; workflowMemory: boolean; userMemory: boolean; maxItems?: number };
  retryConfig: { maxRetries: number };
}

const BLANK: AgentFormValue = {
  name: "",
  role: "",
  systemPrompt: "",
  model: "openai:gpt-4o-mini",
  temperature: 0.3,
  maxTokens: 2048,
  outputFormat: "MARKDOWN",
  tools: [],
  memoryConfig: { shortTerm: true, workflowMemory: false, userMemory: false },
  retryConfig: { maxRetries: 2 },
};

/**
 * Agent Builder.
 *
 * The JSON Schema field is validated in the browser before submit so a typo
 * surfaces immediately instead of as a 400 from the API. The server validates
 * again — client validation is UX, never a security boundary.
 */
export function AgentBuilder({ initial }: { initial?: AgentFormValue }) {
  const router = useRouter();
  const [value, setValue] = useState<AgentFormValue>(initial ?? BLANK);
  const [schemaText, setSchemaText] = useState(
    initial?.outputSchema ? JSON.stringify(initial.outputSchema, null, 2) : "",
  );
  const [tools, setTools] = useState<ToolInfo[]>([]);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api.get<{ tools: ToolInfo[] }>("/api/tools").then((d) => setTools(d.tools)).catch(() => undefined);
    void api.get<{ models: ModelInfo[] }>("/api/models").then((d) => setModels(d.models)).catch(() => undefined);
  }, []);

  const set = <K extends keyof AgentFormValue>(key: K, v: AgentFormValue[K]) =>
    setValue((prev) => ({ ...prev, [key]: v }));

  const toolEnabled = (name: string) => value.tools.some((t) => t.name === name && t.enabled);

  function toggleTool(name: string, on: boolean) {
    setValue((prev) => ({
      ...prev,
      tools: on
        ? [...prev.tools.filter((t) => t.name !== name), { name, enabled: true, maxCalls: 5 }]
        : prev.tools.filter((t) => t.name !== name),
    }));
  }

  async function save() {
    if (!value.name.trim() || !value.role.trim() || !value.systemPrompt.trim()) {
      return toast.error("Name, role and system prompt are required.");
    }

    let outputSchema: Record<string, unknown> | undefined;
    if (value.outputFormat === "JSON") {
      if (!schemaText.trim()) return toast.error("JSON output format needs a schema.");
      try {
        outputSchema = JSON.parse(schemaText) as Record<string, unknown>;
      } catch (err) {
        return toast.error(`Output schema is not valid JSON: ${(err as Error).message}`);
      }
    }

    setBusy(true);
    try {
      const payload = { ...value, outputSchema };
      if (value.id) {
        await api.patch(`/api/agents/${value.id}`, payload);
        toast.success("Agent updated.");
      } else {
        await api.post("/api/agents", payload);
        toast.success("Agent created.");
      }
      router.push("/agents");
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Identity</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Agent name">
                <Input value={value.name} onChange={(e) => set("name", e.target.value)} placeholder="Researcher" />
              </Field>
              <Field label="Description" hint="Internal note, not sent to the model.">
                <Input
                  value={value.description ?? ""}
                  onChange={(e) => set("description", e.target.value)}
                  placeholder="Gathers sourced evidence"
                />
              </Field>
            </div>
            <Field label="Role" hint="One sentence. This IS sent to the model and shown on the canvas.">
              <Input
                value={value.role}
                onChange={(e) => set("role", e.target.value)}
                placeholder="Research information relevant to the user's request."
              />
            </Field>
            <Field
              label="System prompt"
              hint="Define the method, the output contract and how to handle missing information."
            >
              <Textarea
                rows={14}
                className="font-mono text-xs"
                value={value.systemPrompt}
                onChange={(e) => set("systemPrompt", e.target.value)}
                placeholder={"You are a professional research agent.\nAnalyze the task carefully.\nCollect reliable evidence.\nReturn structured findings to the next agent."}
              />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Tools</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Only enabled tools are offered to the model, and the runtime rejects any call to a tool that is not on
              this list.
            </p>
            {tools.map((tool) => (
              <div key={tool.name} className="flex items-start justify-between gap-4 rounded-lg border border-border p-3">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium">{tool.displayName}</p>
                    {tool.dangerous ? <Badge variant="warning">elevated</Badge> : null}
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">{tool.description}</p>
                </div>
                <Switch checked={toolEnabled(tool.name)} onCheckedChange={(on) => toggleTool(tool.name, on)} />
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Model</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field label="Model">
              <Input list="models-list" value={value.model} onChange={(e) => set("model", e.target.value)} placeholder="Type or select a model..." />
              <datalist id="models-list">
                {models.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.label}
                    {model.available ? "" : " (no API key)"}
                  </option>
                ))}
              </datalist>
            </Field>

            <Field label={`Temperature — ${value.temperature.toFixed(2)}`} hint="Low for routing and extraction, high for writing.">
              <Slider
                value={[value.temperature]}
                min={0}
                max={1}
                step={0.05}
                onValueChange={([v]) => set("temperature", v)}
              />
            </Field>

            <Field label="Max tokens">
              <Input
                type="number"
                min={256}
                max={16000}
                value={value.maxTokens}
                onChange={(e) => set("maxTokens", Number(e.target.value))}
              />
            </Field>

            <Field label="Retries on failure" hint="Exponential backoff with jitter.">
              <Input
                type="number"
                min={0}
                max={5}
                value={value.retryConfig.maxRetries}
                onChange={(e) => set("retryConfig", { maxRetries: Number(e.target.value) })}
              />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Output</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field label="Format">
              <Select
                value={value.outputFormat}
                onChange={(e) => set("outputFormat", e.target.value as AgentFormValue["outputFormat"])}
              >
                <option value="MARKDOWN">Markdown</option>
                <option value="TEXT">Plain text</option>
                <option value="JSON">Structured JSON</option>
              </Select>
            </Field>

            {value.outputFormat === "JSON" ? (
              <Field label="Output JSON Schema" hint="Validated after every call; invalid output triggers a repair round.">
                <Textarea
                  rows={10}
                  className="font-mono text-xs"
                  value={schemaText}
                  onChange={(e) => setSchemaText(e.target.value)}
                  placeholder='{\n  "type": "object",\n  "properties": { "summary": { "type": "string" } },\n  "required": ["summary"]\n}'
                />
              </Field>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Memory</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {[
              { key: "shortTerm" as const, label: "Short-term", hint: "Context within this run." },
              { key: "workflowMemory" as const, label: "Workflow memory", hint: "Conclusions from earlier runs." },
              { key: "userMemory" as const, label: "User memory", hint: "Your stated preferences." },
            ].map((row) => (
              <div key={row.key} className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">{row.label}</p>
                  <p className="text-xs text-muted-foreground">{row.hint}</p>
                </div>
                <Switch
                  checked={value.memoryConfig[row.key]}
                  onCheckedChange={(on) => set("memoryConfig", { ...value.memoryConfig, [row.key]: on })}
                />
              </div>
            ))}
          </CardContent>
        </Card>

        <div className="flex gap-2">
          <Button className="flex-1" onClick={save} disabled={busy}>
            {busy ? <Spinner /> : <Save />} {value.id ? "Save agent" : "Create agent"}
          </Button>
          <Button variant="outline" onClick={() => router.back()}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}

export { BLANK as BLANK_AGENT };
export { Wand2 as AgentIcon };
