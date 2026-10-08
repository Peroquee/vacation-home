import { apiError, isUuid, notFound, parseBody } from "@/lib/api";
import {
  deleteCategory,
  nameTakenResponse,
  toDto,
  updateCategory,
  updateCategorySchema,
} from "@/lib/finance/categories";

type Context = RouteContext<"/api/categories/[id]">;

/** Renames, recolours, hides or shows a category. Its type never changes. */
export async function PATCH(request: Request, { params }: Context) {
  const { id } = await params;
  if (!isUuid(id)) return notFound("Category");

  const body = await parseBody(request, updateCategorySchema);
  if ("response" in body) return body.response;

  const result = await updateCategory(id, body.data);
  if ("category" in result) return Response.json(toDto(result.category));
  return result.error === "not_found" ? notFound("Category") : nameTakenResponse();
}

/**
 * Deletes an unused user category. 409 for a system category (hide it
 * instead) or one in use (move its transactions first).
 */
export async function DELETE(_request: Request, { params }: Context) {
  const { id } = await params;
  if (!isUuid(id)) return notFound("Category");

  switch (await deleteCategory(id)) {
    case "deleted":
      return new Response(null, { status: 204 });
    case "not_found":
      return notFound("Category");
    case "system":
      return apiError(
        409,
        "conflict",
        "System categories cannot be deleted; hide it instead.",
        undefined,
        {
          reason: "system",
        },
      );
    case "in_use":
      return apiError(
        409,
        "conflict",
        "Transactions use this category; move them to another category first.",
        undefined,
        { reason: "in_use" },
      );
  }
}
