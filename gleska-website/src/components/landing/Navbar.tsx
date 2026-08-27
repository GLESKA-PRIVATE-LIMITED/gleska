"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import LanguageSelector from "@/components/landing/LanguageSelector";

export default function Navbar() {
  const pathname = usePathname();

  return (
    <div className="sticky top-4 z-50 px-4 sm:px-8">
      <nav className="mx-auto flex max-w-[1360px] items-center justify-between rounded-full border border-slate-200/80 bg-white/95 px-8 py-4 shadow-xl shadow-slate-900/5 backdrop-blur-md dark:border-slate-800/80 dark:bg-slate-900/95 dark:shadow-black/20">
        <Link href="/" className="flex items-center gap-3.5">
          <img src="/favicon.ico" alt="GO LESKA AI" className="h-9 w-9 rounded-lg object-contain" />
          <span className="font-[var(--font-anton)] text-2xl sm:text-3xl uppercase tracking-wider bg-[linear-gradient(180deg,#E86100_0%,#FFF5EA_48%,#128807_100%)] bg-clip-text text-transparent select-none">
            GO LESKA AI
          </span>
        </Link>
        <div className="hidden items-center gap-9 text-base font-bold tracking-wide text-slate-700 md:flex dark:text-slate-200">
          <Link
            href="/contact"
            className={`transition-all hover:text-indigo-600 dark:hover:text-indigo-400 ${
              pathname === "/contact" ? "text-indigo-600 dark:text-indigo-400" : ""
            }`}
          >
            Contact Us
          </Link>
          <Link
            href="/about"
            className={`transition-all hover:text-indigo-600 dark:hover:text-indigo-400 ${
              pathname === "/about" ? "text-indigo-600 dark:text-indigo-400" : ""
            }`}
          >
            About Us
          </Link>
        </div>
        <div className="flex items-center gap-4">
          <LanguageSelector />
        </div>
      </nav>
    </div>
  );
}
