import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { AgentTool } from "@/types/tool";
import { AppError } from "@/lib/errors";

/**
 * Read files from a single sandbox directory (./sandbox by default).
 *
 * The path is resolved and then checked to still be inside the sandbox root,
 * which is the only reliable way to stop `../../.env` traversal (string
 * prefix checks on the raw input are trivially bypassed with encoded dots).
 */
const SANDBOX_ROOT = path.resolve(process.cwd(), "sandbox");
const MAX_BYTES = 200_000;

function resolveInsideSandbox(relative: string): string {
  const resolved = path.resolve(SANDBOX_ROOT, relative);
  const rel = path.relative(SANDBOX_ROOT, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new AppError("TOOL_NOT_PERMITTED", "Path escapes the sandbox directory.");
  }
  return resolved;
}

export const fileReaderTool: AgentTool<
  { path?: string; list?: boolean },
  { path: string; kind: "file" | "directory"; content?: string; entries?: string[]; truncated?: boolean }
> = {
  name: "file_reader",
  displayName: "File Reader",
  description:
    "Read a UTF-8 text file, or list files, inside the server sandbox directory. Pass list: true to enumerate a directory. Paths are relative to the sandbox root.",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: 'Relative path inside the sandbox, e.g. "notes/brief.md". Default ".".' },
      list: { type: "boolean", description: "List directory entries instead of reading a file." },
    },
    additionalProperties: false,
  },
  async execute(input, ctx) {
    const relative = String(input?.path ?? ".");
    const target = resolveInsideSandbox(relative);

    let info;
    try {
      info = await stat(target);
    } catch {
      throw new AppError("TOOL_FAILURE", `No such path in sandbox: "${relative}". Use list: true to see what exists.`);
    }

    if (info.isDirectory() || input?.list) {
      const entries = await readdir(target);
      ctx.log(`file_reader listed ${entries.length} entries`, { path: relative });
      return { path: relative, kind: "directory", entries };
    }

    const raw = await readFile(target, "utf8");
    const truncated = raw.length > MAX_BYTES;
    return { path: relative, kind: "file", content: truncated ? raw.slice(0, MAX_BYTES) : raw, truncated };
  },
};
