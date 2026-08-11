import { NextResponse } from "next/server";
import { ZodError, type ZodSchema } from "zod";
import { auth, resolveWorkspaceId } from "@/server/auth";
import { AppError, toAppError } from "@/lib/errors";
import { rateLimit, type RateLimitRule } from "@/server/rate-limit";

/**
 * Shared route-handler plumbing.
 *
 * Every API route is wrapped so that authentication, workspace scoping, input
 * validation, rate limiting and error shaping happen in exactly one place.
 * A route handler therefore only contains business intent — if a route ever
 * needs to think about auth again, something has gone wrong.
 */
export interface RouteSession {
  userId: string;
  workspaceId: string;
}

export async function requireSession(): Promise<RouteSession> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) throw new AppError("UNAUTHORIZED", "You must be signed in.");
  const workspaceId = session.workspaceId ?? (await resolveWorkspaceId(userId));
  return { userId, workspaceId };
}

export function ok<T>(data: T, status = 200) {
  return NextResponse.json(data, { status });
}

export function errorResponse(err: unknown) {
  if (err instanceof ZodError) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION",
          message: "Request body is invalid.",
          details: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        },
      },
      { status: 400 },
    );
  }

  const appErr = toAppError(err);
  // Unexpected failures are logged server-side and generalised to the client so
  // internals (stack traces, SQL, provider payloads) never leak.
  if (appErr.code === "INTERNAL") console.error("[api] unhandled error", err);
  return NextResponse.json({ error: appErr.toJSON() }, { status: appErr.status });
}

type Handler<T> = (ctx: RouteSession & { req: Request }) => Promise<T>;

/** Authenticated route wrapper. */
export function route<T>(handler: Handler<T>, options: { rateLimit?: RateLimitRule; key?: string } = {}) {
  return async (req: Request) => {
    try {
      const session = await requireSession();
      if (options.rateLimit) rateLimit(`${options.key ?? "route"}:${session.userId}`, options.rateLimit);
      return ok(await handler({ ...session, req }));
    } catch (err) {
      return errorResponse(err);
    }
  };
}

export async function parseBody<T>(req: Request, schema: ZodSchema<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new AppError("VALIDATION", "Request body must be valid JSON.");
  }
  return schema.parse(raw);
}

export function notFound(what: string): never {
  throw new AppError("NOT_FOUND", `${what} not found.`);
}
