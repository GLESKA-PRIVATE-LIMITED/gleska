"use client";

import React from "react";
import Image from "next/image";
import Link from "next/link";
import { User, LogOut, Home } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useRouter } from "next/navigation";

interface AgentProfileProps {
  isCollapsed?: boolean;
  onLogout?: () => void | Promise<void>;
  closeMobile?: () => void;
  profileHref?: string;
  onProfileClick?: () => void;
  roleLabel?: string;
}

export default function AgentProfile({
  isCollapsed = false,
  onLogout,
  closeMobile,
  profileHref,
  onProfileClick,
  roleLabel,
}: AgentProfileProps) {
  const { user, logout } = useAuth();
  const router = useRouter();

  const userName = user?.name || (user as any)?.full_name || "User";
  const userRole = user?.role === "EMPLOYER"
    ? "Employer"
    : user?.role === "WORKER"
      ? "Worker"
      : "User";
  const identityHref = profileHref || (user?.role === "EMPLOYER"
    ? "/employer/company-profile"
    : user?.role === "WORKER"
      ? "/worker/profile"
      : "/");
  const displayRole = roleLabel || userRole;

  const handleProfileClick = (e: React.MouseEvent) => {
    if (closeMobile) closeMobile();
    if (onProfileClick) {
      e.preventDefault();
      onProfileClick();
    }
  };

  const handleLogout = async () => {
    if (closeMobile) closeMobile();
    if (onLogout) {
      await onLogout();
    } else {
      await logout();
    }
    router.replace("/");
  };

  return (
    <div className="relative border-t border-slate-200 pt-3 dark:border-slate-800">
      <Link
        href={identityHref}
        onClick={handleProfileClick}
        title={`${userName} · ${displayRole}`}
        className={`flex min-w-0 items-center gap-3 rounded-xl px-2 py-2 transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:hover:bg-slate-800 ${
          isCollapsed ? "justify-center" : ""
        }`}
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-blue-600 text-sm font-bold text-white shadow-xs">
          {user?.profile_photo_url ? (
            <Image
              src={user.profile_photo_url}
              alt=""
              width={40}
              height={40}
              unoptimized
              className="h-full w-full object-cover"
            />
          ) : (
            userName.charAt(0).toUpperCase() || <User size={20} />
          )}
        </span>
        {!isCollapsed && (
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-bold text-slate-900 dark:text-white">
              {userName}
            </span>
            <span className="block truncate text-xs text-slate-500 dark:text-slate-400">
              {displayRole}
            </span>
          </span>
        )}
      </Link>

      <div className="mt-2 space-y-1 border-t border-slate-100 pt-2 dark:border-slate-800/80">
        <Link
          href="/"
          onClick={closeMobile}
          title={isCollapsed ? "Back to Home" : undefined}
          className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-slate-200 dark:hover:bg-slate-800 ${
            isCollapsed ? "justify-center px-0" : ""
          }`}
        >
          <Home size={17} className="shrink-0 text-slate-500 dark:text-slate-400" />
          {!isCollapsed && <span>Back to Home</span>}
        </Link>
        <button
          type="button"
          onClick={() => void handleLogout()}
          title={isCollapsed ? "Log out" : undefined}
          className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm font-semibold text-red-600 transition hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 dark:text-red-400 dark:hover:bg-red-950/40 ${
            isCollapsed ? "justify-center px-0" : ""
          }`}
        >
          <LogOut size={17} className="shrink-0" />
          {!isCollapsed && <span>Log out</span>}
        </button>
      </div>
    </div>
  );
}
