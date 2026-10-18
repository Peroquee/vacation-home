import { apiError, isUuid, notFound } from "@/lib/api";
import { removeAllowedAccount } from "@/lib/allowed-emails";
import { getCurrentUser } from "@/lib/session";

type Context = RouteContext<"/api/access/accounts/[id]">;

/**
 * Removes an account added in the app, ending its sessions at once. Never
 * the caller's own, never the last one, never a fixed one (they have no id).
 */
export async function DELETE(_request: Request, { params }: Context) {
  const { id } = await params;
  if (!isUuid(id)) return notFound("Account");
  const user = await getCurrentUser();
  if (!user) return apiError(401, "unauthorized", "Sign in to use the API.");
  switch (await removeAllowedAccount(id, user)) {
    case "removed":
      return new Response(null, { status: 204 });
    case "not_found":
      return notFound("Account");
    case "yourself":
      return apiError(409, "conflict", "You cannot remove your own account.");
    case "last":
      return apiError(409, "conflict", "The last account cannot be removed.");
  }
}
