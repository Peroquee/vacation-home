import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { safeHref, SafeMarkdown } from "./safe-markdown";

const html = (text: string) => renderToStaticMarkup(<SafeMarkdown>{text}</SafeMarkdown>);

describe("owner-written Markdown on the public site", () => {
  it("renders headings, lists, emphasis and line breaks", () => {
    const out = html("# Title\n\n## Part\n\n- **one**\n- *two*\n\nA  \nB");
    // The page has its own h1: the text's start at h2.
    expect(out).toContain('<h2 class="mt-6 text-xl font-semibold">Title</h2>');
    expect(out).toContain("<strong>one</strong>");
    expect(out).toContain("<em>two</em>");
    expect(out).toContain("A<br/>");
    expect(out).not.toContain("<h1");
  });

  it("drops raw HTML, block and inline", () => {
    const out = html(
      '<script>alert(1)</script>\n\n<div onclick="x()">block</div>\n\nHi <img src=x onerror=alert(1)> <b>bold</b> there\n\n<!-- template -->',
    );
    expect(out).not.toMatch(/<script|<div onclick|<img|onerror|<b>|<!--/);
    expect(out).not.toContain("alert");
    expect(out).toContain("Hi");
    expect(out).toContain("there");
  });

  it("links only to http, https and mailto", () => {
    const out = html(
      [
        "[web](https://example.test/a) [plain](http://example.test)",
        "[mail](mailto:owner@example.test)",
        "[js](javascript:alert(1)) [JS](JaVaScRiPt:alert(1)) [data](data:text/html,x)",
        "[rel](/stay/legal/imprint) [vb](vbscript:x)",
        "<javascript:alert(1)>",
      ].join("\n\n"),
    );
    expect(out).toContain('href="https://example.test/a"');
    expect(out).toContain('href="http://example.test"');
    expect(out).toContain('href="mailto:owner@example.test"');
    expect(out).toContain('rel="noopener noreferrer nofollow"');
    expect(out).not.toMatch(/href="(javascript|data|vbscript):/i);
    // As text it is harmless: shown, never a target.
    expect(out).toContain("<p>javascript:alert(1)</p>");
    // Links within the site stay links (GitLab #124); "//" is another host.
    expect(out).toContain('href="/stay/legal/imprint"');
    expect(out.match(/<a /g)).toHaveLength(4);
    // The text of a refused link stays.
    expect(out).toContain("js");
    expect(out).toContain("rel");
  });

  it("shows no images, which would load from elsewhere", () => {
    const out = html("![tracker](https://tracker.test/pixel.png) after");
    expect(out).not.toContain("<img");
    expect(out).not.toContain("tracker.test");
    expect(out).toContain("after");
  });

  it("keeps a link's target only for the allowed schemes", () => {
    expect(safeHref(" https://example.test ")).toBe("https://example.test");
    expect(safeHref("MAILTO:a@b.test")).toBe("MAILTO:a@b.test");
    expect(safeHref("javascript:alert(1)")).toBe("");
    expect(safeHref("//evil.test")).toBe("");
    expect(safeHref("/stay/legal/cookies")).toBe("/stay/legal/cookies");
    expect(safeHref("/\\evil.test")).toBe("");
    expect(safeHref("tel:+49")).toBe("");
  });
});

// GitLab #128: the German guide keeps the English anchors, written out.
describe("headings with anchors, for the user guide", () => {
  const guide = (text: string) => renderToStaticMarkup(<SafeMarkdown anchors>{text}</SafeMarkdown>);

  it("anchor a heading by its text, as GitHub does", () => {
    expect(guide("## Booking platforms (iCal)")).toContain('id="booking-platforms-ical"');
  });

  it("take a written-out anchor, and leave it out of the text", () => {
    const out = guide(
      "## Buchungsplattformen (iCal) {#booking-platforms-ical}\n\n### Cookies {#cookies}",
    );
    expect(out).toMatch(/<h2 id="booking-platforms-ical"[^>]*>Buchungsplattformen \(iCal\)<\/h2>/);
    expect(out).toMatch(/<h3 id="cookies"[^>]*>Cookies<\/h3>/);
    expect(out).not.toContain("{#");
  });

  it("keep the written-out anchor after emphasis too", () => {
    expect(guide("## Die **Übersicht** {#dashboard}")).toMatch(
      /<h2 id="dashboard"[^>]*>Die <strong>Übersicht<\/strong><\/h2>/,
    );
  });
});
