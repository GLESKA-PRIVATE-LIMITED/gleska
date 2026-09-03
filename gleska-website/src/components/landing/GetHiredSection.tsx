"use client";

import React from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";

export default function GetHiredSection() {
  const { t } = useLanguage();

  return (
    <section id="get-hired" className="relative px-6 py-16 sm:py-24">
      <div className="mx-auto max-w-7xl">
        {/* SINGLE PARENT CONTAINER WITH SERVICES CARD STYLING */}
        <div className="rounded-3xl border border-slate-200/80 bg-white/70 p-6 sm:p-10 md:p-12 shadow-2xl shadow-slate-900/5 backdrop-blur-xl dark:border-slate-800/80 dark:bg-slate-900/70">
          <div className="flex flex-col items-center gap-10 md:flex-row md:gap-12">
            {/* HERO IMAGE / INTERACTIVE COMPONENT */}
            <div className="relative h-[360px] w-full flex-1 overflow-hidden rounded-2xl shadow-xl shadow-slate-300/50 sm:h-[440px] md:h-[500px]">
              <img
                src="/hero.jpg"
                alt="Industrial workers at a refinery at sunset"
                className="absolute inset-0 h-full w-full object-cover animate-ken-burns"
              />
              <div className="absolute inset-0 z-10 bg-gradient-to-t from-slate-900/70 to-transparent"></div>
            </div>

            {/* TEXT & BUTTONS CONTENT */}
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
                <Link
                  href="/worker/auth"
                  className="inline-flex items-center justify-center gap-2 rounded-full bg-gradient-to-r from-blue-600 to-indigo-600 px-8 py-4 text-base font-bold text-white shadow-lg shadow-indigo-500/25 transition hover:from-blue-700 hover:to-indigo-700"
                >
                  {t('hero.ctaJoin')} <ArrowRight size={20} />
                </Link>
                <Link
                  href="/employer/auth"
                  className="inline-flex items-center justify-center gap-2 rounded-full border border-slate-200 bg-white px-8 py-4 text-base font-bold text-slate-700 shadow-sm transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                >
                  {t('hero.ctaEmployer')} <ArrowRight size={20} />
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
