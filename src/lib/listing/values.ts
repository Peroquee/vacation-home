/**
 * Fixed vocabularies of the listing profile (GitLab #106). Client-safe.
 * Amenities are keys, shown in each language from the message catalogues
 * (`listing.amenities.<key>`); adding one means adding its translations.
 */
export const AMENITIES = [
  "wifi",
  "kitchen",
  "dishwasher",
  "washingMachine",
  "heating",
  "airConditioning",
  "fireplace",
  "tv",
  "parking",
  "garden",
  "terrace",
  "balcony",
  "bbq",
  "pool",
  "sauna",
  "babyCot",
  "highChair",
  "petsAllowed",
] as const;
export type Amenity = (typeof AMENITIES)[number];

/** Photos per property. */
export const MAX_PHOTOS = 30;

export const LISTING_LIMITS = {
  title: 120,
  location: 120,
  description: 5000,
  houseRules: 3000,
  alt: 200,
  exactAddress: 300,
  arrivalNotes: 2000,
  count: 50,
};

/** "HH:MM", 24-hour. */
export const TIME = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
