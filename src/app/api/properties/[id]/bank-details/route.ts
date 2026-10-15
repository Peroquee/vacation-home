import { isUuid, notFound, parseBody } from "@/lib/api";
import { bankDetailsSchema, getBankDetails, saveBankDetails } from "@/lib/payments/bank";
import { getProperty } from "@/lib/properties/service";

type Context = RouteContext<"/api/properties/[id]/bank-details">;

/**
 * Where guests transfer to (GitLab #115): `accountHolder`, `iban`, and
 * optionally `bic` and `bankName`. Null until entered.
 */
export async function GET(_request: Request, { params }: Context) {
  const { id } = await params;
  if (!isUuid(id) || !(await getProperty(id))) return notFound("Property");
  return Response.json(await getBankDetails(id));
}

/** Replaces the details; the IBAN is checked (checksum) and stored without spaces. */
export async function PUT(request: Request, { params }: Context) {
  const { id } = await params;
  if (!isUuid(id)) return notFound("Property");
  const body = await parseBody(request, bankDetailsSchema);
  if ("response" in body) return body.response;
  if (!(await getProperty(id))) return notFound("Property");
  return Response.json(await saveBankDetails(id, body.data));
}
