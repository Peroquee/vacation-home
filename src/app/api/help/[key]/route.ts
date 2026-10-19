import { getLocale } from "next-intl/server";

import type { Locale } from "@/i18n/locales";
import { notFound } from "@/lib/api";
import { readHelp } from "@/lib/help/content";

type Context = RouteContext<"/api/help/[key]">;

/**
 * The help for one owner page (GitLab #121), in the request's language:
 * `{ markdown, guide }`. Signed in only, like every owner route. Loaded when
 * the help panel opens.
 */
export async function GET(_request: Request, { params }: Context) {
  const { key } = await params;
  const help = await readHelp(key, (await getLocale()) as Locale);
  return help ? Response.json(help) : notFound("Help");
}
