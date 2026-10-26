/**
 * Authentication: Auth.js with Google, sessions stored in the database.
 *
 * - Only verified Google accounts on AUTH_ALLOWED_EMAILS may sign in; the
 *   proxy re-checks the list on every request.
 * - Sign-in asks Google for identity only. Calendar access is a separate,
 *   incremental grant made from settings (src/lib/google/connection.ts), so
 *   no OAuth token from sign-in is ever stored.
 *
 * The configuration is a function so that it is read per request, never at
 * import: `next build` imports this module without any configuration.
 */
import "server-only";

import { PrismaAdapter } from "@auth/prisma-adapter";
import NextAuth, { type NextAuthConfig } from "next-auth";
import type { Adapter } from "next-auth/adapters";
import Google from "next-auth/providers/google";

import { env } from "@/env";
import { isAllowedEmail, maskEmail } from "@/lib/allowed-emails";
import { db } from "@/lib/db";
import { SIGN_IN_SCOPES } from "@/lib/google/oauth";
import { logger } from "@/lib/logger";

export const SIGN_IN_PATH = "/signin";

/** The session cookie's names: over https it carries the __Secure- prefix. */
export const SESSION_COOKIES = ["authjs.session-token", "__Secure-authjs.session-token"];

/**
 * The Prisma adapter, minus the tokens: sign-in tokens are never used, and a
 * token not kept cannot leak. The account row only links Google to the user.
 */
function adapter(): Adapter {
  // Typed against @prisma/client; this app's client is generated elsewhere
  // but has exactly the models the adapter uses.
  const base = PrismaAdapter(db as unknown as Parameters<typeof PrismaAdapter>[0]);
  return {
    ...base,
    linkAccount: (account) =>
      base.linkAccount!({
        ...account,
        access_token: undefined,
        refresh_token: undefined,
        id_token: undefined,
        expires_at: undefined,
      }),
  };
}

/**
 * Auth.js builds its URLs (sign-in, the OAuth callback) from AUTH_URL when
 * set, else from the request. Behind a reverse proxy (Caddy, tailscale
 * serve) the standalone server sees itself as 0.0.0.0:3000 whatever the
 * forwarded headers say, so it always gets the public address: AUTH_URL if
 * given, else APP_URL. Auth.js reads it from process.env itself, after
 * this configuration is built on each request.
 */
function setAuthUrl() {
  // eslint-disable-next-line no-restricted-properties -- written for Auth.js, from the validated env
  process.env.AUTH_URL = env.AUTH_URL ?? env.APP_URL;
}

export const { handlers, auth, signIn, signOut } = NextAuth(() => {
  setAuthUrl();
  return config();
});

function config(): NextAuthConfig {
  return {
    adapter: adapter(),
    secret: env.AUTH_SECRET,
    // Self-hosted behind our own reverse proxy, not on a platform Auth.js
    // recognises; APP_URL is where it is served.
    trustHost: true,
    session: { strategy: "database", maxAge: 30 * 24 * 60 * 60 },
    pages: { signIn: SIGN_IN_PATH, error: SIGN_IN_PATH },
    providers: [
      Google({
        clientId: env.AUTH_GOOGLE_ID,
        clientSecret: env.AUTH_GOOGLE_SECRET,
        // Identity only: no calendar, no offline access (see the top of this file).
        // select_account: after a refusal, the next try can pick another
        // account rather than the same one again (GitLab #122).
        authorization: { params: { scope: SIGN_IN_SCOPES, prompt: "select_account" } },
      }),
    ],
    callbacks: {
      async signIn({ profile }) {
        const allowed = profile?.email_verified === true && (await isAllowedEmail(profile.email));
        if (allowed) return true;
        // One warning, no stack (GitLab #122), and only the masked address:
        // a stranger's email is personal data we have no reason to keep.
        const account = profile?.email ? maskEmail(profile.email) : null;
        logger.warn({ account }, "sign-in refused: account not allowed");
        // The sign-in page explains it, naming the account by its mask.
        const refused = new URLSearchParams({ error: "AccessDenied" });
        if (account) refused.set("account", account);
        return `${SIGN_IN_PATH}?${refused}`;
      },
      session({ session, user }) {
        session.user.id = user.id;
        return session;
      },
    },
    // Through the scrubbing logger: Auth.js errors can carry tokens.
    logger: {
      error: (error) => {
        // A refused sign-in is no error: it is logged once, as a warning, above.
        if (error.name === "AccessDenied" || (error as { type?: string }).type === "AccessDenied") {
          return;
        }
        logger.error({ err: error }, "auth error");
      },
      warn: (code) => logger.warn({ code }, "auth warning"),
      debug: () => {},
    },
  };
}
