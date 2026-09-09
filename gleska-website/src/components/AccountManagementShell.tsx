"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Briefcase, Building2, CreditCard, FileText, HelpCircle, LayoutDashboard, LogOut, MapPin, PanelLeft, Settings, ShieldCheck, User, Users, X, Clock } from "lucide-react";

interface AccountManagementShellProps {
  kind: "employer" | "worker";
  name: string;
  accountLabel: string;
  profileHref: string;
  onLogout: () => void;
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

export default function AccountManagementShell({ kind, name, accountLabel, profileHref, onLogout, children }: AccountManagementShellProps) {
  const [isSidebarOpen, setIsSidebarOpen] = React.useState(true);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = React.useState(false);
  const pathname = usePathname();

  const employer = kind === "employer";
  const dashboardHref = employer ? "/employer/dashboard" : "/worker/dashboard";
  const closeMobile = () => setIsMobileMenuOpen(false);

  const navigation = employer
    ? [
        { href: dashboardHref, label: "Dashboard", icon: LayoutDashboard, isPage: true },
        { href: `${dashboardHref}#create-job`, label: "Post a Job", icon: Briefcase, isPage: false },
        { href: "/employer/workers", label: "Workers", icon: Users, isPage: true },
        { href: "/employer/attendance", label: "Attendance", icon: Clock, isPage: true },
        { href: dashboardHref, label: "Add Work Site", icon: MapPin, isPage: false },
      ]
    : [
        { href: dashboardHref, label: "Dashboard", icon: LayoutDashboard, isPage: true },
        { href: "/worker/attendance", label: "Attendance", icon: Clock, isPage: true },
        { href: "/worker/companies-worked", label: "Companies Worked", icon: Building2, isPage: true },
        { href: "/worker/documents", label: "Documents", icon: FileText, isPage: true },
        { href: "/worker/subscription", label: "Subscription", icon: CreditCard, isPage: true },
        { href: "/worker/security", label: "Security", icon: ShieldCheck, isPage: true },
        { href: "/worker/settings", label: "Settings", icon: Settings, isPage: true },
        { href: "/worker/help", label: "Help", icon: HelpCircle, isPage: true },
      ];

  const linkIsActive = (href: string) => {
    if (!href) return false;
    if (href.includes("#")) return false;
    const path = href.split("#")[0];
    if (path === dashboardHref) return pathname === dashboardHref && href === dashboardHref;
    return pathname === path || pathname.startsWith(`${path}/`);
  };

  const linkClass = (href: string, mobile: boolean, base = "text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white") => `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition ${linkIsActive(href) ? "bg-blue-600 text-white shadow-xs" : base} ${!isSidebarOpen && !mobile ? "justify-center" : ""}`;

  const renderLinks = (mobile = false) => (
    <>
      <div className="space-y-1.5">
        {navigation.map(({ href, label, icon: Icon, isPage }) => (
          <Link key={label} href={href} onClick={mobile ? closeMobile : undefined} className={linkClass(isPage ? href : "", mobile)} title={label}>
            <Icon size={19} className="shrink-0" />
            {(isSidebarOpen || mobile) && <span>{label}</span>}
          </Link>
        ))}
      </div>
      {employer && <>
        {(isSidebarOpen || mobile) && <p className="px-3 pt-5 text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">Account Management</p>}
        <div className="space-y-1.5 pt-2">
          <Link href="/employer/subscription" onClick={mobile ? closeMobile : undefined} className={linkClass("/employer/subscription", mobile)} title="Subscription"><CreditCard size={19} className="shrink-0" />{(isSidebarOpen || mobile) && <span>Subscription</span>}</Link>
          <Link href={profileHref} onClick={mobile ? closeMobile : undefined} className={linkClass(profileHref, mobile)} title="Profile"><User size={19} className="shrink-0" />{(isSidebarOpen || mobile) && <span>Profile</span>}</Link>
          <Link href="/employer/security" onClick={mobile ? closeMobile : undefined} className={linkClass("/employer/security", mobile)} title="Security"><ShieldCheck size={19} className="shrink-0" />{(isSidebarOpen || mobile) && <span>Security</span>}</Link>
          <Link href="/contact" onClick={mobile ? closeMobile : undefined} className={linkClass("/contact", mobile)} title="Help"><HelpCircle size={19} className="shrink-0" />{(isSidebarOpen || mobile) && <span>Help</span>}</Link>
        </div>
      </>}
    </>
  );

  return (
    <div className="flex min-h-screen flex-col bg-[#eef1fb] font-sans text-slate-900 dark:bg-slate-950 dark:text-slate-100 md:flex-row">
      <aside className={`sticky top-0 z-40 hidden h-screen shrink-0 flex-col justify-between border-r border-slate-200 bg-white/95 p-4 shadow-xs backdrop-blur transition-all dark:border-slate-800 dark:bg-slate-900/95 md:flex ${isSidebarOpen ? "w-64" : "w-20"}`}>
        <div className="w-full space-y-6">
          <div className={`flex items-center ${isSidebarOpen ? "justify-between" : "justify-center"}`}>
            {isSidebarOpen && <Link href={dashboardHref} className="font-(--font-anton) text-xl uppercase tracking-wider bg-[linear-gradient(180deg,#E86100_0%,#FFF5EA_48%,#128807_100%)] bg-clip-text text-transparent">GO LESKA AI</Link>}
            <button type="button" onClick={() => setIsSidebarOpen((open) => !open)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" title="Toggle sidebar"><PanelLeft size={19} /></button>
          </div>
          <nav>{renderLinks()}</nav>
        </div>
        <div className="border-t border-slate-200 pt-4 dark:border-slate-800">
          <Link href={profileHref} className={`mb-3 flex items-center gap-3 rounded-xl px-2 py-2 text-left transition hover:bg-slate-100 dark:hover:bg-slate-800 ${!isSidebarOpen ? "justify-center" : ""}`} title="Open profile">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-sm font-bold text-white">{name.charAt(0).toUpperCase()}</div>
            {isSidebarOpen && <div className="min-w-0"><p className="truncate text-sm font-bold">{name}</p><p className="truncate text-xs text-slate-500">{accountLabel}</p></div>}
          </Link>
          <button type="button" onClick={onLogout} className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/40 ${!isSidebarOpen ? "justify-center" : ""}`} title="Log out"><LogOut size={19} />{isSidebarOpen && <span>Log out</span>}</button>
        </div>
      </aside>

      <div className="flex-1 min-w-0">
        <header className="flex items-center justify-between border-b border-slate-200 bg-white/95 px-4 py-3 shadow-xs backdrop-blur dark:border-slate-800 dark:bg-slate-900/95 md:hidden">
          <button type="button" onClick={() => setIsMobileMenuOpen(true)} className="rounded-lg p-2 text-slate-600 dark:text-slate-300" title="Open navigation"><PanelLeft size={20} /></button>
          <Link href={dashboardHref} className="font-(--font-anton) text-xl uppercase tracking-wider bg-[linear-gradient(180deg,#E86100_0%,#FFF5EA_48%,#128807_100%)] bg-clip-text text-transparent">GO LESKA AI</Link>
          <span className="w-9" />
        </header>
        {isMobileMenuOpen && <div className="fixed inset-0 z-50 flex md:hidden"><button type="button" className="absolute inset-0 bg-slate-900/50" onClick={closeMobile} aria-label="Close navigation" /><div className="relative z-10 flex w-72 max-w-[80vw] flex-col justify-between border-r border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"><div><div className="mb-6 flex items-center justify-between"><Link href={dashboardHref} onClick={closeMobile} className="font-(--font-anton) text-xl uppercase tracking-wider bg-[linear-gradient(180deg,#E86100_0%,#FFF5EA_48%,#128807_100%)] bg-clip-text text-transparent">GO LESKA AI</Link><button type="button" onClick={closeMobile} title="Close navigation"><X size={20} /></button></div><nav>{renderLinks(true)}</nav></div><div className="space-y-3 border-t border-slate-200 pt-4 dark:border-slate-800"><Link href={profileHref} onClick={closeMobile} className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"><User size={19} className="shrink-0" />View profile</Link><button type="button" onClick={onLogout} className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-rose-600"><LogOut size={19} />Log out</button></div></div></div>}
        {children}
      </div>
    </div>
  );
}
