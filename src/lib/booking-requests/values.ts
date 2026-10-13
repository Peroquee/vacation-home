/**
 * Booking request values the browser needs too (the request form), kept
 * free of zod and of server code.
 */

/** The longest message a guest can send with a request. */
export const MESSAGE_MAX = 2000;

/**
 * The honeypot: a field people never see or fill, named to tempt a bot
 * filling every field it finds. Any value refuses the request.
 */
export const HONEYPOT_FIELD = "homepage";

/** Said to a request refused as spam, without saying why. */
export const NOT_SENT = "The request could not be sent. Please try again.";

/**
 * Said of a challenge that is not valid (any more): the form fetches and
 * solves a new one and sends again once by itself.
 */
export const CHECK_FAILED = "the automatic spam check failed; please send the request again";

/**
 * A booking's reference, as the guest reads it: "K7QD-9MXA". Stored
 * without the hyphen.
 */
export function formatReference(reference: string): string {
  return `${reference.slice(0, 4)}-${reference.slice(4)}`;
}

/** A reference as shown or typed - any case, with or without the hyphen. */
export const REFERENCE = /^[A-HJKMNP-Z2-9]{4}-?[A-HJKMNP-Z2-9]{4}$/i;
