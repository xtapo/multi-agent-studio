import vm from "node:vm";
import type { AgentTool } from "@/types/tool";
import { AppError } from "@/lib/errors";

/**
 * Execute a short JavaScript snippet for data transformation.
 *
 * Threat model and honest limitations:
 *   - The snippet runs in a fresh `node:vm` context with an empty sandbox: no
 *     require, no process, no fetch, no fs, no timers. It can compute, not
 *     reach out.
 *   - `node:vm` is NOT a security boundary against a determined attacker
 *     (prototype-based escapes exist). It is sufficient for "the model wrote a
 *     bad loop", not for "the model is hostile".
 *   - Therefore the tool is marked dangerous and is OFF by default; enabling it
 *     for an agent is an explicit operator decision. For untrusted multi-tenant
 *     use, replace this implementation with a Firecracker/gVisor worker — the
 *     AgentTool interface stays identical.
 */
export const codeExecutorTool: AgentTool<
  { code: string; input?: unknown },
  { result: unknown; logs: string[] }
> = {
  name: "code_executor",
  displayName: "Code Executor",
  description:
    "Run a self-contained JavaScript snippet for calculation or data transformation and return its value. The snippet has no network, filesystem or module access. Use `return` to produce a result; the variable `input` holds the value you pass in.",
  dangerous: true,
  inputSchema: {
    type: "object",
    properties: {
      code: { type: "string", description: "JavaScript body. Use `return` for the result." },
      input: { description: "Optional JSON value exposed to the snippet as `input`." },
    },
    required: ["code"],
    additionalProperties: false,
  },
  async execute(rawInput, ctx) {
    const code = String(rawInput?.code ?? "");
    if (!code.trim()) throw new AppError("TOOL_FAILURE", "code is required.");
    if (code.length > 20_000) throw new AppError("TOOL_FAILURE", "Snippet is too long (max 20k characters).");

    const logs: string[] = [];
    const sandbox: Record<string, unknown> = {
      input: rawInput?.input ?? null,
      console: {
        log: (...args: unknown[]) => {
          if (logs.length < 100) logs.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
        },
      },
      Math,
      JSON,
      Date,
      Number,
      String,
      Boolean,
      Array,
      Object,
    };

    const context = vm.createContext(sandbox, { codeGeneration: { strings: false, wasm: false } });

    try {
      const script = new vm.Script(`(function(){"use strict";\n${code}\n})()`, { filename: "agent-snippet.js" });
      const result = script.runInContext(context, { timeout: 3000, breakOnSigint: true });
      ctx.log("code_executor finished", { logLines: logs.length });
      // Force serializability so a returned function/symbol cannot poison the
      // event log or the next agent's prompt.
      return { result: JSON.parse(JSON.stringify(result ?? null)), logs };
    } catch (err) {
      throw new AppError("TOOL_FAILURE", `Snippet failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
};
