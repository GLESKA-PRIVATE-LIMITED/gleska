"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { User } from "lucide-react";
import LanguageSelector from "@/components/landing/LanguageSelector";

export default function Navbar() {
  const pathname = usePathname();

  return (
    <div className="sticky top-4 z-50 px-4 sm:px-8">
      <nav className="mx-auto flex max-w-[1360px] items-center justify-between rounded-full border border-slate-200/80 bg-white/95 px-4 py-3 sm:px-8 sm:py-4 shadow-xl shadow-slate-900/5 backdrop-blur-md dark:border-slate-800/80 dark:bg-slate-900/95 dark:shadow-black/20">
        <Link href="/" className="flex items-center gap-2 sm:gap-3.5">
          <img src="/favicon.ico" alt="GO LESKA AI" className="h-8 w-8 sm:h-9 sm:w-9 rounded-lg object-contain" />
          <span className="font-[var(--font-anton)] text-xl sm:text-3xl uppercase tracking-wider bg-[linear-gradient(180deg,#E86100_0%,#FFF5EA_48%,#128807_100%)] bg-clip-text text-transparent select-none whitespace-nowrap">
            GO LESKA AI
          </span>
        </Link>
        <div className="hidden items-center gap-9 text-base font-bold tracking-wide text-slate-700 md:flex dark:text-slate-200">
          <Link
            href="/#services"
            className="transition-all hover:text-indigo-600 dark:hover:text-indigo-400"
          >
            Services
          </Link>
          <Link
            href="/get-hired"
            className={`transition-all hover:text-indigo-600 dark:hover:text-indigo-400 ${
              pathname === "/get-hired" ? "text-indigo-600 dark:text-indigo-400" : ""
            }`}
          >
            Get Hired
          </Link>
          <Link
            href="/contact"
            className={`transition-all hover:text-indigo-600 dark:hover:text-indigo-400 ${
              pathname === "/contact" ? "text-indigo-600 dark:text-indigo-400" : ""
            }`}
          >
            Contact
          </Link>
          <Link
            href="/about"
            className={`transition-all hover:text-indigo-600 dark:hover:text-indigo-400 ${
              pathname === "/about" ? "text-indigo-600 dark:text-indigo-400" : ""
            }`}
          >
            About
          </Link>
          <Link
            href="/terms"
            className={`transition-all hover:text-indigo-600 dark:hover:text-indigo-400 ${
              pathname === "/terms" ? "text-indigo-600 dark:text-indigo-400" : ""
            }`}
          >
            Terms
          </Link>
        </div>
        <div className="flex items-center gap-2 sm:gap-4">
          <LanguageSelector />
          <Link
            href="/auth/signin"
            className={`flex items-center justify-center gap-1.5 rounded-full border border-slate-200 bg-white p-2 sm:px-3.5 sm:py-2 text-sm font-semibold text-slate-600 transition hover:border-indigo-300 hover:text-indigo-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:border-indigo-500 dark:hover:text-indigo-400 ${
              pathname === "/auth/signin" ? "border-indigo-500 text-indigo-600 dark:border-indigo-500 dark:text-indigo-400" : ""
            }`}
          >
            <User size={16} />
            <span className="hidden sm:inline whitespace-nowrap">Sign In</span>
          </Link>
        </div>
      </nav>
    </div>
  );
}
