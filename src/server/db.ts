import { PrismaClient } from "@prisma/client";

/**
 * Single Prisma instance.
 *
 * Next dev mode re-evaluates modules on every hot reload, which would otherwise
 * open a new connection pool per reload and exhaust Postgres within a minute.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
