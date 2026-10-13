import Link from "next/link";
import { getTranslations } from "next-intl/server";

/**
 * The public booking site (GitLab #105): pages for guests, without a
 * session. No app shell, no account menu, nothing that reads a session -
 * the proxy does not pass the session cookie on to these pages anyway.
 * The footer links the legal pages (GitLab #112).
 */
export default async function PublicLayout({ children }: LayoutProps<"/">) {
  const t = await getTranslations("legal");
  return (
    <div className="bg-background text-foreground flex min-h-dvh flex-col">
      <div className="flex-1">{children}</div>
      <footer className="text-muted-foreground mx-auto w-full max-w-3xl px-4 py-6 text-sm">
        <nav aria-label={t("footer")} className="flex gap-4">
          <Link href="/stay/legal/imprint" className="underline">
            {t("imprint.title")}
          </Link>
          <Link href="/stay/legal/privacy" className="underline">
            {t("privacy.title")}
          </Link>
        </nav>
      </footer>
    </div>
  );
}
