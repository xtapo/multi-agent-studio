import { notFound } from "next/navigation";
import { auth, resolveWorkspaceId } from "@/server/auth";
import { getRun } from "@/server/services/run-service";
import { RunViewer, type RunDetail } from "@/components/runs/run-viewer";

export default async function RunPage({ params }: { params: { id: string } }) {
  const session = await auth();
  const workspaceId = session!.workspaceId ?? (await resolveWorkspaceId(session!.user.id));
  const run = await getRun(workspaceId, params.id).catch(() => null);
  if (!run) notFound();

  return (
    <div className="p-6 lg:p-8">
      <RunViewer initial={run as unknown as RunDetail} />
    </div>
  );
}
