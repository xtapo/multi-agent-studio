import { AgentBuilder } from "@/components/agents/agent-builder";
import { PageHeader } from "@/components/ui/misc";

export default function NewAgentPage() {
  return (
    <div className="p-6 lg:p-8">
      <PageHeader title="New agent" description="Define the specialist: its role, prompt, model, tools and output contract." />
      <AgentBuilder />
    </div>
  );
}
