import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Owner-written Markdown on the public site (GitLab #112): the Impressum's
 * addition and the privacy policy. Rendered as React elements, never as
 * HTML: raw HTML in the text is dropped, only plain text elements are
 * allowed (no images, which would load from elsewhere and tell that site
 * who reads the page), and links go only to http(s) and mailto - any other
 * scheme (javascript:, data:) loses its link and stays plain text.
 */
const ALLOWED = [
  "p",
  "br",
  "strong",
  "em",
  "del",
  "a",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "ul",
  "ol",
  "li",
  "blockquote",
  "code",
  "pre",
  "hr",
];

/**
 * The link target when it is http(s), mailto, a section of the same page,
 * or a page of this site ("/stay/legal/cookies"; never "//", another host),
 * else nothing.
 */
export function safeHref(url: string): string {
  const value = url.trim();
  return /^(https?:\/\/|mailto:)/i.test(value) ||
    /^#[\w-]+$/.test(value) ||
    /^\/(?!\/)[\w\-./#]*$/.test(value)
    ? value
    : "";
}

/** A heading's anchor, as GitHub makes them: "Booking platforms (iCal)" -> "booking-platforms-ical". */
export function headingId(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/\s/g, "-");
}

const textOf = (node: React.ReactNode): string =>
  typeof node === "string" || typeof node === "number"
    ? String(node)
    : Array.isArray(node)
      ? node.map(textOf).join("")
      : node && typeof node === "object" && "props" in node
        ? textOf((node as { props: { children?: React.ReactNode } }).props.children)
        : "";

const components: Components = {
  a: ({ href, children }) =>
    href ? (
      <a
        href={href}
        className="underline"
        {...(/^https?:/i.test(href) && { rel: "noopener noreferrer nofollow" })}
      >
        {children}
      </a>
    ) : (
      <>{children}</>
    ),
  h1: ({ children }) => <h2 className="mt-6 text-xl font-semibold">{children}</h2>,
  h2: ({ children }) => <h2 className="mt-6 text-xl font-semibold">{children}</h2>,
  h3: ({ children }) => <h3 className="mt-4 text-lg font-semibold">{children}</h3>,
  ul: ({ children }) => <ul className="list-disc space-y-1 ps-6">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal space-y-1 ps-6">{children}</ol>,
  blockquote: ({ children }) => (
    <blockquote className="border-s-4 ps-4 italic">{children}</blockquote>
  ),
};

/** A heading's own anchor, `## Finanzen {#finance}`: the German user guide keeps the English ones (GitLab #128). */
const EXPLICIT = /\s*\{#([a-z0-9-]+)\}\s*$/;

/** The heading's id, and its text without an explicit `{#id}`. */
function anchorOf(children: React.ReactNode): { id: string; children: React.ReactNode } {
  const parts = Array.isArray(children) ? [...children] : [children];
  const last = parts.at(-1);
  const explicit = typeof last === "string" ? EXPLICIT.exec(last) : null;
  if (!explicit) return { id: headingId(textOf(children)), children };
  parts[parts.length - 1] = (last as string).slice(0, explicit.index);
  return { id: explicit[1]!, children: parts };
}

/** Headings with anchors, for a long document such as the user guide. */
const anchored: Components = {
  h2: ({ children }) => {
    const anchor = anchorOf(children);
    return (
      <h2 id={anchor.id} className="mt-8 scroll-mt-4 text-xl font-semibold">
        {anchor.children}
      </h2>
    );
  },
  h3: ({ children }) => {
    const anchor = anchorOf(children);
    return (
      <h3 id={anchor.id} className="mt-6 scroll-mt-4 text-lg font-semibold">
        {anchor.children}
      </h3>
    );
  },
};

export function SafeMarkdown({
  children,
  anchors = false,
}: {
  children: string;
  /** Give h2 and h3 ids, for links to their sections. */
  anchors?: boolean;
}) {
  return (
    <div className="space-y-3 leading-relaxed">
      <Markdown
        skipHtml
        allowedElements={ALLOWED}
        unwrapDisallowed
        urlTransform={safeHref}
        components={anchors ? { ...components, ...anchored } : components}
        // Tables and the like, for the user guide; the owner's own texts too.
        remarkPlugins={[remarkGfm]}
      >
        {children}
      </Markdown>
    </div>
  );
}
