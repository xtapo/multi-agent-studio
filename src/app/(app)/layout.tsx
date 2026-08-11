import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { AppSidebar } from "@/components/app-sidebar";

/**
 * Authenticated shell. Every page under (app) is guarded here rather than in
 * each page, so a new page cannot accidentally ship unauthenticated.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/sign-in");

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <AppSidebar userName={session.user.name ?? session.user.email} />
      <main className="min-w-0 flex-1 overflow-x-hidden">{children}</main>
    </div>
  );
}
