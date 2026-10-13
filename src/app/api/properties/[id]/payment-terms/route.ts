import { isUuid, notFound, parseBody } from "@/lib/api";
import { paymentTermsSchema } from "@/lib/payment-terms/schema";
import { getPaymentTerms, savePaymentTerms } from "@/lib/payment-terms/service";
import { getProperty } from "@/lib/properties/service";

type Context = RouteContext<"/api/properties/[id]/payment-terms">;

/**
 * The property's payment terms (GitLab #114): `depositPercent` or
 * `depositFixedMinor`, `depositDueDays`, `balanceDueDaysBefore` and
 * `fullPaymentDueDays`. A property without terms of its own gets the
 * defaults.
 */
export async function GET(_request: Request, { params }: Context) {
  const { id } = await params;
  if (!isUuid(id) || !(await getProperty(id))) return notFound("Property");
  return Response.json(await getPaymentTerms(id));
}

/** Replaces the terms; every field is required. Reserved bookings keep theirs. */
export async function PUT(request: Request, { params }: Context) {
  const { id } = await params;
  if (!isUuid(id)) return notFound("Property");
  const body = await parseBody(request, paymentTermsSchema);
  if ("response" in body) return body.response;
  if (!(await getProperty(id))) return notFound("Property");
  return Response.json(await savePaymentTerms(id, body.data));
}
