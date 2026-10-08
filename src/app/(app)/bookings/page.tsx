import Link from "next/link";

import { PageHeader } from "@/components/page-header";
import { buttonVariants } from "@/components/ui/button";

export default function BookingsPage() {
  return (
    <PageHeader
      title="Bookings"
      description="Placeholder. The booking list arrives with #56."
      actions={
        <Link href="/bookings/new" className={buttonVariants()}>
          New booking
        </Link>
      }
    />
  );
}
