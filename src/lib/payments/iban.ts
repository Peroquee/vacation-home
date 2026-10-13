/**
 * IBAN and BIC checks (ISO 13616, ISO 9362). Client-safe.
 */

/** Country code -> IBAN length, for the SEPA countries; others are checked by pattern and checksum only. */
const LENGTHS: Record<string, number> = {
  AD: 24,
  AT: 20,
  BE: 16,
  BG: 22,
  CH: 21,
  CY: 28,
  CZ: 24,
  DE: 22,
  DK: 18,
  EE: 20,
  ES: 24,
  FI: 18,
  FR: 27,
  GB: 22,
  GI: 23,
  GR: 27,
  HR: 21,
  HU: 28,
  IE: 22,
  IS: 26,
  IT: 27,
  LI: 21,
  LT: 20,
  LU: 20,
  LV: 21,
  MC: 27,
  MT: 31,
  NL: 18,
  NO: 15,
  PL: 28,
  PT: 25,
  RO: 24,
  SE: 24,
  SI: 19,
  SK: 24,
  SM: 27,
  VA: 22,
};

/** As stored and checked: no spaces, upper case. */
export function normaliseIban(text: string): string {
  return text.replace(/\s+/g, "").toUpperCase();
}

/** Whether `iban` (normalised) is well formed with a valid checksum (mod 97). */
export function isValidIban(iban: string): boolean {
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
  const length = LENGTHS[iban.slice(0, 2)];
  if (length !== undefined && iban.length !== length) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const char of rearranged) {
    const value = char >= "A" ? char.charCodeAt(0) - 55 : Number(char);
    remainder = Number(`${remainder}${value}`) % 97;
  }
  return remainder === 1;
}

/** In groups of four, as people read and type it. */
export function formatIban(iban: string): string {
  return iban.replace(/(.{4})/g, "$1 ").trim();
}

/** Whether `bic` (upper case) is a BIC: 8 or 11 characters. */
export function isValidBic(bic: string): boolean {
  return /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(bic);
}
