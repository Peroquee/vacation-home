/**
 * Authentication: Auth.js with Google, sessions stored in the database.
 *
 * - Only verified Google accounts on AUTH_ALLOWED_EMAILS may sign in; the
 *   proxy re-checks the list on every request.
 * - The Google client is the one Calendar sync will reuse, so sign-in asks
 *   for offline access and the refresh token is stored on the account, and
 *   refreshed on every later sign-in.
 *
 * The configuration is a function so that it is read per request, never at
 * import: `next build` imports this module without any configuration.
 */
import { PrismaAdapter } from "@auth/prisma-adapter";
import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

import { env } from "@/env";
import { isAllowedEmail } from "@/lib/allowed-emails";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

export const SIGN_IN_PATH = "/signin";

export const { handlers, auth, signIn, signOut } = NextAuth(() => ({
  // The adapter is typed against @prisma/client; this app's client is
  // generated elsewhere but has exactly the models the adapter uses.
  adapter: PrismaAdapter(db as unknown as Parameters<typeof PrismaAdapter>[0]),
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
      authorization: {
        params: {
          scope: "openid email profile",
          // A refresh token, and a fresh one on every consent, so the stored
          // token can always be replaced with a working one.
          access_type: "offline",
          prompt: "consent",
        },
      },
    }),
  ],
  callbacks: {
    signIn({ profile }) {
      const allowed = profile?.email_verified === true && isAllowedEmail(profile.email);
      // Turned into /signin?error=AccessDenied, which explains it.
      if (!allowed)
        logger.warn({ email: profile?.email }, "sign-in refused: not on the allow-list");
      return allowed;
    },
    session({ session, user }) {
      session.user.id = user.id;
      return session;
    },
  },
  events: {
    // The adapter stores tokens only when an account is first linked. Keep
    // them current on later sign-ins, so the refresh token is never stale.
    async signIn({ account }) {
      if (account?.provider !== "google" || !account.refresh_token) return;
      await db.account.updateMany({
        where: { provider: "google", providerAccountId: account.providerAccountId },
        data: {
          refresh_token: account.refresh_token,
          access_token: account.access_token,
          expires_at: account.expires_at,
          scope: account.scope,
          id_token: account.id_token,
          token_type: account.token_type,
        },
      });
    },
  },
  // Through the scrubbing logger: Auth.js errors can carry tokens.
  logger: {
    error: (error) => logger.error({ err: error }, "auth error"),
    warn: (code) => logger.warn({ code }, "auth warning"),
    debug: () => {},
  },
}));
