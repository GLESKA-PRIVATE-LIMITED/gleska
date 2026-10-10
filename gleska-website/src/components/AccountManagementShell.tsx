"use client";

import React from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import {
  Briefcase,
  Building2,
  CreditCard,
  FileText,
  Home,
  HelpCircle,
  LayoutDashboard,
  LogOut,
  PanelLeft,
  ShieldCheck,
  ShoppingCart,
  User,
  Users,
  X,
  Clock,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";

interface AccountManagementShellProps {
  kind: "employer" | "worker";
  name: string;
  accountLabel: string;
  /** Employer account type retained for caller compatibility. */
  employerType?: string | null;
  /** Direct href for the profile identity block. */
  profileHref?: string;
  profilePhotoUrl?: string | null;
  onPostJob?: () => void;
  onLogout: () => void | Promise<void>;
  children: React.ReactNode;
}

export function formatEmployerType(value?: string | null): string {
  const labels: Record<string, string> = {
    INDIVIDUAL: "Individual Employer",
    REGISTERED_BUSINESS: "Registered Business",
    REGISTERED_INDUSTRY: "Registered Industry",
    UNREGISTERED_BUSINESS: "Unregistered Business",
  };
  return (value && labels[value]) || "Employer";
}

export default function AccountManagementShell({
  kind,
  name,
  accountLabel,
  profileHref,
  profilePhotoUrl,
  onPostJob,
  onLogout,
  children,
}: AccountManagementShellProps) {
  const [isSidebarOpen, setIsSidebarOpen] = React.useState(true);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = React.useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const { user } = useAuth();

  const employer = kind === "employer";
  const dashboardHref = employer ? "/employer/dashboard" : "/worker/dashboard";
  const identityHref = profileHref || (employer ? "/employer/company-profile" : "/worker/profile");
  const closeMobile = () => setIsMobileMenuOpen(false);
  const handleShellLogout = async () => {
    await onLogout();
    router.replace("/");
  };

  const renderAccountActions = (mobile = false) => (
    <div className="mt-3 space-y-1.5 border-t border-slate-200 pt-3 dark:border-slate-800">
      <Link
        href="/"
        onClick={mobile ? closeMobile : undefined}
        className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-slate-200 dark:hover:bg-slate-800"
      >
        <Home size={17} className="shrink-0 text-slate-500 dark:text-slate-400" />
        <span>Back to Home</span>
      </Link>
      <button
        type="button"
        onClick={() => {
          if (mobile) closeMobile();
          void handleShellLogout();
        }}
        className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm font-semibold text-red-600 transition hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 dark:text-red-400 dark:hover:bg-red-950/40"
      >
        <LogOut size={17} className="shrink-0" />
        <span>Log out</span>
      </button>
    </div>
  );

  const employerNav = [
    { href: "/employer/dashboard", label: "Dashboard", icon: LayoutDashboard, isPage: true },
    { href: "/employer/dashboard#create-job", label: "Post a Job & Sites", icon: Briefcase, isPage: false },
    { href: "/procurement", label: "Procurement Agent", icon: ShoppingCart, isPage: true },
    { href: "/supplier", label: "Supplier Workspace", icon: Building2, isPage: true },
    { href: "/employer/workers", label: "Workers", icon: Users, isPage: true },
    { href: "/employer/attendance", label: "Attendance", icon: Clock, isPage: true },
    { href: "/employer/subscription", label: "Subscription", icon: CreditCard, isPage: true },
    { href: "/employer/security", label: "Security & Settings", icon: ShieldCheck, isPage: true },
  ];

  const workerNav = [
    { href: dashboardHref, label: "Dashboard", icon: LayoutDashboard, isPage: true },
    { href: "/worker/attendance", label: "Attendance", icon: Clock, isPage: true },
    { href: "/worker/companies-worked", label: "Companies Worked", icon: Building2, isPage: true },
    { href: "/worker/documents", label: "Documents", icon: FileText, isPage: true },
    { href: "/worker/subscription", label: "Subscription", icon: CreditCard, isPage: true },
    { href: "/worker/settings-security", label: "Settings & Security", icon: ShieldCheck, isPage: true },
    { href: "/supplier", label: "Supplier Workspace", icon: Building2, isPage: true },
  ];

  const helpHref = employer ? "/employer/help" : "/worker/help";
  const navigation = employer ? employerNav : workerNav;

  const linkIsActive = (href: string) => {
    if (!href) return false;
    if (href.includes("#")) return false;
    const path = href.split("#")[0];
    if (path === dashboardHref) return pathname === dashboardHref;
    return pathname === path || pathname.startsWith(`${path}/`);
  };

  const linkClass = (
    href: string,
    mobile: boolean,
    base = "text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white",
  ) =>
    `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition ${
      linkIsActive(href) ? "bg-blue-600 text-white shadow-xs" : base
    } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${!isSidebarOpen && !mobile ? "justify-center" : ""}`;

  const renderLinks = (mobile = false) => (
    <div className="space-y-1.5">
      {navigation.map(({ href, label, icon: Icon, isPage }) => (
        href.includes("#") && pathname === dashboardHref && onPostJob ? (
          <button
            key={label}
            type="button"
            onClick={() => {
              if (mobile) closeMobile();
              onPostJob();
            }}
            className={`${linkClass("", mobile)} w-full`}
            title={label}
          >
            <Icon size={19} className="shrink-0" />
            {(isSidebarOpen || mobile) && <span>{label}</span>}
          </button>
        ) : (
          <Link
            key={label}
            href={href}
            onClick={mobile ? closeMobile : undefined}
            aria-current={isPage && linkIsActive(href) ? "page" : undefined}
            className={linkClass(isPage ? href : "", mobile)}
            title={label}
          >
            <Icon size={19} className="shrink-0" />
            {(isSidebarOpen || mobile) && <span>{label}</span>}
          </Link>
        )
      ))}
      <Link
        href={helpHref}
        onClick={mobile ? closeMobile : undefined}
        className={linkClass(helpHref, mobile)}
        title="Help"
      >
        <HelpCircle size={19} className="shrink-0" />
        {(isSidebarOpen || mobile) && <span>Help</span>}
      </Link>
    </div>
  );

  const renderProfileIdentity = (mobile = false) => {
    const active = linkIsActive(identityHref);
    const photoUrl = profilePhotoUrl !== undefined ? profilePhotoUrl : user?.profile_photo_url;
    return (
      <Link
        href={identityHref}
        onClick={mobile ? closeMobile : undefined}
        aria-current={active ? "page" : undefined}
        title={`${name} · ${employer ? accountLabel : "Worker"}`}
        className={`flex min-w-0 items-center gap-3 rounded-xl px-2 py-2 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
          active
            ? "bg-blue-50 ring-1 ring-blue-200 dark:bg-blue-950/40 dark:ring-blue-900"
            : "hover:bg-slate-100 dark:hover:bg-slate-800"
        } ${!isSidebarOpen && !mobile ? "justify-center" : ""}`}
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-blue-600 text-sm font-bold text-white shadow-xs">
          {photoUrl ? (
            <Image src={photoUrl} alt="" width={40} height={40} unoptimized className="h-full w-full object-cover" />
          ) : (
            name.charAt(0).toUpperCase() || <User size={20} />
          )}
        </span>
        {(isSidebarOpen || mobile) && (
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-bold text-slate-900 dark:text-white">{name}</span>
            <span className="block truncate text-xs text-slate-500 dark:text-slate-400">
              {employer ? accountLabel : "Worker"}
            </span>
          </span>
        )}
      </Link>
    );
  };

  // Bottom section for desktop sidebar
  const renderDesktopBottom = () => {
    return (
      <div className="relative border-t border-slate-200 pt-4 dark:border-slate-800">
        {renderProfileIdentity()}
        {renderAccountActions()}
      </div>
    );
  };

  // Bottom section for mobile drawer
  const renderMobileBottom = () => {
    return (
      <div className="relative border-t border-slate-200 pt-4 dark:border-slate-800">
        {renderProfileIdentity(true)}
        {renderAccountActions(true)}
      </div>
    );
  };

  return (
    <div className="flex min-h-screen flex-col bg-[#eef1fb] font-sans text-slate-900 dark:bg-slate-950 dark:text-slate-100 md:flex-row">
      {/* Desktop sidebar */}
      <aside
        className={`sticky top-0 z-40 hidden h-screen shrink-0 flex-col justify-between border-r border-slate-200 bg-white p-4 transition-all dark:border-slate-800 dark:bg-slate-900 md:flex ${
          isSidebarOpen ? "w-64" : "w-20"
        }`}
      >
        <div className="w-full space-y-6">
          <div className={`flex items-center ${isSidebarOpen ? "justify-between" : "justify-center"}`}>
            {isSidebarOpen && (
              <Link
                href={dashboardHref}
                className="font-(--font-anton) text-xl uppercase tracking-wider text-slate-900 dark:text-white"
              >
                GO LESKA AI
              </Link>
            )}
            <button
              type="button"
              onClick={() => setIsSidebarOpen((open) => !open)}
              className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              title="Toggle sidebar"
            >
              <PanelLeft size={19} />
            </button>
          </div>
          <nav>{renderLinks()}</nav>
        </div>
        {renderDesktopBottom()}
      </aside>

      {/* Main content */}
      <div className="flex-1 min-w-0">
        {/* Mobile top bar */}
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900 md:hidden">
          <button
            type="button"
            onClick={() => setIsMobileMenuOpen(true)}
            className="rounded-lg p-2 text-slate-600 dark:text-slate-300"
            title="Open navigation"
          >
            <PanelLeft size={20} />
          </button>
          <Link
            href={dashboardHref}
            className="font-(--font-anton) text-xl uppercase tracking-wider text-slate-900 dark:text-white"
          >
            GO LESKA AI
          </Link>
          <span className="w-9" />
        </header>

        {/* Mobile drawer */}
        {isMobileMenuOpen && (
          <div className="fixed inset-0 z-50 flex md:hidden">
            <button
              type="button"
              className="absolute inset-0 bg-slate-900/50"
              onClick={closeMobile}
              aria-label="Close navigation"
            />
            <div className="relative z-10 flex h-full w-72 max-w-[80vw] flex-col justify-between overflow-y-auto border-r border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <div>
                <div className="mb-6 flex items-center justify-between">
                  <Link
                    href={dashboardHref}
                    onClick={closeMobile}
                    className="font-(--font-anton) text-xl uppercase tracking-wider text-slate-900 dark:text-white"
                  >
                    GO LESKA AI
                  </Link>
                  <button type="button" onClick={closeMobile} title="Close navigation">
                    <X size={20} />
                  </button>
                </div>
                <nav>{renderLinks(true)}</nav>
              </div>
              {renderMobileBottom()}
            </div>
          </div>
        )}

        {children}
      </div>
    </div>
  );
}
