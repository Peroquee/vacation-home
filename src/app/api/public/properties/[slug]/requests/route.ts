import { apiError, notFound, validationError } from "@/lib/api";
import { challengePayloadSchema, checkRequestChallenge } from "@/lib/booking-requests/challenge";
import { hitEmailLimit } from "@/lib/booking-requests/limits";
import { bookingRequestSchema } from "@/lib/booking-requests/schema";
import { createBookingRequest } from "@/lib/booking-requests/service";
import { CHECK_FAILED, HONEYPOT_FIELD, NOT_SENT } from "@/lib/booking-requests/values";
import { getListedProperty } from "@/lib/properties/service";

type Context = RouteContext<"/api/public/properties/[slug]/requests">;

const invalid = (fields: Record<string, string[]>) =>
  apiError(422, "validation_failed", "The request has invalid fields.", fields);

/**
 * POST: a guest's booking request (GitLab #109). Refused, cheapest check
 * first: the honeypot, the fields, the proof of work and form time, the
 * limit per email address, then the stay against the booking rules and
 * what is taken. 201 with the reference and the stay as stored.
 *
 * Only the last of these gives the spam check back for another try (see
 * src/lib/booking-requests/challenge.ts): the guest can correct them. The
 * fields are judged before the check is spent at all.
 */
export async function POST(request: Request, { params }: Context) {
  const { slug } = await params;
  const property = await getListedProperty(slug);
  if (!property) return notFound("Property");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, "invalid_json", "The request body is not valid JSON.");
  }
  // Filled in: a bot. Its spam check is spent for good, and it is told no
  // more than that it failed.
  const honeypot = (body as Record<string, unknown> | null)?.[HONEYPOT_FIELD];
  if (typeof honeypot !== "string" ? honeypot != null : honeypot.trim() !== "") {
    const altcha = challengePayloadSchema.safeParse((body as Record<string, unknown>).altcha);
    if (altcha.success) await checkRequestChallenge(altcha.data, property.slug);
    return invalid({ _: [NOT_SENT] });
  }
  const parsed = bookingRequestSchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error);
  const input = parsed.data;

  const check = await checkRequestChallenge(input.altcha, property.slug);
  if (!check.ok) {
    return invalid(check.reason === "too_fast" ? { _: [NOT_SENT] } : { altcha: [CHECK_FAILED] });
  }
  try {
    // Over the limit: spent, like any attempt.
    const retryAfter = hitEmailLimit(input.email);
    if (retryAfter !== null) {
      const response = apiError(
        429,
        "rate_limited",
        "Too many requests; try again later.",
        undefined,
        {
          retryAfterSeconds: retryAfter,
        },
      );
      response.headers.set("Retry-After", String(retryAfter));
      return response;
    }
    const result = await createBookingRequest(property, input);
    if ("error" in result) {
      check.release();
      return invalid(result.fields);
    }
    return Response.json(result.request, { status: 201 });
  } catch (error) {
    check.release();
    throw error;
  }
}
