"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/misc";

interface TemplateSummary {
  key: string;
  name: string;
  description: string;
  executionMode: string;
  agentCount: number;
}

/** Instantiating a template creates real, editable agents — not a linked copy. */
export function TemplateGallery({ onCreated }: { onCreated?: () => void }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!open || templates.length) return;
    api
      .get<{ templates: TemplateSummary[] }>("/api/templates")
      .then((d) => setTemplates(d.templates))
      .catch((err) => toast.error((err as Error).message));
  }, [open, templates.length]);

  async function use(key: string) {
    setBusy(key);
    try {
      const { workflow } = await api.post<{ workflow: { id: string } }>("/api/templates", { templateKey: key });
      toast.success("Template added to your workspace.");
      onCreated?.();
      setOpen(false);
      router.push(`/workflows/${workflow.id}`);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Sparkles /> Start from template
      </Button>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Workflow templates</DialogTitle>
          <DialogDescription>Each template creates its own agents, fully editable afterwards.</DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] space-y-2 overflow-y-auto">
          {templates.map((template) => (
            <button
              key={template.key}
              onClick={() => use(template.key)}
              disabled={busy !== null}
              className="flex w-full items-start justify-between gap-4 rounded-lg border border-border p-4 text-left transition-colors hover:border-primary/50 hover:bg-accent disabled:opacity-60"
            >
              <div>
                <div className="flex items-center gap-2">
                  <p className="font-medium">{template.name}</p>
                  <Badge variant="outline">{template.executionMode.toLowerCase()}</Badge>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{template.description}</p>
              </div>
              <div className="shrink-0 text-xs text-muted-foreground">
                {busy === template.key ? <Spinner /> : `${template.agentCount} agents`}
              </div>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
