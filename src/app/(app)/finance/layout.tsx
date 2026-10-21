import { FinanceTabs } from "./finance-tabs";

/** Every Finance page starts with its tabs (GitLab #130). */
export default function FinanceLayout({ children }: LayoutProps<"/finance">) {
  return (
    <>
      <FinanceTabs />
      {children}
    </>
  );
}
