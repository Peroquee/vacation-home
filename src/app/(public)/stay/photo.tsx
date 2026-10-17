import type { PublicPhotoDto } from "@/lib/properties/public";

/**
 * A listed property's photo on the public site (GitLab #106): the browser
 * picks the size it needs from `srcset`.
 */
export function Photo({
  photo,
  alt,
  sizes,
  className,
  priority = false,
}: {
  photo: PublicPhotoDto;
  alt: string;
  sizes: string;
  className: string;
  priority?: boolean;
}) {
  const largest = photo.sizes.at(-1)!;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- already resized to fixed widths; next/image would resize again
    <img
      src={largest.url}
      srcSet={photo.sizes.map((s) => `${s.url} ${s.width}w`).join(", ")}
      sizes={sizes}
      width={largest.width}
      height={largest.height}
      alt={alt}
      loading={priority ? "eager" : "lazy"}
      fetchPriority={priority ? "high" : "auto"}
      decoding="async"
      className={`bg-muted w-full object-cover ${className}`}
    />
  );
}
