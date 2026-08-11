import { NextResponse } from "next/server";
import { createUserAccount } from "@/server/auth";
import { signUpSchema } from "@/lib/validation/schemas";
import { errorResponse, parseBody } from "@/server/api-helpers";
import { RATE_LIMITS, rateLimit } from "@/server/rate-limit";

/** The only unauthenticated write endpoint, so it is rate limited by IP. */
export async function POST(req: Request) {
  try {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    rateLimit(`sign-up:${ip}`, RATE_LIMITS.signUp);

    const body = await parseBody(req, signUpSchema);
    const result = await createUserAccount(body);
    if (!result.ok) return NextResponse.json({ error: { code: "CONFLICT", message: result.error } }, { status: 409 });

    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
