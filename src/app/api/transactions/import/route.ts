import { fieldError, parseBody } from "@/lib/api";
import { checkImportDefaults, importSchema, importTransactions } from "@/lib/finance/import";

/**
 * Imports CSV rows (GitLab #83). Without `commit` it is the preview: every
 * row checked, with its line, status (ready, duplicate, invalid) and
 * problems. With `commit`, the ready rows and the confirmed duplicates
 * (`include`) are written; the answer says which were imported or skipped.
 * A default category of the other type is a 422 on its field (#129).
 */
export async function POST(request: Request) {
  const parsed = await parseBody(request, importSchema);
  if ("response" in parsed) return parsed.response;
  const problem = await checkImportDefaults(parsed.data.defaults);
  if (problem) return fieldError(problem.field, problem.message);
  return Response.json(await importTransactions(parsed.data));
}
