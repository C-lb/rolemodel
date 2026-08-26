import { notFound } from "next/navigation";
import { realDeps } from "@/server/deps";
import { loadWorkspace } from "@/server/documents";
import { WorkspaceScreen } from "./WorkspaceScreen";

export default async function WorkspacePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let ws: Awaited<ReturnType<typeof loadWorkspace>>;
  try {
    ws = await loadWorkspace(realDeps(), id);
  } catch (error) {
    // A missing workspace is a 404. Anything else is a real fault and must not be disguised as one.
    if ((error as Error).message.startsWith("No workspace ")) notFound();
    throw error;
  }

  return (
    <WorkspaceScreen
      workspaceId={id}
      documentName={ws.documentName}
      periods={ws.periods}
      findings={ws.findings}
      statements={{
        income: ws.statement("income"),
        balance: ws.statement("balance"),
        cashflow: ws.statement("cashflow"),
      }}
    />
  );
}
