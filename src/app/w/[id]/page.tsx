import { notFound } from "next/navigation";
import { realDeps } from "@/server/deps";
import { loadWorkspace } from "@/server/documents";
import { isWorkspaceNotFound } from "@/server/errors";
import { computeRatios } from "@/model/ratios/compute";
import { WorkspaceScreen } from "./WorkspaceScreen";

export default async function WorkspacePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let ws: Awaited<ReturnType<typeof loadWorkspace>>;
  try {
    ws = await loadWorkspace(realDeps(), id);
  } catch (error) {
    // A missing workspace is a 404. Anything else is a real fault and must not be
    // disguised as one, so the test is the error's own type, not the wording of its
    // message: reformatting a sentence must never move this boundary.
    if (isWorkspaceNotFound(error)) notFound();
    throw error;
  }

  // Ratios are computed here, on the server, so the screen receives values rather than
  // the means to compute them. Same rule the statements follow.
  const ratios = computeRatios({ workspace: ws, mode: ws.averagingMode, custom: ws.customRatios });

  return (
    <WorkspaceScreen
      workspaceId={id}
      documentName={ws.documentName}
      periods={ws.periods}
      findings={ws.findings}
      unmapped={ws.unmapped}
      ratios={ratios}
      customRatios={ws.customRatios}
      averagingMode={ws.averagingMode}
      statements={{
        income: ws.statement("income"),
        balance: ws.statement("balance"),
        cashflow: ws.statement("cashflow"),
      }}
    />
  );
}
