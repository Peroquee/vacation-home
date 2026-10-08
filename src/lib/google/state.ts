/**
 * CSRF protection for the calendar connect flow: a random `state` sent to
 * Google and kept in a short-lived, httpOnly cookie, bound to the user who
 * started the flow. The callback accepts a code only with a matching pair.
 */
import { randomBytes, timingSafeEqual } from "node:crypto";

import { CALLBACK_PATH } from "./connection";

export const STATE_COOKIE = "google-connect-state";
const MAX_AGE_SECONDS = 10 * 60;

export function newState(): string {
  return randomBytes(32).toString("base64url");
}

export function stateCookie(userId: string, state: string, secure: boolean): string {
  return [
    `${STATE_COOKIE}=${userId}.${state}`,
    `Path=${CALLBACK_PATH}`,
    `Max-Age=${MAX_AGE_SECONDS}`,
    "HttpOnly",
    // Lax: Google's redirect back is a top-level GET navigation.
    "SameSite=Lax",
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

export function clearStateCookie(secure: boolean): string {
  return `${STATE_COOKIE}=; Path=${CALLBACK_PATH}; Max-Age=0; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
}

/** Whether the callback's `state` is the one this user's browser was given. */
export function stateMatches(
  cookie: string | undefined,
  userId: string,
  state: string | null,
): boolean {
  if (!cookie || !state) return false;
  const expected = Buffer.from(`${userId}.${state}`);
  const actual = Buffer.from(cookie);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
