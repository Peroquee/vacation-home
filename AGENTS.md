<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Help and the user guide

Every text a user reads exists in German and English, and a change updates
both in the same MR: the message catalogues (`messages/`), the page help
(`help/de-DE/`, `help/en-GB/`) and the user guide (`docs/user-guide.md`,
`docs/user-guide.de-DE.md`, German headings keeping the English anchors as
`{#anchor}`). `node scripts/check-messages.mjs` and
`node scripts/check-help.mjs` check them; see the README's Languages part.
