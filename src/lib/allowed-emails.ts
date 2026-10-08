import { env } from "@/env";

/** Whether `email` may use the app: on AUTH_ALLOWED_EMAILS, in any case. */
export function isAllowedEmail(email: string | null | undefined): boolean {
  return !!email && env.AUTH_ALLOWED_EMAILS.includes(email.trim().toLowerCase());
}
