import Link from "next/link";
import { getTranslations } from "next-intl/server";

/**
 * The public booking site (GitLab #105): pages for guests, without a
 * session. No app shell, no account menu, nothing that reads a session -
 * the proxy does not pass the session cookie on to these pages anyway.
 * The footer links the legal pages (GitLab #112) and, discreetly, the
 * owner's sign-in (GitLab #117).
 */
export default async function PublicLayout({ children }: LayoutProps<"/">) {
  const t = await getTranslations("legal");
  return (
    <div className="bg-background text-foreground flex min-h-dvh flex-col">
      <div className="flex-1">{children}</div>
      <footer className="text-muted-foreground mx-auto w-full max-w-3xl px-4 py-6 text-sm">
        <div className="flex flex-wrap gap-4">
          <nav aria-label={t("footer")} className="flex flex-wrap gap-x-4 gap-y-1">
            <Link href="/stay/legal/imprint" className="underline">
              {t("imprint.title")}
            </Link>
            <Link href="/stay/legal/privacy" className="underline">
              {t("privacy.title")}
            </Link>
            <Link href="/stay/legal/cookies" className="underline">
              {t("cookies.title")}
            </Link>
          </nav>
          {/* Not a legal page: on its own. A plain link; no session is read here. */}
          <Link href="/signin" prefetch={false} className="ms-auto">
            {t("ownerSignIn")}
          </Link>
        </div>
      </footer>
    </div>
  );
}
