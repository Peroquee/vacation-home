import type { Metadata } from "next";

import { LegalPage, legalMetadata } from "../legal-page";

export function generateMetadata(): Promise<Metadata> {
  return legalMetadata("privacy");
}

export default function Page() {
  return <LegalPage page="privacy" />;
}
