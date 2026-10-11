import { isUuid, notFound, validationError } from "@/lib/api";
import { stayQuerySchema } from "@/lib/booking-rules/schema";
import { checkStayAt } from "@/lib/booking-rules/service";
import { getProperty } from "@/lib/properties/service";

type Context = RouteContext<"/api/properties/[id]/booking-rules/check">;

/**
 * The owner's view of a stay against the property's booking rules, for the
 * booking form's warnings:
 *
 *   GET /api/properties/:id/booking-rules/check?checkIn=…&checkOut=…[&ignoreBookingId=…]
 *
 * Answers `{ warnings: [{ field, rule, message }] }`. Warnings only: the
 * owner may book outside the rules. Taken dates are not among them; the form
 * shows those as conflicts, with names.
 */
export async function GET(request: Request, { params }: Context) {
  const { id } = await params;
  if (!isUuid(id)) return notFound("Property");
  const parsed = stayQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return validationError(parsed.error);
  const property = await getProperty(id);
  if (!property) return notFound("Property");
  const { checkIn, checkOut, ignoreBookingId } = parsed.data;
  const warnings = await checkStayAt(
    property,
    { checkIn, checkOut },
    { mode: "owner", ignoreBookingId },
  );
  return Response.json({ warnings });
}
