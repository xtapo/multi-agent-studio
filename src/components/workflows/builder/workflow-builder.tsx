"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { AlertTriangle, CheckCircle2, Save, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Spinner } from "@/components/ui/misc";
import { RunDialog } from "../run-dialog";
import { AgentLibrary } from "./agent-library";
import { AgentNode } from "./agent-node";
import { NodeInspector } from "./node-inspector";
import {
  DEFAULT_CONTEXT_POLICY,
  EXECUTION_MODES,
  type AgentNodeData,
  type AgentSummary,
  type BuilderEdge,
  type BuilderNode,
} from "./types";

export interface WorkflowBuilderProps {
  workflow: {
    id: string;
    name: string;
    description: string | null;
    executionMode: string;
    entryNodeId: string | null;
    finalNodeId: string | null;
    nodes: Array<{
      id: string;
      label: string | null;
      positionX: number;
      positionY: number;
      agentId: string | null;
      contextPolicy: AgentNodeData["contextPolicy"] | null;
      config: AgentNodeData["config"] | null;
    }>;
    edges: Array<{ id: string; sourceNodeId: string; targetNodeId: string; label: string | null }>;
  };
  agents: AgentSummary[];
}

const nodeTypes = { agent: AgentNode };
let tempCounter = 0;
const nextTempId = () => `tmp-${Date.now().toString(36)}-${tempCounter++}`;

function Canvas({ workflow, agents }: WorkflowBuilderProps) {
  const flow = useReactFlow();
  const wrapperRef = useRef<HTMLDivElement>(null);

  const [name, setName] = useState(workflow.name);
  const [executionMode, setExecutionMode] = useState(workflow.executionMode);
  const [entryId, setEntryId] = useState<string | null>(workflow.entryNodeId);
  const [finalId, setFinalId] = useState<string | null>(workflow.finalNodeId);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [issues, setIssues] = useState<string[] | null>(null);

  const [nodes, setNodes, onNodesChange] = useNodesState<BuilderNode>(
    workflow.nodes.map((node) => {
      const agent = agents.find((a) => a.id === node.agentId) ?? null;
      return {
        id: node.id,
        type: "agent" as const,
        position: { x: node.positionX, y: node.positionY },
        data: {
          label: node.label ?? agent?.name ?? "Node",
          agentId: node.agentId,
          agent,
          contextPolicy: node.contextPolicy ?? DEFAULT_CONTEXT_POLICY,
          config: node.config ?? {},
          isEntry: node.id === workflow.entryNodeId,
          isFinal: node.id === workflow.finalNodeId,
        },
      };
    }),
  );

  const [edges, setEdges, onEdgesChange] = useEdgesState<BuilderEdge>(
    workflow.edges.map((edge) => ({
      id: edge.id,
      source: edge.sourceNodeId,
      target: edge.targetNodeId,
      label: edge.label ?? undefined,
      animated: true,
    })),
  );

  const selected = useMemo(() => nodes.find((n) => n.id === selectedId) ?? null, [nodes, selectedId]);

  /** Guard against self-loops; every other topology is validated server-side. */
  const onConnect = useCallback(
    (connection: Connection) => {
      if (connection.source === connection.target) return toast.error("A node cannot connect to itself.");
      setEdges((eds) => addEdge({ ...connection, animated: true }, eds));
    },
    [setEdges],
  );

  const addNode = useCallback(
    (agent: AgentSummary | null, position?: { x: number; y: number }) => {
      const id = nextTempId();
      setNodes((prev) => [
        ...prev,
        {
          id,
          type: "agent" as const,
          position: position ?? { x: 80 + prev.length * 40, y: 80 + prev.length * 30 },
          data: {
            label: agent?.name ?? "New node",
            agentId: agent?.id ?? null,
            agent,
            contextPolicy: DEFAULT_CONTEXT_POLICY,
            config: {},
            isEntry: prev.length === 0,
            isFinal: false,
          },
        },
      ]);
      if (nodes.length === 0) setEntryId(id);
      setSelectedId(id);
    },
    [nodes.length, setNodes],
  );

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const agentId = event.dataTransfer.getData("application/mas-agent");
      if (!agentId) return;
      const position = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
      addNode(agents.find((a) => a.id === agentId) ?? null, position);
    },
    [addNode, agents, flow],
  );

  const patchSelected = useCallback(
    (patch: Partial<AgentNodeData>) => {
      setNodes((prev) =>
        prev.map((node) => (node.id === selectedId ? { ...node, data: { ...node.data, ...patch } } : node)),
      );
    },
    [selectedId, setNodes],
  );

  const markRole = useCallback(
    (role: "entry" | "final") => {
      if (!selectedId) return;
      const setter = role === "entry" ? setEntryId : setFinalId;
      const current = role === "entry" ? entryId : finalId;
      const next = current === selectedId ? null : selectedId;
      setter(next);
      setNodes((prev) =>
        prev.map((node) => ({
          ...node,
          data: { ...node.data, [role === "entry" ? "isEntry" : "isFinal"]: node.id === next },
        })),
      );
    },
    [entryId, finalId, selectedId, setNodes],
  );

  const deleteSelected = useCallback(() => {
    if (!selectedId) return;
    setNodes((prev) => prev.filter((n) => n.id !== selectedId));
    setEdges((prev) => prev.filter((e) => e.source !== selectedId && e.target !== selectedId));
    if (entryId === selectedId) setEntryId(null);
    if (finalId === selectedId) setFinalId(null);
    setSelectedId(null);
  }, [entryId, finalId, selectedId, setEdges, setNodes]);

  const duplicateSelected = useCallback(() => {
    if (!selected) return;
    const id = nextTempId();
    setNodes((prev) => [
      ...prev,
      {
        ...selected,
        id,
        position: { x: selected.position.x + 60, y: selected.position.y + 60 },
        selected: false,
        data: { ...selected.data, label: `${selected.data.label} copy`, isEntry: false, isFinal: false },
      },
    ]);
    setSelectedId(id);
  }, [selected, setNodes]);

  /**
   * Save sends the whole graph. The server replaces nodes/edges in one
   * transaction and maps temporary ids to real ones — simpler and safer than
   * diffing on the client, at the cost of a slightly larger payload.
   */
  async function save() {
    setSaving(true);
    try {
      await api.patch(`/api/workflows/${workflow.id}`, {
        name,
        executionMode,
        nodes: nodes.map((node) => ({
          tempId: node.id,
          kind: "AGENT",
          label: node.data.label,
          positionX: Math.round(node.position.x),
          positionY: Math.round(node.position.y),
          agentId: node.data.agentId ?? undefined,
          contextPolicy: node.data.contextPolicy,
          config: node.data.config,
        })),
        edges: edges.map((edge) => ({
          sourceTempId: edge.source,
          targetTempId: edge.target,
          label: typeof edge.label === "string" ? edge.label : undefined,
        })),
        entryTempId: entryId ?? undefined,
        finalTempId: finalId ?? undefined,
      });

      const validation = await api.get<{ valid: boolean; issues: string[] }>(
        `/api/workflows/${workflow.id}/validate`,
      );
      setIssues(validation.issues);
      toast.success(validation.valid ? "Workflow saved." : "Saved, but the graph has warnings.");
      window.location.reload();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex h-[calc(100vh-0px)] flex-col">
      <header className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        <Input value={name} onChange={(e) => setName(e.target.value)} className="h-9 max-w-xs font-medium" />
        <Select
          value={executionMode}
          onChange={(e) => setExecutionMode(e.target.value)}
          className="h-9 w-44"
          title={EXECUTION_MODES.find((m) => m.value === executionMode)?.hint}
        >
          {EXECUTION_MODES.map((mode) => (
            <option key={mode.value} value={mode.value}>
              {mode.label}
            </option>
          ))}
        </Select>
        <span className="hidden text-xs text-muted-foreground lg:inline">
          {EXECUTION_MODES.find((m) => m.value === executionMode)?.hint}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <RunDialog workflowId={workflow.id} workflowName={name} />
          <Button variant="outline" onClick={save} disabled={saving}>
            {saving ? <Spinner /> : <Save />} Save
          </Button>
        </div>
      </header>

      {issues && issues.length > 0 ? (
        <div className="flex items-start gap-2 border-b border-border bg-[hsl(var(--warning))]/10 px-4 py-2 text-xs">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 text-[hsl(var(--warning))]" />
          <ul className="space-y-0.5">
            {issues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        </div>
      ) : issues ? (
        <div className="flex items-center gap-2 border-b border-border bg-[hsl(var(--success))]/10 px-4 py-2 text-xs">
          <CheckCircle2 className="h-3.5 w-3.5 text-[hsl(var(--success))]" /> Graph is valid and ready to run.
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1">
        <AgentLibrary agents={agents} onAdd={(agent) => addNode(agent)} />

        <div className="min-w-0 flex-1" ref={wrapperRef} onDrop={onDrop} onDragOver={(e) => e.preventDefault()}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_, node) => setSelectedId(node.id)}
            onPaneClick={() => setSelectedId(null)}
            deleteKeyCode={["Backspace", "Delete"]}
            fitView
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={18} size={1} />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable className="!bg-card" />
          </ReactFlow>
        </div>

        <NodeInspector
          node={selected}
          agents={agents}
          executionMode={executionMode}
          onChange={patchSelected}
          onDelete={deleteSelected}
          onDuplicate={duplicateSelected}
          onSetEntry={() => markRole("entry")}
          onSetFinal={() => markRole("final")}
        />
      </div>

      {nodes.length === 0 ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <p className="flex items-center gap-2 rounded-full bg-card px-4 py-2 text-sm text-muted-foreground shadow">
            <Sparkles className="h-4 w-4" /> Drag an agent from the left to start building
          </p>
        </div>
      ) : null}
    </div>
  );
}

export function WorkflowBuilder(props: WorkflowBuilderProps) {
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  );
}
