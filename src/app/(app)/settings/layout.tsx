import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";

/**
 * The settings pages' client components read the `settings` messages,
 * which the root layout leaves out of every other page (GitLab #112): this
 * provides them here, with the rest.
 */
export default async function SettingsLayout({ children }: LayoutProps<"/settings">) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- left out on purpose
  const { email, ...messages } = await getMessages();
  return <NextIntlClientProvider messages={messages}>{children}</NextIntlClientProvider>;
}
