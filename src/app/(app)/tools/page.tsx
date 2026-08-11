import { ShieldAlert, Wrench } from "lucide-react";
import { getToolRegistry } from "@/lib/tools/registry";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";

/** Read-only catalogue. Tools are granted per agent in the Agent Builder. */
export default function ToolsPage() {
  const tools = getToolRegistry().describe();

  return (
    <div className="p-6 lg:p-8">
      <PageHeader
        title="Tools"
        description="Built-in capabilities agents can be granted. Permission is enforced at call time, not just in the prompt."
      />

      <div className="grid gap-4 md:grid-cols-2">
        {tools.map((tool) => (
          <Card key={tool.name}>
            <CardContent className="space-y-3 p-5">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Wrench className="h-4 w-4 text-primary" />
                  <p className="font-medium">{tool.displayName}</p>
                </div>
                {tool.dangerous ? (
                  <Badge variant="warning">
                    <ShieldAlert className="h-3 w-3" /> elevated
                  </Badge>
                ) : null}
              </div>
              <p className="text-sm text-muted-foreground">{tool.description}</p>
              <pre className="max-h-48 overflow-auto rounded-lg bg-muted p-3 font-mono text-xs">
                {JSON.stringify(tool.inputSchema, null, 2)}
              </pre>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
