"use client";

import { useRouter } from "next/navigation";
import { Copy, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api-client";
import { Button } from "@/components/ui/button";

export function DeleteAgentButton({ agentId, agentName }: { agentId: string; agentName: string }) {
  const router = useRouter();

  async function duplicate() {
    try {
      const { agent } = await api.post<{ agent: { id: string } }>(`/api/agents/${agentId}/duplicate`);
      toast.success("Agent duplicated.");
      router.push(`/agents/${agent.id}`);
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function remove() {
    if (!confirm(`Delete "${agentName}"? Agents referenced by past runs are archived instead.`)) return;
    try {
      await api.delete(`/api/agents/${agentId}`);
      toast.success("Agent removed.");
      router.push("/agents");
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  return (
    <div className="flex gap-2">
      <Button variant="outline" onClick={duplicate}>
        <Copy /> Duplicate
      </Button>
      <Button variant="outline" className="text-destructive" onClick={remove}>
        <Trash2 /> Delete
      </Button>
    </div>
  );
}
