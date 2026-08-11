import { lookup } from "node:dns/promises";
import type { AgentTool } from "@/types/tool";
import { httpToolAllowedHosts } from "@/lib/env";
import { AppError } from "@/lib/errors";

/**
 * Outbound HTTP with an SSRF guard.
 *
 * The URL comes from a model, so it must be treated as attacker-controlled.
 * Three layers of defence:
 *   1. scheme allowlist (http/https only — no file:, gopher:, data:);
 *   2. optional host allowlist from HTTP_TOOL_ALLOWED_HOSTS;
 *   3. DNS resolution + private/loopback/link-local IP rejection, which is what
 *      actually stops `http://169.254.169.254/` style metadata exfiltration.
 * Redirects are disabled because following one bypasses checks 2 and 3.
 */
const PRIVATE_V4 = [
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2[0-9]|3[01])\./,
  /^169\.254\./,
  /^0\./,
  /^100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\./,
];

function isPrivateAddress(address: string, family: number): boolean {
  if (family === 4) return PRIVATE_V4.some((re) => re.test(address));
  const a = address.toLowerCase();
  return a === "::1" || a.startsWith("fc") || a.startsWith("fd") || a.startsWith("fe80") || a === "::";
}

async function assertSafeUrl(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new AppError("TOOL_FAILURE", `"${rawUrl}" is not a valid absolute URL.`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new AppError("TOOL_NOT_PERMITTED", `Protocol ${url.protocol} is not allowed.`);
  }

  const host = url.hostname.toLowerCase();

  if (httpToolAllowedHosts.length > 0 && !httpToolAllowedHosts.includes(host)) {
    throw new AppError(
      "TOOL_NOT_PERMITTED",
      `Host "${host}" is not in HTTP_TOOL_ALLOWED_HOSTS. Ask the operator to allowlist it.`,
    );
  }

  try {
    const addresses = await lookup(host, { all: true });
    for (const { address, family } of addresses) {
      if (isPrivateAddress(address, family)) {
        throw new AppError("TOOL_NOT_PERMITTED", `Host "${host}" resolves to a private address and is blocked.`);
      }
    }
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError("TOOL_FAILURE", `Could not resolve host "${host}".`);
  }

  return url;
}

export const httpRequestTool: AgentTool<
  { url: string; method?: string; headers?: Record<string, string>; body?: string },
  { status: number; contentType: string | null; body: string; truncated: boolean }
> = {
  name: "http_request",
  displayName: "HTTP Request",
  description:
    "Perform an HTTP request to a public API and return the response body (truncated to 20k characters). Only http/https public hosts are reachable.",
  dangerous: true,
  inputSchema: {
    type: "object",
    properties: {
      url: { type: "string", description: "Absolute URL, http or https only." },
      method: { type: "string", enum: ["GET", "POST", "PUT", "PATCH", "DELETE"], description: "Default GET." },
      headers: { type: "object", description: "Optional request headers." },
      body: { type: "string", description: "Optional request body, already serialized." },
    },
    required: ["url"],
    additionalProperties: false,
  },
  async execute(input, ctx) {
    const url = await assertSafeUrl(String(input?.url ?? ""));
    const method = (input?.method ?? "GET").toUpperCase();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    ctx.signal?.addEventListener("abort", () => controller.abort(), { once: true });

    try {
      const res = await fetch(url, {
        method,
        headers: { "user-agent": "multi-agent-studio/0.1", ...(input?.headers ?? {}) },
        body: method === "GET" || method === "DELETE" ? undefined : input?.body,
        redirect: "manual",
        signal: controller.signal,
      });

      const raw = await res.text();
      const truncated = raw.length > 20_000;
      ctx.log(`http_request ${method} ${url.host} -> ${res.status}`);
      return {
        status: res.status,
        contentType: res.headers.get("content-type"),
        body: truncated ? raw.slice(0, 20_000) : raw,
        truncated,
      };
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new AppError("TOOL_FAILURE", `HTTP request failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      clearTimeout(timeout);
    }
  },
};
