import type { AgentTool } from "@/types/tool";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

/**
 * Web search via Tavily.
 *
 * Important behaviour: when no API key is configured we return an explicit
 * `unavailable` result rather than throwing or — worse — returning nothing.
 * A silent empty result is the single biggest cause of research agents
 * inventing sources; an explicit "search is unavailable, do not fabricate
 * sources" line keeps the agent honest.
 */
export const webSearchTool: AgentTool<
  { query: string; maxResults?: number },
  { query: string; available: boolean; results: SearchResult[]; note?: string }
> = {
  name: "web_search",
  displayName: "Web Search",
  description:
    "Search the public web for current information. Returns titles, URLs and snippets. Cite the returned URLs; never cite a URL that did not come from this tool.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search query in natural language." },
      maxResults: { type: "integer", minimum: 1, maximum: 10, description: "How many results to return (default 5)." },
    },
    required: ["query"],
    additionalProperties: false,
  },
  async execute(input, ctx) {
    const query = String(input?.query ?? "").trim();
    if (!query) throw new AppError("TOOL_FAILURE", "query is required.");

    const maxResults = Math.min(Number(input?.maxResults ?? ctx.config.maxResults ?? 5), 10);

    if (!env.TAVILY_API_KEY) {
      return {
        query,
        available: false,
        results: [],
        note: "Web search is not configured on this server. Do NOT invent sources or URLs. State explicitly that this claim could not be verified.",
      };
    }

    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      signal: ctx.signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        api_key: env.TAVILY_API_KEY,
        query,
        max_results: maxResults,
        search_depth: "basic",
      }),
    });

    if (res.status === 429) throw new AppError("RATE_LIMITED", "Search provider rate limit reached.");
    if (!res.ok) throw new AppError("TOOL_FAILURE", `Search provider returned ${res.status}.`);

    const data: any = await res.json();
    const results: SearchResult[] = (data.results ?? []).slice(0, maxResults).map((r: any) => ({
      title: r.title ?? "",
      url: r.url ?? "",
      snippet: (r.content ?? "").slice(0, 800),
    }));

    ctx.log(`web_search returned ${results.length} result(s)`, { query });
    return { query, available: true, results };
  },
};
