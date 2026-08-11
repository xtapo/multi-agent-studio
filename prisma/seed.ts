/**
 * Seed script.
 *
 * Creates a demo user + workspace, registers the built-in tool catalogue and
 * instantiates all five workflow templates so a fresh clone has something to
 * run immediately. Safe to re-run: everything is upserted or skipped.
 *
 *   npm run db:seed
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { WORKFLOW_TEMPLATES } from "../src/lib/templates";
import { getToolRegistry } from "../src/lib/tools/registry";

const prisma = new PrismaClient();

const DEMO_EMAIL = process.env.SEED_EMAIL ?? "demo@multiagent.studio";
const DEMO_PASSWORD = process.env.SEED_PASSWORD ?? "demo12345";

async function main() {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);

  const user = await prisma.user.upsert({
    where: { email: DEMO_EMAIL },
    update: {},
    create: { email: DEMO_EMAIL, name: "Demo User", passwordHash },
  });

  const workspace = await prisma.workspace.upsert({
    where: { slug: "demo-workspace" },
    update: {},
    create: {
      name: "Demo Workspace",
      slug: "demo-workspace",
      members: { create: { userId: user.id, role: "OWNER" } },
    },
  });

  // Tool catalogue — mirrors the in-code registry so the UI can toggle tools
  // per workspace later without a migration.
  for (const tool of getToolRegistry().describe()) {
    await prisma.toolDefinition.upsert({
      where: { workspaceId_name: { workspaceId: workspace.id, name: tool.name } },
      update: { displayName: tool.displayName, description: tool.description, inputSchema: tool.inputSchema },
      create: {
        workspaceId: workspace.id,
        name: tool.name,
        displayName: tool.displayName,
        description: tool.description,
        inputSchema: tool.inputSchema,
        dangerous: Boolean(tool.dangerous),
        enabled: true,
      },
    });
  }

  // Templates — each one creates its own agents, then the graph.
  for (const template of Object.values(WORKFLOW_TEMPLATES)) {
    const existing = await prisma.workflow.findFirst({
      where: { workspaceId: workspace.id, name: template.name },
    });
    if (existing) {
      console.log(`✓ template already present: ${template.name}`);
      continue;
    }

    const agentIdByKey = new Map<string, string>();
    for (const agent of template.agents) {
      const created = await prisma.agent.create({
        data: {
          workspaceId: workspace.id,
          name: agent.name,
          description: agent.description,
          role: agent.role,
          systemPrompt: agent.systemPrompt,
          model: agent.model,
          temperature: agent.temperature,
          maxTokens: agent.maxTokens,
          outputFormat: agent.outputFormat,
          outputSchema: agent.outputSchema ?? undefined,
          tools: agent.tools,
          memoryConfig: agent.memoryConfig ?? undefined,
        },
      });
      agentIdByKey.set(agent.key, created.id);
    }

    const workflow = await prisma.workflow.create({
      data: {
        workspaceId: workspace.id,
        name: template.name,
        description: template.description,
        executionMode: template.executionMode,
      },
    });

    const nodeIdByKey = new Map<string, string>();
    for (const node of template.nodes) {
      const created = await prisma.workflowNode.create({
        data: {
          workflowId: workflow.id,
          agentId: agentIdByKey.get(node.agentKey) ?? null,
          kind: "AGENT",
          label: node.label,
          positionX: node.position.x,
          positionY: node.position.y,
          contextPolicy: node.contextPolicy ?? undefined,
          config: node.config ?? undefined,
        },
      });
      nodeIdByKey.set(node.key, created.id);
    }

    for (const edge of template.edges) {
      await prisma.workflowEdge.create({
        data: {
          workflowId: workflow.id,
          sourceNodeId: nodeIdByKey.get(edge.source)!,
          targetNodeId: nodeIdByKey.get(edge.target)!,
          label: edge.label,
        },
      });
    }

    await prisma.workflow.update({
      where: { id: workflow.id },
      data: {
        entryNodeId: nodeIdByKey.get(template.entryKey) ?? null,
        finalNodeId: template.finalKey ? (nodeIdByKey.get(template.finalKey) ?? null) : null,
      },
    });

    console.log(`+ seeded template: ${template.name}`);
  }

  console.log(`\nDone. Sign in with ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
