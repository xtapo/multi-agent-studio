"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Play } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Spinner } from "@/components/ui/misc";
import { api } from "@/lib/api-client";

/**
 * Run launcher. Collects the task and optional budget overrides, then navigates
 * straight to the live run view — the POST returns a runId immediately, so
 * there is nothing to wait for here.
 */
export function RunDialog({
  workflowId,
  workflowName,
  trigger,
}: {
  workflowId: string;
  workflowName: string;
  trigger?: React.ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [maxSteps, setMaxSteps] = useState("");
  const [maxCost, setMaxCost] = useState("");
  const [busy, setBusy] = useState(false);

  async function start() {
    if (!input.trim()) return toast.error("Describe the task first.");
    setBusy(true);
    try {
      const budget: Record<string, number> = {};
      if (maxSteps) budget.maxSteps = Number(maxSteps);
      if (maxCost) budget.maxCostUsd = Number(maxCost);

      const { runId } = await api.post<{ runId: string }>(`/api/workflows/${workflowId}/run`, {
        input: input.trim(),
        ...(Object.keys(budget).length ? { budget } : {}),
      });
      setOpen(false);
      router.push(`/runs/${runId}`);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <span onClick={() => setOpen(true)}>
        {trigger ?? (
          <Button size="sm">
            <Play /> Run
          </Button>
        )}
      </span>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Run {workflowName}</DialogTitle>
          <DialogDescription>The task is handed to the entry agent and flows through the graph.</DialogDescription>
        </DialogHeader>

        <Field label="Task">
          <Textarea
            rows={5}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="e.g. Compare the top 3 open-source vector databases for a 50M-embedding workload and recommend one."
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Max steps" hint="Leave blank for the default.">
            <Input type="number" min={1} max={50} value={maxSteps} onChange={(e) => setMaxSteps(e.target.value)} />
          </Field>
          <Field label="Cost limit (USD)" hint="Run stops when exceeded.">
            <Input type="number" min={0} step="0.1" value={maxCost} onChange={(e) => setMaxCost(e.target.value)} />
          </Field>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={start} disabled={busy}>
            {busy ? <Spinner /> : <Play />} Start run
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
