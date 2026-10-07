"use client";

import { LogOut } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { type CurrentUser, initials } from "@/lib/session";

/**
 * Signed-in user, with a sign-out action.
 *
 * TODO(#45): the sign-out item posts to Auth.js's route, which does not exist
 * until Google OAuth lands. It is a plain form submit rather than an onClick so
 * that it keeps working without JavaScript once the route is real.
 */
export function UserMenu({ user }: { user: CurrentUser }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="hover:bg-sidebar-accent/50 flex w-full items-center gap-3 rounded-control p-2 text-left text-sm transition-colors"
        aria-label={`Account menu for ${user.name}`}
      >
        <Avatar className="size-8 shrink-0">
          {user.image ? <AvatarImage src={user.image} alt="" /> : null}
          <AvatarFallback>{initials(user.name)}</AvatarFallback>
        </Avatar>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{user.name}</span>
          <span className="text-muted-foreground block truncate text-xs">{user.email}</span>
        </span>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="font-normal">
          <span className="block truncate">{user.name}</span>
          <span className="text-muted-foreground block truncate text-xs">{user.email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {/* A real form with a submit button, so signing out keeps working
            without JavaScript. This shadcn style is built on Base UI, whose
            composition prop is `render`, not Radix style `asChild`. */}
        <form action="/api/auth/signout" method="post">
          <DropdownMenuItem render={<button type="submit" />} className="w-full gap-2">
            <LogOut aria-hidden className="size-4" />
            Sign out
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
