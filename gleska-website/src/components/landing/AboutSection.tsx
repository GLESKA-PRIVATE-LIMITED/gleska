"use client";

import React from "react";
import { BrainCircuit, Cpu, Sparkles, Target } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";

export default function AboutSection() {
  const { t } = useLanguage();

  return (
    <section id="about" className="relative px-6 py-20 sm:py-24">
      <div className="mx-auto max-w-7xl">
        
        <div className="rounded-[2.5rem] border border-slate-200/80 bg-white/70 p-6 sm:p-10 md:p-12 shadow-2xl shadow-slate-900/5 backdrop-blur-xl dark:border-slate-800/80 dark:bg-slate-900/70 space-y-8 sm:space-y-12">
          
          <div className="max-w-3xl text-left">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-indigo-50 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950/50 dark:text-indigo-300">
              <BrainCircuit size={14} />
              {t('about.badge')}
            </div>
            <h2 className="font-[var(--font-anton)] text-4xl uppercase tracking-wide text-slate-900 sm:text-5xl md:text-6xl dark:text-white leading-[0.95]">
              {t('about.heading')}
            </h2>
          </div>

          {/* ========================================================= */}
          {/* INNER CONTAINER 1: Three Core Content Blocks             */}
          {/* ========================================================= */}
          <div className="rounded-3xl border border-slate-200/90 bg-white/95 p-6 sm:p-10 md:p-12 shadow-xl backdrop-blur-md dark:border-slate-800/90 dark:bg-slate-900/95 space-y-12">
            
            {/* BLOCK 1: Building the AI Brain */}
            <div className="space-y-4 border-b border-slate-100 pb-10 dark:border-slate-800">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-950/60 dark:text-blue-400">
                  <BrainCircuit size={20} />
                </div>
                <h3 className="font-[var(--font-anton)] text-2xl uppercase tracking-wide text-slate-900 sm:text-3xl dark:text-white">
                  {t('about.block1Title')}
                </h3>
              </div>

              <div className="space-y-4 pt-2 text-base font-medium leading-relaxed text-slate-600 sm:text-lg dark:text-slate-300">
                <p>
                  {t('about.block1P1')}
                </p>
                <p>
                  {t('about.block1P2')}
                </p>
              </div>

              <div className="mt-4 inline-flex items-center gap-2.5 rounded-xl border border-blue-200/80 bg-gradient-to-r from-blue-50 to-indigo-50 px-4 py-2.5 text-xs font-bold text-blue-800 dark:border-blue-900/50 dark:from-blue-950/40 dark:to-indigo-950/40 dark:text-blue-200">
                <Sparkles size={16} className="text-blue-600" />
                {t('about.block1Highlight')}
              </div>
            </div>

            {/* BLOCK 2: Intelligence That Grows */}
            <div className="space-y-4 border-b border-slate-100 pb-10 dark:border-slate-800">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400">
                  <Cpu size={20} />
                </div>
                <h3 className="font-[var(--font-anton)] text-2xl uppercase tracking-wide text-slate-900 sm:text-3xl dark:text-white">
                  <span className="bg-gradient-to-r from-emerald-600 to-teal-600 bg-clip-text text-transparent">
                    INTELLIGENCE
                  </span>{" "}
                  THAT GROWS WITH THE ORGANIZATION
                </h3>
              </div>

              <p className="pt-2 text-base font-medium leading-relaxed text-slate-600 sm:text-lg dark:text-slate-300">
                {t('about.block2P1')}
              </p>

              <div className="mt-4 inline-flex items-center gap-2.5 rounded-xl border border-emerald-200/80 bg-gradient-to-r from-emerald-50 to-teal-50 px-4 py-2.5 text-xs font-bold text-emerald-800 dark:border-emerald-900/50 dark:from-emerald-950/40 dark:to-teal-950/40 dark:text-emerald-200">
                <Cpu size={16} className="text-emerald-600" />
                {t('about.block2Highlight')}
              </div>
            </div>

            {/* BLOCK 3: One Intelligent Organization */}
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-600 dark:bg-amber-950/60 dark:text-amber-400">
                  <Sparkles size={20} />
                </div>
                <h3 className="font-[var(--font-anton)] text-2xl uppercase tracking-wide text-slate-900 sm:text-3xl dark:text-white">
                  ONE INTELLIGENT ORGANIZATION. BUILT FOR{" "}
                  <span className="bg-gradient-to-r from-amber-500 to-orange-600 bg-clip-text text-transparent">
                    BUSINESS
                  </span>
                  . BUILT FOR{" "}
                  <span className="bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
                    INDUSTRY
                  </span>
                  .
                </h3>
              </div>

              <div className="space-y-4 pt-2 text-base font-medium leading-relaxed text-slate-600 sm:text-lg dark:text-slate-300">
                <p>
                  {t('about.block3P1')}
                </p>
                <p>
                  {t('about.block3P2')}
                </p>
              </div>
            </div>

          </div>

          {/* ========================================================= */}
          {/* INNER CONTAINER 2: Our Vision & Mission                    */}
          {/* ========================================================= */}
          <div className="rounded-3xl border border-slate-200/90 bg-white/95 p-6 sm:p-10 md:p-12 shadow-xl backdrop-blur-md dark:border-slate-800/90 dark:bg-slate-900/95 space-y-6">
            
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-400">
                <Target size={20} />
              </div>
              <h3 className="font-[var(--font-anton)] text-2xl uppercase tracking-wide text-indigo-600 sm:text-3xl dark:text-indigo-400">
                {t('about.visionTitle')}
              </h3>
            </div>

            <div className="space-y-4 text-base font-medium leading-relaxed text-slate-600 sm:text-lg dark:text-slate-300">
              <p>
                {t('about.visionP1')}
              </p>
              <p>
                {t('about.visionP2')}
              </p>
              <p>
                {t('about.visionP3')}
              </p>
            </div>

            {/* Mission Highlight Card */}
            <div className="mt-6 rounded-2xl border border-amber-300/80 bg-gradient-to-r from-amber-500/10 via-indigo-500/10 to-blue-500/10 p-6 sm:p-8 dark:border-amber-500/40">
              <p className="font-[var(--font-anton)] text-lg uppercase tracking-wide text-slate-900 sm:text-xl md:text-2xl leading-snug dark:text-white">
                {t('about.missionHighlight')}
              </p>
            </div>

          </div>

        </div>

      </div>
    </section>
  );
}
