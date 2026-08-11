import { PageHeader } from "@/components/ui/misc";
import { WorkflowList } from "@/components/workflows/workflow-list";

export default function WorkflowsPage() {
  return (
    <div className="p-6 lg:p-8">
      <PageHeader title="Workflows" description="Graphs of agents that run together to complete a task." />
      <WorkflowList />
    </div>
  );
}
