/**
 * Typed failures the persistence seam can raise.
 *
 * The 404 boundary used to be a string prefix match on the thrown message, and two
 * call sites already worded that message differently. A condition the router acts on
 * needs an identity that survives reformatting the sentence.
 */
export class WorkspaceNotFoundError extends Error {
  readonly code = "workspace_not_found";

  constructor(readonly workspaceId: string) {
    super(`No workspace "${workspaceId}".`);
    this.name = "WorkspaceNotFoundError";
  }
}

/**
 * `instanceof` is the primary test. The code is checked too, so a copy of the class
 * arriving from a separately bundled module still reads as the same condition —
 * failing that check open would turn a 404 into a 500.
 */
export function isWorkspaceNotFound(error: unknown): error is WorkspaceNotFoundError {
  if (error instanceof WorkspaceNotFoundError) return true;
  return (
    typeof error === "object" && error !== null &&
    (error as { code?: unknown }).code === "workspace_not_found"
  );
}
