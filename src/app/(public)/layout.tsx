/**
 * The public booking site (GitLab #105): pages for guests, without a
 * session. No app shell, no account menu, nothing that reads a session -
 * the proxy does not pass the session cookie on to these pages anyway.
 */
export default function PublicLayout({ children }: LayoutProps<"/">) {
  return <div className="bg-background text-foreground min-h-dvh">{children}</div>;
}
