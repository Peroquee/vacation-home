/**
 * The API answers in English: its error messages and field messages are
 * fixed phrases ("is required", "Booking not found."), and the clients show
 * them. This puts them into the page's language by matching each against the
 * English catalogue's `api` namespace; a `{placeholder}` there matches any
 * value ("must be at most {max} characters"). Text it does not know is shown
 * as it came, so a new server message is never lost, only untranslated.
 *
 * Client-safe: used by the forms (useApiText) and by server components.
 */
import en from "../../messages/en-GB.json";

type Values = Record<string, string>;
export type ApiTranslate = (key: keyof typeof en.api, values?: Values) => string;

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const PHRASES = Object.entries(en.api).map(([key, template]) => {
  const names = [...template.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!);
  const pattern = new RegExp(
    `^${template
      .split(/\{\w+\}/)
      .map(escape)
      .join("(.+?)")}$`,
  );
  return { key: key as keyof typeof en.api, names, pattern };
});

/** One message from the API, in the page's language when it is a known phrase. */
export function apiText(text: string, t: ApiTranslate): string {
  for (const { key, names, pattern } of PHRASES) {
    const match = pattern.exec(text);
    if (match) {
      return t(key, Object.fromEntries(names.map((name, i) => [name, match[i + 1]!])));
    }
  }
  return text;
}

/** A 422's field messages, each translated. */
export function apiFields(
  fields: Record<string, string[] | undefined>,
  t: ApiTranslate,
): Record<string, string[] | undefined> {
  return Object.fromEntries(
    Object.entries(fields).map(([field, messages]) => [
      field,
      messages?.map((message) => apiText(message, t)),
    ]),
  );
}
