import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import bcrypt from "bcryptjs";
import { prisma } from "@/server/db";
import { slugify } from "@/lib/utils";
import { signUpSchema } from "@/lib/validation/schemas";

/**
 * Authentication (Auth.js v5).
 *
 * Credentials + JWT sessions. Trade-off: JWT is required for the credentials
 * provider and avoids a session lookup per request, at the cost of not being
 * able to revoke a session instantly. For a self-hosted studio that is the
 * right trade; adding an OAuth provider later is a two-line change because the
 * Prisma adapter and the account tables are already in place.
 *
 * Every user gets a personal workspace on sign-up. All data access is scoped by
 * workspace membership — no query in this codebase reads a resource by id
 * alone, always by id + workspaceId.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: { strategy: "jwt" },
  pages: { signIn: "/sign-in" },
  trustHost: true,
  providers: [
    Credentials({
      name: "Email and password",
      credentials: { email: {}, password: {} },
      async authorize(raw) {
        const parsed = signUpSchema.pick({ email: true, password: true }).safeParse(raw);
        if (!parsed.success) return null;

        const user = await prisma.user.findUnique({ where: { email: parsed.data.email.toLowerCase() } });
        if (!user?.passwordHash) return null;

        const ok = await bcrypt.compare(parsed.data.password, user.passwordHash);
        if (!ok) return null;

        return { id: user.id, email: user.email, name: user.name, image: user.image };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user?.id) token.sub = user.id;
      if (token.sub && !token.workspaceId) {
        token.workspaceId = await resolveWorkspaceId(token.sub);
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.sub) session.user.id = token.sub;
      session.workspaceId = (token.workspaceId as string) ?? null;
      return session;
    },
  },
});

/** Finds the user's workspace, creating a personal one on first sign-in. */
export async function resolveWorkspaceId(userId: string): Promise<string> {
  const membership = await prisma.workspaceMember.findFirst({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: { workspaceId: true },
  });
  if (membership) return membership.workspaceId;

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true } });
  const label = user?.name || user?.email?.split("@")[0] || "workspace";

  const workspace = await prisma.workspace.create({
    data: {
      name: `${label}'s workspace`,
      slug: `${slugify(label)}-${Math.random().toString(36).slice(2, 8)}`,
      members: { create: { userId, role: "OWNER" } },
    },
  });
  return workspace.id;
}

export async function createUserAccount(input: { name: string; email: string; password: string }) {
  const email = input.email.toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return { ok: false as const, error: "An account with this email already exists." };

  const user = await prisma.user.create({
    data: { name: input.name, email, passwordHash: await bcrypt.hash(input.password, 12) },
  });
  await resolveWorkspaceId(user.id);
  return { ok: true as const, userId: user.id };
}
