"use client";

import React, { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Navbar from '@/components/landing/Navbar';
import GetHiredSection from '@/components/landing/GetHiredSection';
import ServicesSection from '@/components/landing/ServicesSection';
import AboutSection from '@/components/landing/AboutSection';
import ContactUsSection from '@/components/landing/ContactUsSection';
import { useLanguage } from '@/context/LanguageContext';

export default function LandingPage() {
  const { t } = useLanguage();
  const router = useRouter();

  return (
    <div className="relative min-h-screen overflow-x-clip bg-[#eef1fb] font-sans text-slate-900 selection:bg-indigo-500 selection:text-white dark:bg-slate-950 dark:text-slate-100">

      {/* FLOATING PILL NAV */}
      <Navbar />

      {/* 1. SERVICES SECTION */}
      <ServicesSection />

      {/* 2. GET HIRED / JOIN AS WORKING PARTNER SECTION */}
      <GetHiredSection />

      {/* 3. CONTACT US SECTION */}
      <ContactUsSection />

      {/* 4. ABOUT SECTION */}
      <AboutSection />

      {/* FOOTER CTA */}
      <footer className="bg-gradient-to-br from-indigo-700 via-blue-700 to-indigo-800 px-6 pb-8 pt-20 text-white">
        <div className="mx-auto flex max-w-7xl flex-col items-center space-y-7 text-center">
          <h2 className="font-[var(--font-anton)] text-4xl uppercase sm:text-5xl md:text-7xl">{t('footer.title')}</h2>
          <p className="max-w-lg text-lg font-medium text-white/80">{t('footer.subtitle')}</p>

          <div className="mt-4 flex w-full max-w-md">
            <span className="inline-flex items-center rounded-l-full border border-r-0 border-white/20 bg-white/15 px-4 text-lg font-bold text-white">
              +91
            </span>
            <input
              type="tel"
              placeholder={t('footer.placeholder')}
              className="w-full bg-white/15 px-4 py-3.5 text-base font-semibold text-white placeholder-white/60 outline-none backdrop-blur focus:bg-white/25"
            />
            <button className="whitespace-nowrap rounded-r-full bg-white px-7 text-base font-bold text-slate-900 transition hover:bg-slate-100">
              {t('footer.getAppBtn')}
            </button>
          </div>

          <div className="flex w-full flex-col items-center justify-between gap-4 border-t border-white/15 pt-8 text-sm font-semibold text-white/60 md:flex-row">
            <div className="flex gap-6">
              <a href="#" className="transition-colors hover:text-white">{t('footer.privacy')}</a>
              <a href="/terms" className="transition-colors hover:text-white">{t('footer.terms')}</a>
              <a href="/contact" className="transition-colors hover:text-white">{t('footer.contact')}</a>
            </div>
            <p className="text-amber-300">{t('footer.madeIn')}</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
