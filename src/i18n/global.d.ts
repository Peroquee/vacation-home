import type messages from "../../messages/en-GB.json";
import type { Locale } from "./locales";

/**
 * Typed translations: every key used in code must exist in the English
 * catalogue, or typecheck fails. scripts/check-messages.mjs then makes sure
 * the German catalogue has exactly the same keys.
 */
declare module "next-intl" {
  interface AppConfig {
    Locale: Locale;
    Messages: typeof messages;
  }
}
