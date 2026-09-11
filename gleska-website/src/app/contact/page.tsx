"use client";

import React from "react";
import Link from "next/link";
import { ArrowLeft, MessageCircle, Zap } from "lucide-react";
import Navbar from "@/components/landing/Navbar";
import ContactUsSection from "@/components/landing/ContactUsSection";
import { useLanguage } from "@/context/LanguageContext";

export default function ContactPage() {
  const { t } = useLanguage();
  return (
    <div className="relative min-h-screen overflow-x-clip bg-[#eef1fb] font-sans text-slate-900 selection:bg-indigo-500 selection:text-white dark:bg-slate-950 dark:text-slate-100">
      {/* ── NAV ── */}
      <Navbar />

      {/* ── HERO HEADER ── */}
      <section className="relative overflow-hidden bg-gradient-to-br from-indigo-600 via-blue-600 to-indigo-700 text-white">
        {/* Decorative blobs */}
        <div className="pointer-events-none absolute -right-32 -top-32 h-96 w-96 rounded-full bg-white/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-20 -left-20 h-72 w-72 rounded-full bg-indigo-400/20 blur-3xl" />
        <div className="pointer-events-none absolute right-1/4 top-1/2 h-48 w-48 rounded-full bg-blue-300/10 blur-2xl" />

        <div className="relative z-10 mx-auto max-w-7xl px-6 py-16 sm:py-20 md:py-24">
          <Link
            href="/"
            className="mb-8 inline-flex items-center gap-1.5 text-sm font-semibold text-white/70 transition hover:text-white"
          >
            <ArrowLeft size={16} /> {t('contact.backHome')}
          </Link>

          <div className="max-w-3xl space-y-5">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-white/90 backdrop-blur">
              <MessageCircle size={14} />
              {t('contact.heroBadge')}
            </div>
            <h1 className="font-[var(--font-anton)] text-5xl uppercase leading-[0.95] tracking-wide sm:text-6xl md:text-8xl">
              {t('contact.heroTitle').split(' ').slice(0, 2).join(' ')}{" "}
              <span className="bg-gradient-to-r from-amber-300 to-yellow-300 bg-clip-text text-transparent">
                {t('contact.heroTitle').split(' ').slice(-1)[0]}
              </span>
            </h1>
            <p className="max-w-xl text-lg font-medium leading-relaxed text-white/75 md:text-xl">
              {t('contact.heroSubtitle')}
            </p>
          </div>
        </div>
      </section>

      {/* ── SHARED CONTACT US SECTION (Cards + Form + FAQs) ── */}
      <ContactUsSection showHeader={false} />

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
            {t('footer.subtitle')}
          </p>

          <div className="flex w-full flex-col items-center justify-between gap-4 border-t border-white/15 pt-6 text-sm font-semibold text-white/60 md:flex-row">
            <div className="flex gap-6">
              <Link href="#" className="transition-colors hover:text-white">
                {t('nav.privacyPolicy')}
              </Link>
              <Link href="/terms" className="transition-colors hover:text-white">
                {t('nav.termsOfService')}
              </Link>
              <Link href="/contact" className="text-white/80 transition-colors hover:text-white">
                {t('nav.contact')}
              </Link>
            </div>
            <p className="text-amber-300">{t('nav.bharat')}</p>
          </div>
        </div>
      </footer>
    </div>
  );
}