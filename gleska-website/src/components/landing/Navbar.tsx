"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { User, LayoutDashboard, LogOut, ArrowLeft, Menu, X } from "lucide-react";
import LanguageSelector from "@/components/landing/LanguageSelector";
import { useAuth } from "@/context/AuthContext";
import { getRouteForNextStep } from "@/lib/auth-routing";
import { useLanguage } from "@/context/LanguageContext";

export default function Navbar({
  rightAction,
}: {
  rightAction?: React.ReactNode;
}) {
  const pathname = usePathname();
  const { user, nextStep, logout, isLoggingOut } = useAuth();
  const { t } = useLanguage();
  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false);
  const [currentQuery, setCurrentQuery] = React.useState("");
  const containerRef = React.useRef<HTMLDivElement>(null);

  const dashboardHref = user ? getRouteForNextStep(user.role, nextStep) : "/auth/signin";
  const isDashboardActive =
    pathname.startsWith("/employer") ||
    pathname.startsWith("/worker") ||
    pathname === dashboardHref;

  // Track client search params safely
  React.useEffect(() => {
    if (typeof window !== "undefined") {
      setCurrentQuery(window.location.search);
    }
  }, [pathname]);

  // Auto-close mobile menu on route change
  React.useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname]);

  // Handle Escape key and outside clicks to close mobile menu
  React.useEffect(() => {
    if (!mobileMenuOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileMenuOpen(false);
    };

    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setMobileMenuOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousedown", handleClickOutside);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [mobileMenuOpen]);

  // Unified single source of truth for navigation links across public and auth, desktop and mobile
  const navLinks = [
    { href: "/", label: t('nav.home') || "Home", active: pathname === "/" },
    { href: "/about", label: t('nav.about') || "About", active: pathname === "/about" },
    { href: "/#services", label: t('nav.services') || "Services", active: false },
    { href: "/get-hired", label: t('nav.getHired') || "Get Hired", active: pathname === "/get-hired" },
    { href: "/contact", label: t('nav.contact') || "Contact", active: pathname === "/contact" },
    { href: "/terms", label: t('nav.terms') || "Terms", active: pathname === "/terms" },
  ];

  const contextualActionClass = (isMobile: boolean, tone: "default" | "danger" = "default") =>
    `inline-flex ${isMobile ? "min-h-10 w-full" : "min-h-9"} items-center justify-center gap-1.5 rounded-full border ${
      tone === "danger"
        ? "border-slate-200 bg-white text-rose-600 hover:border-rose-300 hover:bg-rose-50 dark:border-slate-700 dark:bg-slate-800 dark:text-rose-400 dark:hover:border-rose-500 dark:hover:bg-rose-950/30"
        : "border-slate-200 bg-white text-slate-700 hover:border-indigo-300 hover:text-indigo-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:border-indigo-500 dark:hover:text-indigo-400"
    } px-3.5 py-1.5 text-sm font-semibold transition disabled:cursor-wait disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900`;

  // Unified contextual right-side action rendering
  const renderContextualAction = (isMobile = false) => {
    // 1. Explicit rightAction (e.g. Admin Login "Back to home")
    if (rightAction) {
      return rightAction;
    }

    // 2. Authenticated user (Public or Auth page): Dashboard + Logout
    if (user) {
      if (isMobile) {
        return (
          <div className="grid grid-cols-2 gap-2">
            <Link
              href={dashboardHref}
              onClick={() => setMobileMenuOpen(false)}
              className={contextualActionClass(true)}
            >
              <LayoutDashboard size={15} />
              <span>{t('nav.dashboard') || "Dashboard"}</span>
            </Link>
            <button
              type="button"
              onClick={() => {
                setMobileMenuOpen(false);
                void logout();
              }}
              disabled={isLoggingOut}
              className={contextualActionClass(true, "danger")}
            >
              <LogOut size={15} />
              <span>{t('nav.logout') || "Logout"}</span>
            </button>
          </div>
        );
      }

      return (
        <div className="flex items-center gap-2">
          <Link
            href={dashboardHref}
            className={`${contextualActionClass(false)} ${
              isDashboardActive ? "border-indigo-500 text-indigo-600 dark:border-indigo-500 dark:text-indigo-400" : ""
            }`}
          >
            <LayoutDashboard size={15} />
            <span className="whitespace-nowrap">{t('nav.dashboard') || "Dashboard"}</span>
          </Link>
          <button
            type="button"
            onClick={() => void logout()}
            disabled={isLoggingOut}
            className={contextualActionClass(false, "danger")}
            title={t('nav.logout') || "Logout"}
          >
            <LogOut size={15} />
            <span className="whitespace-nowrap">{t('nav.logout') || "Logout"}</span>
          </button>
        </div>
      );
    }

    // 3. Unauthenticated on Password Reset / Forgot Password
    if (pathname === "/auth/forgot-password" || pathname === "/auth/reset-password") {
      return (
        <Link
          href="/auth/signin"
          onClick={() => {
            setCurrentQuery("");
            if (isMobile) setMobileMenuOpen(false);
          }}
          className={contextualActionClass(isMobile)}
        >
          <ArrowLeft size={14} />
          <span>{t('shared.returnToSignIn') || "Back to Sign In"}</span>
        </Link>
      );
    }

    // Account switching stays in the auth page content, not in the navbar.
    if (pathname === "/auth/signin") {
      const isSignupSelection = currentQuery.includes("mode=signup");
      if (isSignupSelection) {
        return (
          <Link
            href="/auth/signin"
            onClick={() => {
              setCurrentQuery("");
              if (isMobile) setMobileMenuOpen(false);
            }}
            className={contextualActionClass(isMobile)}
          >
            <User size={15} />
            <span>{t('nav.signIn') || "Sign In"}</span>
          </Link>
        );
      }
      return null;
    }

    // Worker and Employer signup actions stay in their auth forms.
    if (pathname === "/worker/auth" || pathname === "/employer/auth") {
      const isSignup = currentQuery.includes("mode=signup");
      if (isSignup) {
        return (
          <Link
            href="/auth/signin"
            onClick={() => isMobile && setMobileMenuOpen(false)}
            className={contextualActionClass(isMobile)}
          >
            <User size={15} />
            <span>{t('nav.signIn') || "Sign In"}</span>
          </Link>
        );
      }
      return null;
    }

    // 6. Default (Public pages: /, /about, /contact, /get-hired, /terms) -> "Sign In"
    return (
      <Link
        href="/auth/signin"
        onClick={() => isMobile && setMobileMenuOpen(false)}
        className={`${contextualActionClass(isMobile)} ${
          pathname === "/auth/signin" ? "border-indigo-500 text-indigo-600 dark:border-indigo-500 dark:text-indigo-400" : ""
        }`}
      >
        <User size={15} />
        <span>{t('nav.signIn') || "Sign In"}</span>
      </Link>
    );
  };

  // Shared desktop navigation links
  const desktopNavLinksMarkup = (
    <div className="hidden items-center gap-6 lg:gap-8 text-sm lg:text-base font-bold tracking-wide text-slate-700 md:flex dark:text-slate-200">
      {navLinks.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className={`transition-all hover:text-indigo-600 dark:hover:text-indigo-400 ${
            link.active ? "text-indigo-600 dark:text-indigo-400" : ""
          }`}
        >
          {link.label}
        </Link>
      ))}
    </div>
  );

  const mobileContextualAction = renderContextualAction(true);

  // Shared mobile menu drawer
  const mobileDrawerMarkup = mobileMenuOpen && (
    <div className="mx-auto mt-2 max-w-[1360px] overflow-hidden rounded-3xl border border-slate-200/90 bg-white/95 p-4 shadow-2xl backdrop-blur-xl md:hidden dark:border-slate-800/90 dark:bg-slate-900/95">
      <div className="flex flex-col space-y-1">
        {navLinks.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            onClick={() => setMobileMenuOpen(false)}
            className={`flex items-center rounded-xl px-4 py-2.5 text-sm font-bold transition-colors ${
              link.active
                ? "bg-indigo-50 text-indigo-600 dark:bg-indigo-950/50 dark:text-indigo-300"
                : "text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
            }`}
          >
            {link.label}
          </Link>
        ))}
      </div>

      {mobileContextualAction && (
        <div className="mt-3 border-t border-slate-200/80 pt-3 dark:border-slate-800">
          {mobileContextualAction}
        </div>
      )}
    </div>
  );

  // Public and auth pages share the same floating pill navigation.
  return (
    <div ref={containerRef} className="sticky top-4 z-50 px-4 sm:px-8">
      <nav className="mx-auto flex max-w-[1360px] items-center justify-between rounded-full border border-slate-200/80 bg-white/95 px-4 py-2.5 sm:px-8 sm:py-3.5 shadow-xl shadow-slate-900/5 backdrop-blur-md dark:border-slate-800/80 dark:bg-slate-900/95 dark:shadow-black/20">
        <Link href="/" className="flex items-center gap-2 sm:gap-3.5">
          <img src="/favicon.ico" alt="GO LESKA AI" className="h-8 w-8 sm:h-9 sm:w-9 rounded-lg object-contain" />
          <span className="font-[var(--font-anton)] text-xl sm:text-3xl uppercase tracking-wider bg-[linear-gradient(180deg,#E86100_0%,#FFF5EA_48%,#128807_100%)] bg-clip-text text-transparent select-none whitespace-nowrap">
            GO LESKA AI
          </span>
        </Link>

        {desktopNavLinksMarkup}

        <div className="flex items-center gap-2 sm:gap-3">
          <LanguageSelector />
          {renderContextualAction()}

          {/* Mobile hamburger toggle button */}
          <button
            type="button"
            onClick={() => setMobileMenuOpen((open) => !open)}
            aria-label={mobileMenuOpen ? "Close navigation menu" : "Open navigation menu"}
            aria-expanded={mobileMenuOpen}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 transition hover:border-indigo-300 hover:text-indigo-600 md:hidden dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:border-indigo-500 dark:hover:text-indigo-400"
          >
            {mobileMenuOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>
      </nav>

      {mobileDrawerMarkup}
    </div>
  );
}
