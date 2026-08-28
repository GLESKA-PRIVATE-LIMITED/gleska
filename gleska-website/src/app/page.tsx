"use client";

import React from 'react';
import Link from 'next/link';
import { ArrowRight, ShieldCheck } from 'lucide-react';
import Navbar from '@/components/landing/Navbar';
import ServicesSection from '@/components/landing/ServicesSection';
import ContactUsSection from '@/components/landing/ContactUsSection';
import { useLanguage } from '@/context/LanguageContext';

export default function LandingPage() {
  const { t } = useLanguage();

  return (
    <div className="relative min-h-screen overflow-x-clip bg-[#eef1fb] font-sans text-slate-900 selection:bg-indigo-500 selection:text-white dark:bg-slate-950 dark:text-slate-100">

      {/* FLOATING PILL NAV */}
      <Navbar />

      {/* HERO SECTION */}
      <section className="relative mx-auto flex max-w-7xl flex-col items-center gap-10 px-6 py-16 sm:py-24 md:flex-row md:gap-12 md:py-28">
        <div className="relative z-10 w-full flex-1 space-y-7">
          <h1 className="font-[var(--font-anton)] text-5xl uppercase leading-[0.95] tracking-wide text-slate-900 sm:text-6xl md:text-8xl dark:text-white">
            {t('hero.titleLine1')}<br />
            {t('hero.titleLine2')}<br />
            <span className="bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">{t('hero.titleLine3')}</span>
          </h1>
          <p className="max-w-xl text-lg font-medium leading-relaxed text-slate-600 md:text-xl dark:text-slate-300">
            {t('hero.subtitle')}
          </p>
          <div className="flex flex-col gap-4 pt-2 sm:flex-row">
            <Link href="/worker/auth" className="inline-flex items-center justify-center gap-2 rounded-full bg-gradient-to-r from-blue-600 to-indigo-600 px-8 py-4 text-base font-bold text-white shadow-lg shadow-indigo-500/25 transition hover:from-blue-700 hover:to-indigo-700">
              {t('hero.ctaWorker')} <ArrowRight size={20} />
            </Link>
            <Link href="/employer/auth" className="inline-flex items-center justify-center gap-2 rounded-full border border-slate-200 bg-white px-8 py-4 text-base font-bold text-slate-700 shadow-sm transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700">
              {t('hero.ctaEmployer')} <ArrowRight size={20} />
            </Link>
          </div>
        </div>

        {/* HERO IMAGE / INTERACTIVE COMPONENT */}
        <div className="relative h-[360px] w-full flex-1 overflow-hidden rounded-2xl shadow-xl shadow-slate-300/50 sm:h-[440px] md:h-[500px]">
          <img src="/hero.jpg" alt="Industrial workers at a refinery at sunset" className="absolute inset-0 h-full w-full object-cover" />
          <div className="absolute inset-0 z-10 bg-gradient-to-t from-slate-900/70 to-transparent"></div>

          {/* Match badge overlay */}
          <div className="absolute bottom-6 left-6 z-20 inline-flex w-max max-w-[calc(100%-3rem)] items-center gap-3 rounded-full bg-white/95 py-2 pl-2 pr-5 shadow-lg backdrop-blur">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 text-white">
              <ShieldCheck size={18} />
            </div>
            <span className="text-sm font-bold text-slate-900">{t('hero.verifiedBadge')}</span>
          </div>
        </div>
      </section>

      {/* SERVICES SECTION */}
      <ServicesSection />

      {/* CONTACT SECTION (SHARED SINGLE SOURCE OF TRUTH) */}
      <ContactUsSection />

      {/* FOOTER CTA */}
      <footer className="bg-gradient-to-br from-indigo-700 via-blue-700 to-indigo-800 px-6 pb-8 pt-20 text-white">
        <div className="mx-auto flex max-w-7xl flex-col items-center space-y-7 text-center">
          <h2 className="font-[var(--font-anton)] text-4xl uppercase sm:text-5xl md:text-7xl">{t('footer.title')}</h2>
          <p className="max-w-lg text-lg font-medium text-white/80">{t('footer.subtitle')}</p>

          <div className="mt-4 flex w-full max-w-md">
            <span className="inline-flex items-center rounded-l-full border border-r-0 border-white/20 bg-white/15 px-4 text-lg font-bold text-white">
              +91
            </span>
            <input type="tel" placeholder={t('footer.placeholder')} className="min-w-0 flex-1 border-y border-white/20 bg-white/10 px-4 py-3.5 text-lg font-semibold text-white outline-none placeholder:text-white/50" />
            <button className="shrink-0 rounded-r-full bg-amber-400 px-5 py-3.5 font-[var(--font-anton)] text-lg uppercase tracking-wider text-slate-900 transition hover:bg-amber-300 sm:px-6">
              {t('footer.getAppBtn')}
            </button>
          </div>

          <div className="mt-20 flex w-full flex-col items-center justify-between gap-4 border-t border-white/15 pt-8 text-sm font-semibold text-white/60 md:flex-row">
            <div className="flex gap-6">
              <Link href="#" className="transition-colors hover:text-white">{t('footer.privacy')}</Link>
              <Link href="#" className="transition-colors hover:text-white">{t('footer.terms')}</Link>
              <Link href="/contact" className="transition-colors hover:text-white">{t('footer.contact')}</Link>
            </div>
            <p className="text-amber-300">{t('footer.madeIn')}</p>
          </div>
        </div>
      </footer>

    </div>
  );
}
