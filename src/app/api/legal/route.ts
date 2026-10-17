import { apiError, parseBody } from "@/lib/api";
import { LEGAL_IN_USE, legalSchema } from "@/lib/legal/legal";
import { getLegal, saveLegal } from "@/lib/legal/service";

/** The public site's Impressum and privacy policy (GitLab #112). */
export async function GET() {
  return Response.json(await getLegal());
}

/**
 * Replaces them; missing fields are blank. 422 when it would empty a
 * required part while a property is listed.
 */
export async function PUT(request: Request) {
  const body = await parseBody(request, legalSchema);
  if ("response" in body) return body.response;
  const result = await saveLegal(body.data);
  if ("error" in result) {
    return apiError(
      422,
      "validation_failed",
      "The request has invalid fields.",
      Object.fromEntries(result.fields.map((field) => [field, [LEGAL_IN_USE]])),
    );
  }
  return Response.json(result.legal);
}
