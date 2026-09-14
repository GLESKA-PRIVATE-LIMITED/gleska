"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  Building2,
  Briefcase,
  CreditCard,
  MapPin,
  PanelLeft,
  LogOut,
  X,
  Shield,
} from "lucide-react";

interface AdminShellProps {
  name?: string;
  email?: string | null;
  onLogout: () => void;
  children: React.ReactNode;
}

const adminNavItems = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard },
  { href: "/admin/workers", label: "Workers", icon: Users },
  { href: "/admin/employers", label: "Employers", icon: Building2 },
  { href: "/admin/jobs", label: "Jobs", icon: Briefcase },
  { href: "/admin/payments", label: "Payments", icon: CreditCard },
  { href: "/admin/locations", label: "Locations", icon: MapPin },
];

export default function AdminShell({
  name = "Administrator",
  email,
  onLogout,
  children,
}: AdminShellProps) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const pathname = usePathname();

  const isLinkActive = (href: string) => {
    if (href === "/admin") {
      return pathname === "/admin";
    }
    return pathname === href || pathname.startsWith(`${href}/`);
  };

  const closeMobile = () => setIsMobileMenuOpen(false);

  return (
    <div className="flex min-h-screen flex-col bg-[#eef1fb] font-sans text-slate-900 md:flex-row">
      {/* Desktop Sidebar */}
      <aside
        className={`sticky top-0 z-40 hidden h-screen shrink-0 flex-col justify-between border-r border-slate-200 bg-white/95 p-4 shadow-xs backdrop-blur transition-all duration-300 md:flex ${
          isSidebarOpen ? "w-64" : "w-20 items-center"
        }`}
      >
        <div className="w-full space-y-6">
          {/* Top Logo & Collapse Toggle */}
          <div
            className={`flex items-center gap-2 ${
              isSidebarOpen ? "justify-between px-1" : "justify-center"
            }`}
          >
            {isSidebarOpen ? (
              <>
                <Link href="/admin" className="flex items-center gap-2 min-w-0">
                  <img
                    src="/favicon.ico"
                    alt="GO LESKA AI"
                    className="h-7 w-7 rounded-lg object-contain shrink-0"
                  />
                  <span className="font-[var(--font-anton)] text-xl uppercase tracking-wider bg-[linear-gradient(180deg,#E86100_0%,#FFF5EA_48%,#128807_100%)] bg-clip-text text-transparent select-none whitespace-nowrap">
                    GO LESKA AI
                  </span>
                </Link>
                <button
                  type="button"
                  onClick={() => setIsSidebarOpen(false)}
                  title="Collapse sidebar"
                  aria-label="Collapse sidebar"
                  className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900 transition cursor-pointer"
                >
                  <PanelLeft size={19} />
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setIsSidebarOpen(true)}
                title="Expand sidebar"
                aria-label="Expand sidebar"
                className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900 transition cursor-pointer"
              >
                <PanelLeft size={19} />
              </button>
            )}
          </div>

          {/* Navigation Links */}
          <nav className="w-full space-y-1.5">
            {adminNavItems.map(({ href, label, icon: Icon }) => {
              const active = isLinkActive(href);
              return (
                <Link
                  key={href}
                  href={href}
                  className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition ${
                    isSidebarOpen ? "" : "justify-center"
                  } ${
                    active
                      ? "bg-blue-50 text-blue-600 shadow-2xs"
                      : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                  }`}
                  title={label}
                >
                  <Icon size={19} className="shrink-0" />
                  {isSidebarOpen && <span>{label}</span>}
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Desktop Sidebar Bottom (Admin identity & Logout) */}
        <div className="w-full border-t border-slate-200 pt-4">
          <div
            className={`flex items-center gap-3 rounded-xl px-2 py-2 ${
              isSidebarOpen ? "" : "justify-center"
            }`}
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-sm font-bold text-white shadow-xs">
              {(name || "A").charAt(0).toUpperCase()}
            </div>
            {isSidebarOpen && (
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <p className="truncate text-sm font-bold text-slate-900">
                    {name}
                  </p>
                  <span className="inline-flex items-center gap-0.5 rounded-full bg-blue-50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-blue-700">
                    <Shield size={10} />
                    Admin
                  </span>
                </div>
                <p className="truncate text-xs text-slate-500">
                  {email || "Administrator"}
                </p>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={onLogout}
            className={`mt-2 flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm font-semibold text-rose-600 hover:bg-rose-50 transition cursor-pointer ${
              isSidebarOpen ? "" : "justify-center"
            }`}
            title="Log out"
          >
            <LogOut size={18} className="shrink-0" />
            {isSidebarOpen && <span>Log out</span>}
          </button>
        </div>
      </aside>

      {/* Mobile Top Header */}
      <div className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-200 bg-white/95 px-4 py-3 shadow-xs backdrop-blur md:hidden w-full">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            title="Toggle menu"
            aria-label="Toggle menu"
            className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 transition cursor-pointer"
          >
            {isMobileMenuOpen ? <X size={20} /> : <PanelLeft size={20} />}
          </button>
          <Link href="/admin" className="flex items-center gap-2">
            <img
              src="/favicon.ico"
              alt="GO LESKA AI"
              className="h-6 w-6 rounded-md object-contain"
            />
            <span className="font-[var(--font-anton)] text-lg uppercase tracking-wider bg-[linear-gradient(180deg,#E86100_0%,#FFF5EA_48%,#128807_100%)] bg-clip-text text-transparent select-none whitespace-nowrap">
              GO LESKA AI
            </span>
          </Link>
        </div>
        <span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-blue-700">
          Admin
        </span>
      </div>

      {/* Mobile Drawer Overlay */}
      {isMobileMenuOpen && (
        <div className="fixed inset-0 z-50 flex md:hidden">
          <div
            className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs transition-opacity"
            onClick={closeMobile}
          />
          <div className="relative z-10 flex w-72 max-w-[80vw] flex-col justify-between border-r border-slate-200 bg-white p-4 shadow-xl">
            <div className="space-y-6">
              <div className="flex items-center justify-between px-1">
                <Link
                  href="/admin"
                  onClick={closeMobile}
                  className="flex items-center gap-2"
                >
                  <img
                    src="/favicon.ico"
                    alt="GO LESKA AI"
                    className="h-6 w-6 rounded-md object-contain"
                  />
                  <span className="font-[var(--font-anton)] text-lg uppercase tracking-wider bg-[linear-gradient(180deg,#E86100_0%,#FFF5EA_48%,#128807_100%)] bg-clip-text text-transparent select-none whitespace-nowrap">
                    GO LESKA AI
                  </span>
                </Link>
                <button
                  type="button"
                  onClick={closeMobile}
                  className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 transition cursor-pointer"
                  title="Close navigation"
                >
                  <X size={20} />
                </button>
              </div>

              <nav className="space-y-1.5">
                {adminNavItems.map(({ href, label, icon: Icon }) => {
                  const active = isLinkActive(href);
                  return (
                    <Link
                      key={href}
                      href={href}
                      onClick={closeMobile}
                      className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition ${
                        active
                          ? "bg-blue-50 text-blue-600 shadow-2xs"
                          : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                      }`}
                    >
                      <Icon size={19} className="shrink-0" />
                      <span>{label}</span>
                    </Link>
                  );
                })}
              </nav>
            </div>

            <div className="border-t border-slate-200 pt-4">
              <div className="flex items-center gap-3 rounded-xl px-2 py-2">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-sm font-bold text-white shadow-xs">
                  {(name || "A").charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <p className="truncate text-sm font-bold text-slate-900">
                      {name}
                    </p>
                    <span className="inline-flex items-center gap-0.5 rounded-full bg-blue-50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-blue-700">
                      <Shield size={10} />
                      Admin
                    </span>
                  </div>
                  <p className="truncate text-xs text-slate-500">
                    {email || "Administrator"}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  closeMobile();
                  onLogout();
                }}
                className="mt-2 flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm font-semibold text-rose-600 hover:bg-rose-50 transition cursor-pointer"
              >
                <LogOut size={18} className="shrink-0" />
                <span>Log out</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}
