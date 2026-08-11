"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Copy, Layers, Pencil, Plus, Trash2, Workflow as WorkflowIcon } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api-client";
import { relativeTime } from "@/lib/utils";
import { Badge, statusVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState, Skeleton } from "@/components/ui/misc";
import { RunDialog } from "./run-dialog";
import { TemplateGallery } from "./template-gallery";

interface WorkflowSummary {
  id: string;
  name: string;
  description: string | null;
  executionMode: string;
  agentCount: number;
  runCount: number;
  lastRun: { id: string; status: string; startedAt: string } | null;
  updatedAt: string;
}

export function WorkflowList() {
  const router = useRouter();
  const [workflows, setWorkflows] = useState<WorkflowSummary[] | null>(null);

  const load = async () => {
    try {
      const data = await api.get<{ workflows: WorkflowSummary[] }>("/api/workflows");
      setWorkflows(data.workflows);
    } catch (err) {
      toast.error((err as Error).message);
      setWorkflows([]);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  async function duplicate(id: string) {
    try {
      await api.post(`/api/workflows/${id}/duplicate`);
      toast.success("Workflow duplicated.");
      void load();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function remove(id: string, name: string) {
    if (!confirm(`Delete "${name}"? Runs are kept and the workflow is archived if it has history.`)) return;
    try {
      await api.delete(`/api/workflows/${id}`);
      toast.success("Workflow removed.");
      void load();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function createBlank() {
    try {
      const { workflow } = await api.post<{ workflow: { id: string } }>("/api/workflows", {
        name: "Untitled workflow",
        executionMode: "SEQUENTIAL",
      });
      router.push(`/workflows/${workflow.id}`);
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  if (workflows === null) {
    return (
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-40" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap gap-2">
        <Button onClick={createBlank}>
          <Plus /> Create workflow
        </Button>
        <TemplateGallery onCreated={load} />
      </div>

      {workflows.length === 0 ? (
        <EmptyState
          icon={WorkflowIcon}
          title="No workflows yet"
          description="Start from a template to see a working multi-agent pipeline, or build one from scratch on the canvas."
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {workflows.map((workflow) => (
            <Card key={workflow.id} className="flex flex-col">
              <CardContent className="flex flex-1 flex-col gap-3 p-5">
                <div className="flex items-start justify-between gap-2">
                  <Link href={`/workflows/${workflow.id}`} className="min-w-0">
                    <p className="truncate font-medium hover:text-primary">{workflow.name}</p>
                    <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                      {workflow.description ?? "No description"}
                    </p>
                  </Link>
                  <Badge variant="outline">{workflow.executionMode.toLowerCase()}</Badge>
                </div>

                <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <Layers className="h-3.5 w-3.5" /> {workflow.agentCount} agents
                  </span>
                  <span>{workflow.runCount} runs</span>
                  {workflow.lastRun ? (
                    <Link href={`/runs/${workflow.lastRun.id}`} className="inline-flex items-center gap-1.5">
                      <Badge variant={statusVariant(workflow.lastRun.status)}>
                        {workflow.lastRun.status.toLowerCase()}
                      </Badge>
                      {relativeTime(workflow.lastRun.startedAt)}
                    </Link>
                  ) : (
                    <span>Never run</span>
                  )}
                </div>

                <div className="mt-auto flex items-center gap-1.5 pt-2">
                  <RunDialog workflowId={workflow.id} workflowName={workflow.name} />
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/workflows/${workflow.id}`}>
                      <Pencil /> Edit
                    </Link>
                  </Button>
                  <Button variant="ghost" size="icon" title="Duplicate" onClick={() => duplicate(workflow.id)}>
                    <Copy />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    title="Delete"
                    className="text-destructive"
                    onClick={() => remove(workflow.id, workflow.name)}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
