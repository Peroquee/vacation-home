import { AppShell } from "@/components/shell/app-shell";

/** Every signed-in page renders inside the shell; the sign-in page does not. */
export default function AppLayout({ children }: LayoutProps<"/">) {
  return <AppShell>{children}</AppShell>;
}
