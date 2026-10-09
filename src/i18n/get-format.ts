import { getLocale } from "next-intl/server";

import { type Formatters, formattersFor } from "./format";

/** The formatters in the language of the request, for server components. */
export async function getFormat(): Promise<Formatters> {
  return formattersFor(await getLocale());
}
