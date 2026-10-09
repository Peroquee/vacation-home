import { getTranslations } from "next-intl/server";

import { apiText, type ApiTranslate } from "./api-text";

/** The API's English messages in the request's language, for server components. */
export async function getApiText(): Promise<(message: string) => string> {
  const t = (await getTranslations("api")) as ApiTranslate;
  return (message) => apiText(message, t);
}
