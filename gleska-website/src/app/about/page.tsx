"use client";

import React from "react";
import Link from "next/link";
import { Zap } from "lucide-react";
import Navbar from "@/components/landing/Navbar";
import AboutSection from "@/components/landing/AboutSection";

export default function AboutPage() {
  return (
    <div className="relative min-h-screen overflow-x-clip bg-[#eef1fb] font-sans text-slate-900 selection:bg-indigo-500 selection:text-white dark:bg-slate-950 dark:text-slate-100">
      {/* ── NAV ── */}
      <Navbar />

      {/* ── ABOUT SECTION ── */}
      <AboutSection />

      {/* ── FOOTER ── */}
      <footer className="bg-gradient-to-br from-indigo-700 via-blue-700 to-indigo-800 px-6 pb-8 pt-16 text-white">
        <div className="mx-auto flex max-w-7xl flex-col items-center space-y-6 text-center">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/15 backdrop-blur">
              <Zap size={18} className="text-white" fill="currentColor" />
            </div>
            <span className="font-[var(--font-anton)] text-2xl uppercase tracking-wide">GO LESKA</span>
          </div>
          <p className="max-w-md text-sm font-medium text-white/60">
            Building the AI brain for businesses and industries — intelligent infrastructure that grows with
            your organization.
          </p>
          <div className="flex w-full flex-col items-center justify-between gap-4 border-t border-white/15 pt-6 text-sm font-semibold text-white/60 md:flex-row">
            <div className="flex gap-6">
              <Link href="#" className="transition-colors hover:text-white">
                Privacy Policy
              </Link>
              <Link href="/terms" className="transition-colors hover:text-white">
                Terms of Service
              </Link>
              <Link href="/#contact" className="transition-colors hover:text-white">
                Contact
              </Link>
            </div>
            <p className="text-amber-300"> BHARAT </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
