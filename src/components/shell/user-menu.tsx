"use client";

import { LogOut } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { signOutAction } from "@/lib/auth-actions";
import { initials } from "@/lib/initials";
import { type CurrentUser } from "@/lib/session";

/** Signed-in user, with a sign-out action. */
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
        {/* The label is a Base UI group label, which throws outside a group -
            opening the menu crashed the page before this was wrapped. */}
        <DropdownMenuGroup>
          <DropdownMenuLabel className="font-normal">
            <span className="block truncate">{user.name}</span>
            <span className="text-muted-foreground block truncate text-xs">{user.email}</span>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        {/* A server action, so Auth.js handles CSRF and deletes the session
            row. The item renders as a real submit button (Base UI defaults
            nativeButton to false, which would attach non-native handlers). */}
        <form action={signOutAction}>
          <DropdownMenuItem render={<button type="submit" />} className="w-full gap-2">
            <LogOut aria-hidden className="size-4" />
            Sign out
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
