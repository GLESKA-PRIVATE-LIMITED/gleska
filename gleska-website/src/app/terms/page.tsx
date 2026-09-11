"use client";

import React from "react";
import Link from "next/link";
import { ArrowLeft, FileText, Shield, Zap } from "lucide-react";
import Navbar from "@/components/landing/Navbar";
import { useLanguage } from "@/context/LanguageContext";

export default function TermsPage() {
  const { t } = useLanguage();

  const prohibitedItems = [
    { letter: "a", text: t('terms.prohibitedA') },
    { letter: "b", text: t('terms.prohibitedB') },
    { letter: "c", text: t('terms.prohibitedC') },
    { letter: "d", text: t('terms.prohibitedD') },
    { letter: "e", text: t('terms.prohibitedE') },
    { letter: "f", text: t('terms.prohibitedF') },
    { letter: "g", text: t('terms.prohibitedG') },
  ];

  const noEmploymentItems = [
    { letter: "a", text: t('terms.noEmploymentA') },
    { letter: "b", text: t('terms.noEmploymentB') },
    { letter: "c", text: t('terms.noEmploymentC') },
    { letter: "d", text: t('terms.noEmploymentD') },
    { letter: "e", text: t('terms.noEmploymentE') },
    { letter: "f", text: t('terms.noEmploymentF') },
    { letter: "g", text: t('terms.noEmploymentG') },
    { letter: "h", text: t('terms.noEmploymentH') },
    { letter: "i", text: t('terms.noEmploymentI') },
    { letter: "j", text: t('terms.noEmploymentJ') },
  ];

  return (
    <div className="relative min-h-screen overflow-x-clip bg-[#eef1fb] font-sans text-slate-900 selection:bg-indigo-500 selection:text-white dark:bg-slate-950 dark:text-slate-100">
      <Navbar />

      <section className="relative overflow-hidden bg-gradient-to-br from-indigo-600 via-blue-600 to-indigo-700 text-white">
        <div className="pointer-events-none absolute -right-32 -top-32 h-96 w-96 rounded-full bg-white/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-20 -left-20 h-72 w-72 rounded-full bg-indigo-400/20 blur-3xl" />

        <div className="relative z-10 mx-auto max-w-7xl px-6 py-16 sm:py-20 md:py-24">
          <Link
            href="/"
            className="mb-8 inline-flex items-center gap-1.5 text-sm font-semibold text-white/70 transition hover:text-white"
          >
            <ArrowLeft size={16} /> {t('terms.back')}
          </Link>

          <div className="max-w-3xl space-y-4">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-white/90 backdrop-blur">
              <FileText size={14} />
              {t('terms.badge')}
            </div>
            <h1 className="font-[var(--font-anton)] text-4xl uppercase leading-[0.95] tracking-wide sm:text-6xl md:text-7xl">
              {t('terms.title')}
            </h1>
            <p className="max-w-2xl text-base font-medium leading-relaxed text-white/75 sm:text-lg">
              {t('terms.subtitle')}
            </p>
          </div>
        </div>
      </section>

      <section className="relative px-6 py-16 sm:py-20">
        <div className="mx-auto max-w-5xl">
          <div className="rounded-3xl border border-slate-200/80 bg-white/90 p-6 sm:p-12 md:p-16 shadow-2xl shadow-slate-900/5 backdrop-blur-xl dark:border-slate-800/80 dark:bg-slate-900/90 space-y-12">
            <div className="flex items-center gap-3 rounded-2xl border border-indigo-100 bg-indigo-50/60 p-4 text-xs font-semibold text-indigo-900 dark:border-indigo-900/50 dark:bg-indigo-950/40 dark:text-indigo-200">
              <Shield size={18} className="shrink-0 text-indigo-600 dark:text-indigo-400" />
              <span>
                {t('terms.note')}
              </span>
            </div>

            <div className="space-y-6 border-b border-slate-100 pb-10 dark:border-slate-800">
              <h2 className="font-[var(--font-anton)] text-2xl uppercase tracking-wide text-indigo-600 sm:text-3xl dark:text-indigo-400">
                {t('terms.section1')}
              </h2>
              <p className="text-sm font-medium leading-relaxed text-slate-600 sm:text-base dark:text-slate-300">
                {t('terms.pageIntro')}
              </p>

              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 pt-2">
                <div className="rounded-2xl border border-slate-200/80 bg-slate-50/70 p-5 dark:border-slate-800 dark:bg-slate-800/60">
                  <h3 className="text-base font-bold text-slate-900 dark:text-white">{t('terms.businessesTitle')}</h3>
                  <p className="mt-2 text-sm font-medium leading-relaxed text-slate-600 dark:text-slate-300">
                    {t('terms.businessesText')}
                  </p>
                </div>

                <div className="rounded-2xl border border-slate-200/80 bg-slate-50/70 p-5 dark:border-slate-800 dark:bg-slate-800/60">
                  <h3 className="text-base font-bold text-slate-900 dark:text-white">{t('terms.unregisteredTitle')}</h3>
                  <p className="mt-2 text-sm font-medium leading-relaxed text-slate-600 dark:text-slate-300">
                    {t('terms.unregisteredText')}
                  </p>
                </div>

                <div className="rounded-2xl border border-slate-200/80 bg-slate-50/70 p-5 dark:border-slate-800 dark:bg-slate-800/60">
                  <h3 className="text-base font-bold text-slate-900 dark:text-white">{t('terms.workersTitle')}</h3>
                  <p className="mt-2 text-sm font-medium leading-relaxed text-slate-600 dark:text-slate-300">
                    {t('terms.workersText')}
                  </p>
                </div>

                <div className="rounded-2xl border border-slate-200/80 bg-slate-50/70 p-5 dark:border-slate-800 dark:bg-slate-800/60">
                  <h3 className="text-base font-bold text-slate-900 dark:text-white">{t('terms.individualsTitle')}</h3>
                  <p className="mt-2 text-sm font-medium leading-relaxed text-slate-600 dark:text-slate-300">
                    {t('terms.individualsText')}
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-6 border-b border-slate-100 pb-10 dark:border-slate-800">
              <h2 className="font-[var(--font-anton)] text-2xl uppercase tracking-wide text-indigo-600 sm:text-3xl dark:text-indigo-400">
                {t('terms.section2')}
              </h2>

              <div className="space-y-6">
                <div>
                  <h3 className="text-lg font-bold text-slate-900 dark:text-white">{t('terms.accuracyTitle')}</h3>
                  <p className="mt-1.5 text-sm font-medium leading-relaxed text-slate-600 sm:text-base dark:text-slate-300">
                    {t('terms.accuracyText')}
                  </p>
                </div>

                <div>
                  <h3 className="text-lg font-bold text-slate-900 dark:text-white">{t('terms.authorityTitle')}</h3>
                  <p className="mt-1.5 text-sm font-medium leading-relaxed text-slate-600 sm:text-base dark:text-slate-300">
                    {t('terms.authorityText')}
                  </p>
                </div>

                <div>
                  <h3 className="text-lg font-bold text-slate-900 dark:text-white">{t('terms.prohibitedTitle')}</h3>
                  <p className="mt-1.5 text-sm font-medium leading-relaxed text-slate-600 sm:text-base dark:text-slate-300">
                    {t('terms.prohibitedLead')}
                  </p>
                  <ul className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2 text-sm font-medium text-slate-700 dark:text-slate-300">
                    {prohibitedItems.map((item) => (
                      <li key={item.letter} className="flex items-start gap-2.5 rounded-xl border border-slate-100 bg-slate-50/60 p-3 dark:border-slate-800 dark:bg-slate-800/40">
                        <span className="font-mono text-xs font-bold text-indigo-600 dark:text-indigo-400">({item.letter})</span>
                        <span>{item.text}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div>
                  <h3 className="text-lg font-bold text-slate-900 dark:text-white">{t('terms.minimumAgeTitle')}</h3>
                  <p className="mt-1.5 text-sm font-medium leading-relaxed text-slate-600 sm:text-base dark:text-slate-300">
                    {t('terms.minimumAgeText')}
                  </p>
                </div>

                <div>
                  <h3 className="text-lg font-bold text-slate-900 dark:text-white">{t('terms.additionalTitle')}</h3>
                  <p className="mt-1.5 text-sm font-medium leading-relaxed text-slate-600 sm:text-base dark:text-slate-300">
                    {t('terms.additionalText')}
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-6 border-b border-slate-100 pb-10 dark:border-slate-800">
              <h2 className="font-[var(--font-anton)] text-2xl uppercase tracking-wide text-indigo-600 sm:text-3xl dark:text-indigo-400">
                {t('terms.section3')}
              </h2>

              <div className="space-y-6">
                <div>
                  <h3 className="text-lg font-bold text-slate-900 dark:text-white">{t('terms.independentTitle')}</h3>
                  <p className="mt-1.5 text-sm font-medium leading-relaxed text-slate-600 sm:text-base dark:text-slate-300">
                    {t('terms.independentText')}
                  </p>
                </div>

                <div>
                  <h3 className="text-lg font-bold text-slate-900 dark:text-white">{t('terms.noEmploymentTitle')}</h3>
                  <p className="mt-1.5 text-sm font-medium leading-relaxed text-slate-600 sm:text-base dark:text-slate-300">
                    {t('terms.noEmploymentLead')}
                  </p>
                  <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2 text-sm font-medium text-slate-700 dark:text-slate-300">
                    {noEmploymentItems.map((item) => (
                      <div key={item.letter} className="flex items-start gap-2.5 rounded-xl border border-slate-100 bg-slate-50/60 p-3 dark:border-slate-800 dark:bg-slate-800/40">
                        <span className="font-mono text-xs font-bold text-indigo-600 dark:text-indigo-400">({item.letter})</span>
                        <span>{item.text}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <h3 className="text-lg font-bold text-slate-900 dark:text-white">{t('terms.businessRespTitle')}</h3>
                  <p className="mt-1.5 text-sm font-medium leading-relaxed text-slate-600 sm:text-base dark:text-slate-300">
                    {t('terms.businessRespText')}
                  </p>
                </div>

                <div>
                  <h3 className="text-lg font-bold text-slate-900 dark:text-white">{t('terms.workerRespTitle')}</h3>
                  <p className="mt-1.5 text-sm font-medium leading-relaxed text-slate-600 sm:text-base dark:text-slate-300">
                    {t('terms.workerRespText')}
                  </p>
                </div>

                <div>
                  <h3 className="text-lg font-bold text-slate-900 dark:text-white">{t('terms.noGuaranteeTitle')}</h3>
                  <p className="mt-1.5 text-sm font-medium leading-relaxed text-slate-600 sm:text-base dark:text-slate-300">
                    {t('terms.noGuaranteeText')}
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-6 border-b border-slate-100 pb-10 dark:border-slate-800">
              <h2 className="font-[var(--font-anton)] text-2xl uppercase tracking-wide text-indigo-600 sm:text-3xl dark:text-indigo-400">
                {t('terms.paymentsTitle')}
              </h2>

              <div className="space-y-6">
                <div>
                  <h3 className="text-lg font-bold text-slate-900 dark:text-white">{t('terms.directPaymentsTitle')}</h3>
                  <p className="mt-1.5 text-sm font-medium leading-relaxed text-slate-600 sm:text-base dark:text-slate-300">
                    {t('terms.directPaymentsText')}
                  </p>
                </div>

                <div>
                  <h3 className="text-lg font-bold text-slate-900 dark:text-white">{t('terms.noCustodyTitle')}</h3>
                  <p className="mt-1.5 text-sm font-medium leading-relaxed text-slate-600 sm:text-base dark:text-slate-300">
                    {t('terms.noCustodyText')}
                  </p>
                </div>

                <div>
                  <h3 className="text-lg font-bold text-slate-900 dark:text-white">{t('terms.complianceTitle')}</h3>
                  <p className="mt-1.5 text-sm font-medium leading-relaxed text-slate-600 sm:text-base dark:text-slate-300">
                    {t('terms.complianceText')}
                  </p>
                </div>

                <div>
                  <h3 className="text-lg font-bold text-slate-900 dark:text-white">{t('terms.platformFeesTitle')}</h3>
                  <p className="mt-1.5 text-sm font-medium leading-relaxed text-slate-600 sm:text-base dark:text-slate-300">
                    {t('terms.platformFeesText')}
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-6">
              <h2 className="font-[var(--font-anton)] text-2xl uppercase tracking-wide text-indigo-600 sm:text-3xl dark:text-indigo-400">
                {t('terms.verificationTitle')}
              </h2>
              <p className="text-sm font-medium leading-relaxed text-slate-600 sm:text-base dark:text-slate-300">
                {t('terms.verificationText')}
              </p>
            </div>
          </div>
        </div>
      </section>

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
              <Link href="/terms" className="text-white/90 transition-colors hover:text-white">
                {t('nav.termsOfService')}
              </Link>
              <Link href="/contact" className="transition-colors hover:text-white">
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
