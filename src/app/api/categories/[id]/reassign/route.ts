import { apiError, fieldError, isUuid, notFound, parseBody } from "@/lib/api";
import { reassignCategory, reassignSchema } from "@/lib/finance/categories";

/**
 * Moves every transaction of this category to `to`, a different, visible
 * category of the same type, in one database transaction: `{ moved }`. The
 * usual step before deleting a category in use. 404 for an unknown category
 * (this one, or `to`); 422 on `to` for another type; 409 when `to` is this
 * category or hidden.
 */
export async function POST(
  request: Request,
  { params }: RouteContext<"/api/categories/[id]/reassign">,
) {
  const { id } = await params;
  if (!isUuid(id)) return notFound("Category");
  const body = await parseBody(request, reassignSchema);
  if ("response" in body) return body.response;

  const result = await reassignCategory(id, body.data.to);
  if ("moved" in result) return Response.json({ moved: result.moved });
  switch (result.error) {
    case "not_found":
      return notFound(result.which === "from" ? "Category" : "Target category");
    case "wrong_type":
      return fieldError("to", `must be an ${result.type} category, like the one moved from`);
    case "same":
      return apiError(409, "conflict", "Choose another category to move the transactions to.", {
        to: ["must be a different category"],
      });
    case "hidden":
      return apiError(
        409,
        "conflict",
        "That category is hidden; show it first or choose another.",
        {
          to: ["is hidden"],
        },
      );
  }
}
