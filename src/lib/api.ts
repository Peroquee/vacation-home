/**
 * Shared response conventions for the JSON API. Every error has the shape
 *
 *   { "error": { "code": "...", "message": "...", "fields"?: { "name": ["..."] }, ...extra } }
 *
 * so clients can branch on `code` and show `fields` next to form inputs.
 * Some errors carry more, such as a 409's `conflicts`.
 */
import { z } from "zod";

export type ApiErrorCode =
  | "invalid_json"
  | "unauthorized"
  | "validation_failed"
  | "not_found"
  | "conflict"
  /** A cross-site request to a mutating route. 403. */
  | "forbidden"
  /** Too many requests; see Retry-After. 429. */
  | "rate_limited"
  /** A service the request needs (Google) failed; try again later. 502. */
  | "upstream_unavailable";

export function apiError(
  status: number,
  code: ApiErrorCode,
  message: string,
  fields?: Record<string, string[]>,
  extra?: Record<string, unknown>,
): Response {
  return Response.json(
    { error: { code, message, ...(fields && { fields }), ...extra } },
    { status },
  );
}

/** 422 for invalid fields found after parsing, e.g. a guest that does not exist. */
export function fieldError(field: string, message: string): Response {
  return apiError(422, "validation_failed", "The request has invalid fields.", {
    [field]: [message],
  });
}

/** 422 with one list of messages per invalid field. */
export function validationError(error: z.ZodError): Response {
  const { formErrors, fieldErrors } = z.flattenError(error);
  const fields: Record<string, string[]> = { ...(fieldErrors as Record<string, string[]>) };
  // Problems not tied to one field (an unknown key, an empty update) are
  // reported under "_".
  if (formErrors.length > 0) fields._ = formErrors;
  return apiError(422, "validation_failed", "The request has invalid fields.", fields);
}

export function notFound(what = "Resource"): Response {
  return apiError(404, "not_found", `${what} not found.`);
}

/**
 * Parses and validates a JSON request body. Returns the data, or the error
 * response to send: 400 for a body that is not JSON, 422 for one that does
 * not match the schema.
 */
export async function parseBody<T extends z.ZodType>(
  request: Request,
  schema: T,
): Promise<{ data: z.infer<T> } | { response: Response }> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return { response: apiError(400, "invalid_json", "The request body is not valid JSON.") };
  }
  const parsed = schema.safeParse(body);
  return parsed.success ? { data: parsed.data } : { response: validationError(parsed.error) };
}

const UUID = z.uuid();

/** Route ids are UUIDs; anything else cannot exist, so it is a 404. */
export function isUuid(value: string): boolean {
  return UUID.safeParse(value).success;
}
