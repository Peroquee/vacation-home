import { z } from "zod";

import { apiError, parseBody, validationError } from "@/lib/api";
import {
  createCategory,
  createCategorySchema,
  listCategories,
  toDto,
  TRANSACTION_TYPES,
} from "@/lib/finance/categories";

const listQuery = z.object({
  type: z.enum(TRANSACTION_TYPES).optional(),
  includeHidden: z.enum(["true", "false"]).optional(),
});

/** Categories by type and name; `?type=income|expense`, `?includeHidden=true`. */
export async function GET(request: Request) {
  const parsed = listQuery.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return validationError(parsed.error);
  const categories = await listCategories({
    type: parsed.data.type,
    includeHidden: parsed.data.includeHidden === "true",
  });
  return Response.json(categories.map(toDto));
}

/** Creates a user category; 409 if one of that type already has the name. */
export async function POST(request: Request) {
  const body = await parseBody(request, createCategorySchema);
  if ("response" in body) return body.response;
  const result = await createCategory(body.data);
  if ("category" in result) {
    return Response.json(toDto(result.category), {
      status: 201,
      headers: { Location: `/api/categories/${result.category.id}` },
    });
  }
  return apiError(409, "conflict", "A category of this type already has that name.", {
    name: ["is already taken"],
  });
}
