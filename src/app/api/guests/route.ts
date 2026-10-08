import { parseBody, validationError } from "@/lib/api";
import { createGuestSchema, searchGuestsSchema } from "@/lib/guests/schema";
import { findOrCreateGuest, searchGuests, toDto } from "@/lib/guests/service";

/**
 * Searches guests: `?q=` matches any part of the name or email, ignoring
 * case; `?limit=` caps the results (default 20, at most 100). Without `q`,
 * lists guests by name.
 */
export async function GET(request: Request) {
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const parsed = searchGuestsSchema.safeParse(params);
  if (!parsed.success) return validationError(parsed.error);

  const guests = await searchGuests(parsed.data.q || undefined, parsed.data.limit);
  return Response.json(guests.map(toDto));
}

/**
 * Creates a guest: 201. If a guest with the same email already exists, it is
 * returned unchanged with a 200 instead of creating a duplicate.
 */
export async function POST(request: Request) {
  const body = await parseBody(request, createGuestSchema);
  if ("response" in body) return body.response;

  const { guest, created } = await findOrCreateGuest(body.data);
  return Response.json(toDto(guest), {
    status: created ? 201 : 200,
    headers: { Location: `/api/guests/${guest.id}` },
  });
}
