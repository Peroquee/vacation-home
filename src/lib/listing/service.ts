/**
 * The listing profile and its photos (GitLab #106). Server-side only.
 */
import type { PropertyListing, PropertyPhoto, PropertyPhotoSize } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { removeIfUnreferenced, storeFile } from "@/lib/files/store";

import { PHOTO_ERRORS, processPhoto } from "./photo-processing";
import type { ListingInput } from "./schema";
import { MAX_PHOTOS } from "./values";

export type ListingDto = Omit<PropertyListing, "propertyId" | "createdAt" | "updatedAt">;

/** A property without a profile yet: everything blank. */
export const EMPTY_LISTING: ListingDto = {
  titleEn: "",
  titleDe: "",
  descriptionEn: "",
  descriptionDe: "",
  houseRulesEn: "",
  houseRulesDe: "",
  location: "",
  maxGuests: null,
  bedrooms: null,
  bathrooms: null,
  amenities: [],
  checkInTime: null,
  checkOutTime: null,
  exactAddress: "",
  arrivalNotes: "",
};

function toListingDto(row: PropertyListing | null): ListingDto {
  if (!row) return EMPTY_LISTING;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- left out on purpose
  const { propertyId, createdAt, updatedAt, ...rest } = row;
  return rest;
}

export async function getListing(propertyId: string): Promise<ListingDto> {
  return toListingDto(await db.propertyListing.findUnique({ where: { propertyId } }));
}

export async function saveListing(propertyId: string, input: ListingInput): Promise<ListingDto> {
  const row = await db.propertyListing.upsert({
    where: { propertyId },
    create: { propertyId, ...input },
    update: input,
  });
  return toListingDto(row);
}

// --- Photos -----------------------------------------------------------------

export type PhotoSizeDto = { width: number; height: number; file: string };
export type PhotoDto = {
  id: string;
  position: number;
  altEn: string;
  altDe: string;
  /** Smallest first; `file` is the name under the photo file routes. */
  sizes: PhotoSizeDto[];
};

type PhotoRow = PropertyPhoto & { sizes: PropertyPhotoSize[] };

/** A stored size's name in the URL: its hash, with the type as extension. */
export const photoFileName = (sha256: string) => `${sha256}.webp`;
const FILE = /^([0-9a-f]{64})\.webp$/;

export function toPhotoDto(photo: PhotoRow): PhotoDto {
  return {
    id: photo.id,
    position: photo.position,
    altEn: photo.altEn,
    altDe: photo.altDe,
    sizes: [...photo.sizes]
      .sort((a, b) => a.width - b.width)
      .map((s) => ({ width: s.width, height: s.height, file: photoFileName(s.sha256) })),
  };
}

/** The property's photos in display order: the cover first. */
export async function listPhotos(propertyId: string): Promise<PhotoDto[]> {
  const photos = await db.propertyPhoto.findMany({
    where: { propertyId },
    include: { sizes: true },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }, { id: "asc" }],
  });
  return photos.map(toPhotoDto);
}

export type AddPhoto =
  | { photo: PhotoDto }
  | { error: "not_found" }
  | { error: "too_many" }
  | { error: "invalid"; message: string };

/** Checks, re-encodes and stores an uploaded photo, last in the order. */
export async function addPhoto(propertyId: string, bytes: Uint8Array): Promise<AddPhoto> {
  const exists = await db.property.findUnique({ where: { id: propertyId }, select: { id: true } });
  if (!exists) return { error: "not_found" };
  if ((await db.propertyPhoto.count({ where: { propertyId } })) >= MAX_PHOTOS) {
    return { error: "too_many" };
  }
  const processed = await processPhoto(bytes);
  if ("error" in processed) return { error: "invalid", message: PHOTO_ERRORS[processed.error] };

  // Files first: a file without a row is swept later; a row without its
  // file would be a broken photo.
  const sizes: { width: number; height: number; sha256: string }[] = [];
  for (const size of processed.sizes) {
    sizes.push({ width: size.width, height: size.height, sha256: await storeFile(size.bytes) });
  }

  return db.$transaction(async (tx) => {
    // One upload at a time per property, so the limit and the order hold.
    await tx.$queryRaw`SELECT id FROM properties WHERE id = ${propertyId}::uuid FOR UPDATE`;
    const existing = await tx.propertyPhoto.aggregate({
      where: { propertyId },
      _count: true,
      _max: { position: true },
    });
    if (existing._count >= MAX_PHOTOS) return { error: "too_many" } as const;
    const photo = await tx.propertyPhoto.create({
      data: {
        propertyId,
        position: (existing._max.position ?? -1) + 1,
        sizes: { create: sizes },
      },
      include: { sizes: true },
    });
    return { photo: toPhotoDto(photo) };
  });
}

/** Changes a photo's alternative text; null when there is no such photo. */
export async function updatePhoto(
  propertyId: string,
  photoId: string,
  input: { altEn?: string; altDe?: string },
): Promise<PhotoDto | null> {
  const { count } = await db.propertyPhoto.updateMany({
    where: { id: photoId, propertyId },
    data: input,
  });
  if (count === 0) return null;
  const photo = await db.propertyPhoto.findUnique({
    where: { id: photoId },
    include: { sizes: true },
  });
  return photo && toPhotoDto(photo);
}

/**
 * Puts the photos in the given order; the first becomes the cover. `ids`
 * must be exactly the property's photos, so a stale list from another tab
 * is refused rather than half applied.
 */
export async function reorderPhotos(
  propertyId: string,
  ids: string[],
): Promise<PhotoDto[] | "mismatch"> {
  const done = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM properties WHERE id = ${propertyId}::uuid FOR UPDATE`;
    const current = await tx.propertyPhoto.findMany({
      where: { propertyId },
      select: { id: true },
    });
    const known = new Set(current.map((p) => p.id));
    if (
      ids.length !== known.size ||
      new Set(ids).size !== ids.length ||
      !ids.every((id) => known.has(id))
    ) {
      return false;
    }
    for (const [position, id] of ids.entries()) {
      await tx.propertyPhoto.update({ where: { id }, data: { position } });
    }
    return true;
  });
  return done ? listPhotos(propertyId) : "mismatch";
}

/** Removes a photo and, when nothing else uses them, its files. */
export async function deletePhoto(propertyId: string, photoId: string): Promise<boolean> {
  const photo = await db.propertyPhoto.findFirst({
    where: { id: photoId, propertyId },
    include: { sizes: true },
  });
  if (!photo) return false;
  await db.propertyPhoto.delete({ where: { id: photoId } });
  await removeIfUnreferenced(photo.sizes.map((s) => s.sha256));
  return true;
}

/**
 * The stored file behind `file` (`<sha256>.webp`) if it is a size of one of
 * the property's photos, else null: the file routes serve nothing else.
 */
export async function photoFileOf(propertyId: string, file: string): Promise<string | null> {
  const sha256 = FILE.exec(file)?.[1];
  if (!sha256) return null;
  const size = await db.propertyPhotoSize.findFirst({
    where: { sha256, photo: { propertyId } },
    select: { sha256: true },
  });
  return size?.sha256 ?? null;
}
