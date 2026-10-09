import {
  CalendarDays,
  ClipboardList,
  LayoutDashboard,
  Settings,
  Wallet,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  href: string;
  /** The label's key in the `nav` messages. */
  label: "calendar" | "bookings" | "finance" | "dashboard" | "settings";
  icon: LucideIcon;
};

/**
 * One list, rendered by both the desktop sidebar and the mobile bottom bar, so
 * the two can never drift apart.
 */
export const NAV_ITEMS: NavItem[] = [
  { href: "/calendar", label: "calendar", icon: CalendarDays },
  { href: "/bookings", label: "bookings", icon: ClipboardList },
  { href: "/finance", label: "finance", icon: Wallet },
  { href: "/dashboard", label: "dashboard", icon: LayoutDashboard },
  { href: "/settings", label: "settings", icon: Settings },
];

/**
 * A nav entry is active for its own route and anything nested under it, so
 * /bookings/42 still marks "Bookings".
 */
export function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
