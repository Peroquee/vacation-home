import { db } from "@/lib/db";

/** Lists properties. The write endpoints arrive with the full property model. */
export async function GET() {
  const properties = await db.property.findMany({ orderBy: { name: "asc" } });
  return Response.json(properties);
}
