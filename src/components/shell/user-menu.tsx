"use client";

import { Check, LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";

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
import { LOCALE_COOKIE, LOCALE_NAMES, LOCALES } from "@/i18n/locales";
import { signOutAction } from "@/lib/auth-actions";
import { initials } from "@/lib/initials";
import { type CurrentUser } from "@/lib/session";

/** Signed-in user, with the language choice and a sign-out action. */
export function UserMenu({ user }: { user: CurrentUser }) {
  const t = useTranslations("shell.userMenu");
  const locale = useLocale();
  const router = useRouter();

  function chooseLanguage(next: string) {
    // Remembered for a year on this browser; the server reads it on every
    // request (src/i18n/request.ts), so a refresh re-renders in the new language.
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="hover:bg-sidebar-accent/50 flex w-full items-center gap-3 rounded-control p-2 text-left text-sm transition-colors"
        aria-label={t("trigger", { name: user.name })}
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
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-muted-foreground text-xs">
            {t("language")}
          </DropdownMenuLabel>
          {LOCALES.map((option) => (
            <DropdownMenuItem
              key={option}
              lang={option}
              className="gap-2"
              aria-current={option === locale ? "true" : undefined}
              onClick={() => chooseLanguage(option)}
            >
              <Check aria-hidden className={option === locale ? "size-4" : "invisible size-4"} />
              {LOCALE_NAMES[option]}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        {/* A server action, so Auth.js handles CSRF and deletes the session
            row. The item renders as a real submit button (Base UI defaults
            nativeButton to false, which would attach non-native handlers). */}
        <form action={signOutAction}>
          <DropdownMenuItem render={<button type="submit" />} className="w-full gap-2">
            <LogOut aria-hidden className="size-4" />
            {t("signOut")}
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
