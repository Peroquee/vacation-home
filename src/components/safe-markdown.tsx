import Markdown, { type Components } from "react-markdown";

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

/** The link target when it is http(s) or mailto, else nothing. */
export function safeHref(url: string): string {
  const value = url.trim();
  return /^(https?:\/\/|mailto:)/i.test(value) ? value : "";
}

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

export function SafeMarkdown({ children }: { children: string }) {
  return (
    <div className="space-y-3 leading-relaxed">
      <Markdown
        skipHtml
        allowedElements={ALLOWED}
        unwrapDisallowed
        urlTransform={safeHref}
        components={components}
      >
        {children}
      </Markdown>
    </div>
  );
}
