import { z } from "zod";

import { apiError, parseBody } from "@/lib/api";
import { addAllowedAccount, listAllowedAccounts } from "@/lib/allowed-emails";
import { getCurrentUser } from "@/lib/session";

/**
 * The accounts allowed to sign in (GitLab #122): the fixed ones from
 * AUTH_ALLOWED_EMAILS (`fixed`, not removable here) and those added in
 * the app.
 */
export async function GET() {
  return Response.json(await listAllowedAccounts());
}

const addSchema = z.strictObject({
  email: z
    .string({ error: "is required" })
    .trim()
    .toLowerCase()
    .min(1, "is required")
    .pipe(z.email("must be a valid email address")),
});

/** Adds an account; 409 when it may sign in already. */
export async function POST(request: Request) {
  const body = await parseBody(request, addSchema);
  if ("response" in body) return body.response;
  const added = await addAllowedAccount(body.data.email, (await getCurrentUser())?.id ?? null);
  if (added === "exists") {
    return apiError(409, "conflict", "This account may sign in already.");
  }
  return Response.json(added, { status: 201 });
}
