import { apiError, isUuid, notFound, parseBody } from "@/lib/api";
import { updateGuestSchema } from "@/lib/guests/schema";
import { deleteGuest, getGuest, toDto, updateGuest } from "@/lib/guests/service";

type Context = RouteContext<"/api/guests/[id]">;

export async function GET(_request: Request, { params }: Context) {
  const { id } = await params;
  const guest = isUuid(id) ? await getGuest(id) : null;
  return guest ? Response.json(toDto(guest)) : notFound("Guest");
}

/** Updates any subset of fields. 409 if the new email belongs to another guest. */
export async function PATCH(request: Request, { params }: Context) {
  const { id } = await params;
  if (!isUuid(id)) return notFound("Guest");

  const body = await parseBody(request, updateGuestSchema);
  if ("response" in body) return body.response;

  const result = await updateGuest(id, body.data);
  if ("guest" in result) return Response.json(toDto(result.guest));
  switch (result.error) {
    case "not_found":
      return notFound("Guest");
    case "purged":
      return apiError(
        409,
        "conflict",
        "This guest's personal data was erased; it cannot be edited.",
      );
    case "email_taken":
      return apiError(409, "conflict", "Another guest already has this email address.", {
        email: ["belongs to another guest"],
      });
  }
}

/** Deletes a guest without bookings; 409 for one with bookings. */
export async function DELETE(_request: Request, { params }: Context) {
  const { id } = await params;
  if (!isUuid(id)) return notFound("Guest");

  switch (await deleteGuest(id)) {
    case "deleted":
      return new Response(null, { status: 204 });
    case "not_found":
      return notFound("Guest");
    case "has_history":
      return apiError(409, "conflict", "This guest has bookings and cannot be deleted.");
  }
}
