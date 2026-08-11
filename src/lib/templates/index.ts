import type { ExecutionMode } from "@/types/workflow";
import type { ToolConfig } from "@/types/tool";
import { AGENT_PROMPT_LIBRARY, RESEARCH_FINDINGS_SCHEMA, CRITIQUE_SCHEMA } from "@/lib/agents/prompts";

/**
 * Built-in workflow templates.
 *
 * A template is a pure data description — agents, nodes, edges — with no ids.
 * The seed script and the "use template" action both materialise it through the
 * same code path, so a template can never drift from what a user-built
 * workflow looks like in the database.
 *
 * Node positions are included because a template that lands as an unreadable
 * pile of overlapping nodes on the canvas is not usable.
 */
export interface TemplateAgent {
  key: string;
  name: string;
  role: string;
  systemPrompt: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  tools?: ToolConfig[];
  outputFormat?: "TEXT" | "MARKDOWN" | "JSON";
  outputSchema?: Record<string, unknown>;
}

export interface TemplateNode {
  key: string;
  agentKey: string;
  label?: string;
  position: { x: number; y: number };
  config?: Record<string, unknown>;
  contextPolicy?: Record<string, unknown>;
}

export interface WorkflowTemplate {
  key: string;
  name: string;
  description: string;
  executionMode: ExecutionMode;
  agents: TemplateAgent[];
  nodes: TemplateNode[];
  edges: Array<{ source: string; target: string; label?: string; condition?: Record<string, unknown> }>;
  entryNodeKey: string;
  finalNodeKey?: string;
}

const prompt = (key: string) => {
  const found = AGENT_PROMPT_LIBRARY.find((p) => p.key === key);
  if (!found) throw new Error(`Unknown prompt template "${key}"`);
  return found;
};

const tool = (name: string, maxCalls = 5): ToolConfig => ({ name, enabled: true, maxCalls });

const FAST = "openai:gpt-4o-mini";
const SMART = "openai:gpt-4o";

/** Row layout helper so templates read as a pipeline, not as coordinates. */
const row = (i: number, y = 160) => ({ x: 80 + i * 280, y });

export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  {
    key: "research-team",
    name: "Research Team",
    description:
      "Researcher → Fact Checker → Analyst → Writer. Sourced research with an independent verification pass before anything is written up.",
    executionMode: "SEQUENTIAL",
    entryNodeKey: "researcher",
    finalNodeKey: "writer",
    agents: [
      {
        key: "researcher",
        name: "Researcher",
        role: prompt("researcher").role,
        systemPrompt: prompt("researcher").systemPrompt,
        model: SMART,
        temperature: 0.2,
        tools: [tool("web_search", 6)],
        outputFormat: "JSON",
        outputSchema: RESEARCH_FINDINGS_SCHEMA as unknown as Record<string, unknown>,
      },
      {
        key: "fact-checker",
        name: "Fact Checker",
        role: prompt("fact_checker").role,
        systemPrompt: prompt("fact_checker").systemPrompt,
        model: SMART,
        temperature: 0,
        tools: [tool("web_search", 6)],
        outputFormat: "MARKDOWN",
      },
      {
        key: "analyst",
        name: "Analyst",
        role: prompt("analyst").role,
        systemPrompt: prompt("analyst").systemPrompt,
        model: SMART,
        temperature: 0.3,
        tools: [tool("calculator", 8)],
        outputFormat: "MARKDOWN",
      },
      {
        key: "writer",
        name: "Writer",
        role: prompt("writer").role,
        systemPrompt: prompt("writer").systemPrompt,
        model: SMART,
        temperature: 0.6,
        maxTokens: 4000,
        outputFormat: "MARKDOWN",
      },
    ],
    nodes: [
      { key: "researcher", agentKey: "researcher", position: row(0) },
      { key: "fact-checker", agentKey: "fact-checker", position: row(1) },
      { key: "analyst", agentKey: "analyst", position: row(2) },
      // The writer needs the verified findings and the analysis, so it reads
      // two upstream nodes rather than only its direct predecessor.
      { key: "writer", agentKey: "writer", position: row(3) },
    ],
    edges: [
      { source: "researcher", target: "fact-checker" },
      { source: "fact-checker", target: "analyst" },
      { source: "analyst", target: "writer" },
    ],
  },

  {
    key: "content-team",
    name: "Content Team",
    description:
      "Topic Researcher → Outline Writer → Copywriter → Editor. An editorial pipeline that separates structure from prose from polish.",
    executionMode: "SEQUENTIAL",
    entryNodeKey: "topic-researcher",
    finalNodeKey: "editor",
    agents: [
      {
        key: "topic-researcher",
        name: "Topic Researcher",
        role: "Find the angles, audience pain points and supporting evidence for the topic.",
        systemPrompt: `${prompt("researcher").systemPrompt}\n\nCONTENT FOCUS\nAlso identify: the target audience and what they already know, the three most interesting angles, common misconceptions worth correcting, and concrete examples or data that would make the piece credible.`,
        model: FAST,
        temperature: 0.4,
        tools: [tool("web_search", 5)],
        outputFormat: "MARKDOWN",
      },
      {
        key: "outline-writer",
        name: "Outline Writer",
        role: "Turn the research into a tight, logically ordered outline.",
        systemPrompt: `You are a content strategist. Produce an outline, not prose.\n\nFor the piece: state the single core message in one sentence, the target audience, and the intended length. Then give a section-by-section outline where each section has a heading, the one point it makes, and the evidence from the research it will use.\n\nRules:\n- Every section must earn its place. If a section does not advance the core message, cut it.\n- Order sections so each one depends only on what came before.\n- Note where the research is thin so the copywriter does not paper over the gap.\n- Do not write the article.`,
        model: FAST,
        temperature: 0.4,
        outputFormat: "MARKDOWN",
      },
      {
        key: "copywriter",
        name: "Copywriter",
        role: "Write the full draft from the outline.",
        systemPrompt: `${prompt("writer").systemPrompt}\n\nCOPYWRITING FOCUS\nFollow the outline's structure exactly. Open with something concrete rather than a definition. Use specific examples over abstraction. Vary sentence length. Never use filler transitions such as "in conclusion" or "it is important to note".`,
        model: SMART,
        temperature: 0.7,
        maxTokens: 4000,
        outputFormat: "MARKDOWN",
      },
      {
        key: "editor",
        name: "Editor",
        role: "Cut, tighten and fact-guard the draft, then deliver the final version.",
        systemPrompt: `You are a senior editor. Deliver the final publishable text — not notes about it.\n\nEdit for: unsupported claims (remove or soften them), redundancy, weak openings, bloated sentences, and inconsistent voice. Preserve the author's structure and every source link.\n\nOutput the complete edited piece, then a short changelog of the substantive edits you made and why. If you removed a claim for lack of support, say so explicitly.`,
        model: SMART,
        temperature: 0.3,
        maxTokens: 4000,
        outputFormat: "MARKDOWN",
      },
    ],
    nodes: [
      { key: "topic-researcher", agentKey: "topic-researcher", position: row(0) },
      { key: "outline-writer", agentKey: "outline-writer", position: row(1) },
      { key: "copywriter", agentKey: "copywriter", position: row(2) },
      { key: "editor", agentKey: "editor", position: row(3) },
    ],
    edges: [
      { source: "topic-researcher", target: "outline-writer" },
      { source: "outline-writer", target: "copywriter" },
      { source: "copywriter", target: "editor" },
    ],
  },

  {
    key: "software-team",
    name: "Software Team",
    description:
      "Product Manager → Software Architect → Developer → Code Reviewer. From a vague feature request to reviewed, runnable code.",
    executionMode: "SEQUENTIAL",
    entryNodeKey: "pm",
    finalNodeKey: "reviewer",
    agents: [
      {
        key: "pm",
        name: "Product Manager",
        role: "Turn the request into unambiguous requirements and acceptance criteria.",
        systemPrompt: `You are a product manager. Convert a request into something an architect can design against.\n\nProduce: the problem statement, the user and their job to be done, in-scope requirements as numbered user stories with acceptance criteria, explicit out-of-scope items, and open questions.\n\nRules:\n- Ambiguity is your output, not your enemy: list every assumption you had to make as an ASSUMPTION rather than silently deciding it.\n- Acceptance criteria must be testable. "Fast" is not testable; "p95 under 300ms" is.\n- Do not propose an implementation.`,
        model: SMART,
        temperature: 0.3,
        outputFormat: "MARKDOWN",
      },
      {
        key: "architect",
        name: "Software Architect",
        role: prompt("software_architect").role,
        systemPrompt: prompt("software_architect").systemPrompt,
        model: SMART,
        temperature: 0.3,
        maxTokens: 4000,
        outputFormat: "MARKDOWN",
      },
      {
        key: "developer",
        name: "Developer",
        role: prompt("developer").role,
        systemPrompt: prompt("developer").systemPrompt,
        model: SMART,
        temperature: 0.2,
        maxTokens: 8000,
        tools: [tool("code_executor", 4)],
        outputFormat: "MARKDOWN",
      },
      {
        key: "reviewer",
        name: "Code Reviewer",
        role: prompt("code_reviewer").role,
        systemPrompt: prompt("code_reviewer").systemPrompt,
        model: SMART,
        temperature: 0.2,
        maxTokens: 4000,
        outputFormat: "JSON",
        outputSchema: CRITIQUE_SCHEMA as unknown as Record<string, unknown>,
      },
    ],
    nodes: [
      { key: "pm", agentKey: "pm", position: row(0) },
      { key: "architect", agentKey: "architect", position: row(1) },
      { key: "developer", agentKey: "developer", position: row(2) },
      { key: "reviewer", agentKey: "reviewer", position: row(3) },
    ],
    edges: [
      { source: "pm", target: "architect" },
      { source: "architect", target: "developer" },
      { source: "developer", target: "reviewer" },
    ],
  },

  {
    key: "business-analyst",
    name: "Business Analyst",
    description:
      "Market Researcher + Financial Analyst run in parallel, then Strategist → Executive Writer. Two independent evidence streams, one recommendation.",
    executionMode: "PARALLEL",
    entryNodeKey: "market",
    finalNodeKey: "exec-writer",
    agents: [
      {
        key: "market",
        name: "Market Researcher",
        role: "Map the market, competitors, sizing and customer demand signals.",
        systemPrompt: `${prompt("researcher").systemPrompt}\n\nMARKET FOCUS\nCover: market size and growth with the source and date of each figure, the main competitors and their positioning, customer segments and their willingness to pay, regulatory or structural constraints, and the timing risk. Distinguish reported figures from your own estimates — label estimates as ASSUMPTION with the method used.`,
        model: SMART,
        temperature: 0.2,
        tools: [tool("web_search", 6)],
        outputFormat: "MARKDOWN",
      },
      {
        key: "financial",
        name: "Financial Analyst",
        role: "Build the numbers: unit economics, scenarios and break-even.",
        systemPrompt: `You are a financial analyst. Build a defensible quantitative picture.\n\nProduce: the key assumptions table (each with its source or basis), unit economics, a three-scenario model (conservative / base / optimistic), break-even conditions, and the two or three variables the outcome is most sensitive to.\n\nRules:\n- Use the calculator tool for every calculation. Never present mentally estimated arithmetic as a result.\n- State every assumption explicitly. An unlabelled assumption in a financial model is a lie with decimal places.\n- If a required input is unknown, model a range and say what would narrow it.`,
        model: SMART,
        temperature: 0.1,
        tools: [tool("calculator", 12)],
        outputFormat: "MARKDOWN",
      },
      {
        key: "strategist",
        name: "Strategist",
        role: "Combine market and financial evidence into options and a recommendation.",
        systemPrompt: `${prompt("analyst").systemPrompt}\n\nSTRATEGY FOCUS\nYou receive an independent market view and an independent financial view. Reconcile them — where they disagree, say which you trust and why. Then give three strategic options with trade-offs, a recommended option, the conditions under which you would reverse the recommendation, and the first 90 days of execution.`,
        model: SMART,
        temperature: 0.4,
        maxTokens: 4000,
        outputFormat: "MARKDOWN",
      },
      {
        key: "exec-writer",
        name: "Executive Writer",
        role: "Write the executive brief a decision-maker can act on in five minutes.",
        systemPrompt: `${prompt("writer").systemPrompt}\n\nEXECUTIVE FORMAT\nStructure: (1) Recommendation in one sentence. (2) Three bullets of why. (3) The numbers that matter. (4) Key risks and what would change the recommendation. (5) Requested decision and next steps. Maximum one page. No preamble, no restating the brief back to the reader.`,
        model: SMART,
        temperature: 0.4,
        outputFormat: "MARKDOWN",
      },
    ],
    nodes: [
      { key: "market", agentKey: "market", position: { x: 80, y: 60 } },
      { key: "financial", agentKey: "financial", position: { x: 80, y: 280 } },
      { key: "strategist", agentKey: "strategist", position: { x: 400, y: 170 } },
      { key: "exec-writer", agentKey: "exec-writer", position: { x: 720, y: 170 } },
    ],
    edges: [
      { source: "market", target: "strategist" },
      { source: "financial", target: "strategist" },
      { source: "strategist", target: "exec-writer" },
    ],
  },

  {
    key: "debate-team",
    name: "Debate Team",
    description:
      "Proponent → Opponent → Judge → Synthesizer. Adversarial review for decisions where the failure mode is premature consensus.",
    executionMode: "DEBATE",
    entryNodeKey: "pro",
    finalNodeKey: "synthesizer",
    agents: [
      {
        key: "pro",
        name: "Proponent",
        role: "Make the strongest honest case FOR the proposition.",
        systemPrompt: `You are the proponent in a structured debate. Argue for the strongest viable position on the task — not a caricature of it.\n\nProduce: your proposal in one sentence, your three strongest arguments with supporting evidence, the assumptions each argument depends on, and the single strongest objection you expect (stated fairly).\n\nRules:\n- Advocate, but never fabricate. A fabricated argument loses the debate at the judging stage.\n- Label FACT, ASSUMPTION and RECOMMENDATION explicitly.\n- Pre-empting the best counter-argument is a strength, not a concession.`,
        model: SMART,
        temperature: 0.6,
        outputFormat: "MARKDOWN",
      },
      {
        key: "contra",
        name: "Opponent",
        role: "Attack the proposal at its weakest real point.",
        systemPrompt: `${prompt("critic").systemPrompt}\n\nDEBATE ROLE\nYou are the opponent. Attack the actual proposal, never a strawman. Prioritise: unsupported evidence, assumptions that fail under realistic conditions, ignored costs and second-order effects, and the scenario in which the proposal does the most damage. Where you have one, offer a concrete alternative. Respond in Markdown prose, not JSON.`,
        model: SMART,
        temperature: 0.6,
        outputFormat: "MARKDOWN",
      },
      {
        key: "judge",
        name: "Judge",
        role: "Score the exchange point by point and name a winner per point.",
        systemPrompt: `You are an impartial judge. You see both sides of a debate.\n\nFor each contested point: state the point, summarise both positions in one line each, and rule which is better supported and why. Then give an overall verdict with your confidence, and list what evidence would change your ruling.\n\nRules:\n- Judge the evidence, not the rhetoric. Confidence is not evidence.\n- Do not split every point down the middle to appear balanced. If one side is right, say so.\n- Where neither side supported a claim, rule it UNRESOLVED rather than picking a winner.`,
        model: SMART,
        temperature: 0.2,
        outputFormat: "MARKDOWN",
      },
      {
        key: "synthesizer",
        name: "Final Synthesizer",
        role: "Deliver the final answer that survived the debate.",
        systemPrompt: `${prompt("writer").systemPrompt}\n\nSYNTHESIS ROLE\nYou see the proposal, the rebuttal and the judge's ruling. Produce the final answer for the user: the recommendation, what the debate settled, what it did not settle (state this plainly — it is the most valuable part), the conditions under which the recommendation changes, and the concrete next step. Do not re-litigate points the judge already ruled on.`,
        model: SMART,
        temperature: 0.4,
        maxTokens: 4000,
        outputFormat: "MARKDOWN",
      },
    ],
    nodes: [
      { key: "pro", agentKey: "pro", position: { x: 80, y: 60 }, config: { debateRole: "PROPONENT" } },
      { key: "contra", agentKey: "contra", position: { x: 80, y: 280 }, config: { debateRole: "OPPONENT" } },
      { key: "judge", agentKey: "judge", position: { x: 400, y: 170 }, config: { debateRole: "JUDGE" } },
      {
        key: "synthesizer",
        agentKey: "synthesizer",
        position: { x: 720, y: 170 },
        config: { debateRole: "SYNTHESIZER" },
      },
    ],
    edges: [
      { source: "pro", target: "contra" },
      { source: "contra", target: "judge" },
      { source: "pro", target: "judge" },
      { source: "judge", target: "synthesizer" },
    ],
  },
];

export function getTemplate(key: string): WorkflowTemplate | undefined {
  return WORKFLOW_TEMPLATES.find((t) => t.key === key);
}
