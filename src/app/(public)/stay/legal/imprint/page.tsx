import type { Metadata } from "next";

import { LegalPage, legalMetadata } from "../legal-page";

export function generateMetadata(): Promise<Metadata> {
  return legalMetadata("imprint");
}

export default function Page() {
  return <LegalPage page="imprint" />;
}
