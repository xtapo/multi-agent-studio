import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    workspaceId: string | null;
    user: { id: string } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    workspaceId?: string;
  }
}
