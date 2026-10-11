/**
 * Serving a stored photo size. Server-side only. The name is the content's
 * hash, so a URL's bytes never change: cached for a year. The public site's
 * copies may be cached anywhere; the owner's only by the browser.
 */
import { notFound } from "@/lib/api";
import { readStoredFile } from "@/lib/files/store";

export async function photoFileResponse(
  sha256: string,
  audience: "public" | "private",
): Promise<Response> {
  let bytes: Buffer;
  try {
    bytes = await readStoredFile(sha256);
  } catch {
    return notFound("Photo");
  }
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "image/webp",
      "Content-Length": String(bytes.length),
      "Cache-Control": `${audience}, max-age=31536000, immutable`,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
