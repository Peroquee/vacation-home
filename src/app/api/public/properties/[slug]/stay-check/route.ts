import { apiError, notFound, validationError } from "@/lib/api";
import { violationFields } from "@/lib/booking-rules/rules";
import { stayQuerySchema } from "@/lib/booking-rules/schema";
import { checkStayAt } from "@/lib/booking-rules/service";
import { getListedProperty } from "@/lib/properties/service";

type Context = RouteContext<"/api/public/properties/[slug]/stay-check">;

/**
 * Whether a guest may request a stay at a listed property (GitLab #107):
 *
 *   GET /api/public/properties/:slug/stay-check?checkIn=…&checkOut=…
 *
 * `200 { ok: true }`, or a `422` with one message per field for each booking
 * rule the stay breaks, and "these dates are not available" for taken dates
 * - never why they are taken. The request API (GitLab #109) refuses the
 * same way, with the same check.
 */
export async function GET(request: Request, { params }: Context) {
  const { slug } = await params;
  const property = await getListedProperty(slug);
  if (!property) return notFound("Property");
  const search = new URL(request.url).searchParams;
  // Only the dates: the owner's `ignoreBookingId` has no meaning here.
  const parsed = stayQuerySchema.safeParse({
    checkIn: search.get("checkIn") ?? undefined,
    checkOut: search.get("checkOut") ?? undefined,
  });
  if (!parsed.success) return validationError(parsed.error);
  const { checkIn, checkOut } = parsed.data;
  const violations = await checkStayAt(property, { checkIn, checkOut }, { mode: "public" });
  if (violations.length === 0) return Response.json({ ok: true });
  return apiError(
    422,
    "validation_failed",
    "The request has invalid fields.",
    violationFields(violations),
  );
}
