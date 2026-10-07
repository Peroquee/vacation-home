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
  label: string;
  icon: LucideIcon;
};

/**
 * One list, rendered by both the desktop sidebar and the mobile bottom bar, so
 * the two can never drift apart.
 */
export const NAV_ITEMS: NavItem[] = [
  { href: "/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/bookings", label: "Bookings", icon: ClipboardList },
  { href: "/finance", label: "Finance", icon: Wallet },
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/settings", label: "Settings", icon: Settings },
];

/**
 * A nav entry is active for its own route and anything nested under it, so
 * /bookings/42 still marks "Bookings".
 */
export function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
