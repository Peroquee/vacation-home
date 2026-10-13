/** Booking references (GitLab #109). Server-side only. */
import { randomInt } from "node:crypto";

/** Letters and digits that cannot be mistaken for each other: no I, L, O, 0, 1. */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** A new random reference: 8 characters, about 40 bits. Never a credential. */
export function newReference(): string {
  return Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
}
