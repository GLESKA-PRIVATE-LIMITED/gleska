"use client";

import React, { useState } from 'react';
import Link from 'next/link';
import { ArrowRight, ShieldCheck, Mail, Phone, Send, User, Building2, ChevronDown, Loader2, CheckCircle2, MessageCircle, Brain, Network, Eye, Layers, TrendingUp, Factory, Sparkles, Globe, Target, Zap, MapPin, Clock } from 'lucide-react';
import Navbar from '@/components/landing/Navbar';
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

      {/* ABOUT US SECTION */}
      <AboutSection />

      {/* MANIFESTO */}
      <section className="mx-auto max-w-4xl space-y-6 px-6 py-24 text-center sm:py-28">
        <p className="font-[var(--font-anton)] text-4xl uppercase leading-[0.95] text-slate-900 sm:text-5xl md:text-7xl dark:text-white">
          {t('manifesto.line1')}
        </p>
        <p className="mx-auto inline-block max-w-2xl rounded-2xl bg-indigo-50 px-6 py-4 text-xl font-medium leading-relaxed text-indigo-900/80 dark:bg-indigo-950/40 dark:text-indigo-200">
          {t('manifesto.line2')}
        </p>
      </section>

      {/* CONTACT SECTION */}
      <ContactSection />

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
              <Link href="#" className="transition-colors hover:text-white">{t('footer.contact')}</Link>
            </div>
            <p className="text-amber-300">{t('footer.madeIn')}</p>
          </div>
        </div>
      </footer>

    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  About Us Section                                                  */
/* ------------------------------------------------------------------ */
const INDUSTRIES = [
  'Construction', 'Healthcare', 'Retail', 'Hospitality',
  'Energy', 'Finance', 'Agriculture', 'Manufacturing',
];

function AboutSection() {
  return (
    <section id="about" className="relative overflow-hidden">

      {/* ── HERO BANNER ── */}
      <div className="relative bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 text-white">
        <div className="pointer-events-none absolute -left-40 -top-40 h-[500px] w-[500px] rounded-full bg-indigo-600/20 blur-[120px]" />
        <div className="pointer-events-none absolute -bottom-32 -right-32 h-[400px] w-[400px] rounded-full bg-blue-500/15 blur-[100px]" />
        <div className="pointer-events-none absolute left-1/2 top-1/3 h-64 w-64 -translate-x-1/2 rounded-full bg-violet-500/10 blur-[80px]" />

        <div className="relative z-10 mx-auto max-w-5xl px-6 py-20 sm:py-28">
          <div className="space-y-7 text-center">
            <div className="mx-auto inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-5 py-2 text-[11px] font-semibold uppercase tracking-widest text-indigo-300 backdrop-blur">
              <Brain size={15} />
              About Gleska
            </div>
            <h2 className="mx-auto max-w-4xl font-[var(--font-anton)] text-4xl uppercase leading-[0.92] tracking-wide sm:text-5xl md:text-7xl">
              Building the{' '}
              <span className="bg-gradient-to-r from-indigo-400 via-blue-400 to-cyan-400 bg-clip-text text-transparent">AI Brain</span>{' '}
              for Businesses{' '}
              <span className="bg-gradient-to-r from-amber-300 to-orange-400 bg-clip-text text-transparent">&amp; Industries</span>
            </h2>
            <p className="mx-auto max-w-3xl text-lg font-medium leading-relaxed text-white/60 md:text-xl">
              Gleska is building an AI-powered digital brain for businesses and industries&mdash;intelligent infrastructure designed to understand how an organization works, help it make better decisions, execute work, coordinate operations, preserve institutional knowledge, and grow more capable with every cycle of experience.
            </p>
          </div>
        </div>
        <div className="absolute bottom-0 left-0 right-0 h-20 bg-gradient-to-t from-[#eef1fb] to-transparent dark:from-slate-950" />
      </div>

      {/* ── ONE PLATFORM ── */}
      <div className="mx-auto max-w-5xl px-6 py-16 sm:py-20">
        <div className="rounded-3xl border border-slate-200 bg-white p-8 shadow-xl shadow-slate-200/50 sm:p-12 dark:border-slate-800 dark:bg-slate-900 dark:shadow-none">
          <div className="mb-8 flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-600 shadow-lg shadow-indigo-500/25">
              <Layers size={24} className="text-white" />
            </div>
            <h3 className="font-[var(--font-anton)] text-2xl uppercase tracking-wide text-slate-900 sm:text-3xl dark:text-white">One Platform. Every Capability.</h3>
          </div>
          <div className="space-y-6 text-base font-medium leading-[1.85] text-slate-600 sm:text-lg dark:text-slate-300">
            <p>
              A business should be able to come to{' '}
              <span className="font-bold text-indigo-600 dark:text-indigo-400">one intelligent platform</span>{' '}
              and draw on whatever AI capability its operations, industry, and goals demand. That is the future Gleska is building toward.
            </p>
            <p>
              The platform unites specialized intelligence across functions such as{' '}
              <span className="rounded-lg bg-indigo-50 px-2 py-0.5 font-bold text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300">operations</span>,{' '}
              <span className="rounded-lg bg-blue-50 px-2 py-0.5 font-bold text-blue-700 dark:bg-blue-950/50 dark:text-blue-300">finance</span>,{' '}
              <span className="rounded-lg bg-violet-50 px-2 py-0.5 font-bold text-violet-700 dark:bg-violet-950/50 dark:text-violet-300">management</span>, and{' '}
              <span className="rounded-lg bg-amber-50 px-2 py-0.5 font-bold text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">industry-specific applications</span>.
              Over time, these capabilities will mature into <strong className="text-slate-900 dark:text-white">AI workers</strong> that carry out the work of specialized digital roles&mdash;operating under the authority, policies, and objectives the organization itself defines.
            </p>
          </div>
        </div>
      </div>

      {/* ── INTELLIGENCE THAT GROWS ── */}
      <div className="relative overflow-hidden bg-gradient-to-br from-indigo-600 via-blue-600 to-indigo-700 text-white">
        <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-white/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 -left-16 h-72 w-72 rounded-full bg-indigo-400/20 blur-3xl" />

        <div className="relative z-10 mx-auto max-w-5xl px-6 py-20 sm:py-24">
          <div className="mb-10 text-center">
            <div className="mx-auto mb-5 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-white/90 backdrop-blur">
              <TrendingUp size={14} />
              Compounding Intelligence
            </div>
            <h2 className="font-[var(--font-anton)] text-4xl uppercase leading-[0.95] tracking-wide sm:text-5xl md:text-6xl">
              Intelligence That{' '}
              <span className="bg-gradient-to-r from-amber-300 to-yellow-300 bg-clip-text text-transparent">Grows</span>{' '}
              With the Organization
            </h2>
          </div>
          <p className="mx-auto mb-8 max-w-3xl text-center text-lg font-medium leading-relaxed text-white/80 md:text-xl">
            It learns the organization&apos;s approved knowledge, processes, history, preferences, decisions, and lessons learned. It remembers what worked, recognizes what did not, and keeps improving within the boundaries the organization sets.
          </p>
          <div className="mx-auto flex max-w-3xl flex-wrap justify-center gap-3 pb-8">
            {[
              { icon: Brain, text: 'Organizational Memory' },
              { icon: TrendingUp, text: 'Compounding Intelligence' },
              { icon: ShieldCheck, text: 'Human Control' },
              { icon: Zap, text: 'Automated Routine Work' },
            ].map((pill) => (
              <div key={pill.text} className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm font-bold text-white backdrop-blur transition hover:bg-white/20">
                <pill.icon size={16} className="text-amber-300" />
                {pill.text}
              </div>
            ))}
          </div>
          <div className="mx-auto max-w-3xl rounded-2xl border border-white/10 bg-white/5 p-6 text-center backdrop-blur sm:p-8">
            <p className="text-base font-medium leading-relaxed text-white/75 sm:text-lg">
              The result is something fundamentally different: an AI system with <strong className="text-white">organizational memory, experience, and compounding intelligence</strong>&mdash;built to give people <span className="text-amber-300">greater intelligence, greater leverage, and greater operational capacity</span>. Humans stay in control of critical decisions, while routine and reversible work is increasingly automated.
            </p>
            <p className="mt-4 font-[var(--font-anton)] text-2xl uppercase tracking-wide text-amber-300 sm:text-3xl">Let AI carry more of the load.</p>
          </div>
        </div>
      </div>

      {/* ── ONE INTELLIGENT ORGANIZATION ── */}
      <div className="mx-auto max-w-5xl px-6 py-20 sm:py-24">
        <div className="mb-12 text-center">
          <div className="mx-auto mb-5 inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-indigo-50 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950/50 dark:text-indigo-300">
            <Network size={14} />
            Connected Intelligence
          </div>
          <h2 className="font-[var(--font-anton)] text-4xl uppercase leading-[0.95] tracking-wide bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent sm:text-5xl md:text-6xl">
            One Intelligent Organization
          </h2>
          <p className="mx-auto mt-4 max-w-3xl text-lg font-medium leading-relaxed text-slate-600 dark:text-slate-400">
            The real power emerges once specialized AI systems start working together. Rather than a scatter of isolated AI tools, Gleska is building toward one connected AI organization&mdash;where specialized intelligence collaborates as a single system.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[
            { icon: Target, name: 'Sales', color: 'from-emerald-500 to-teal-600' },
            { icon: Factory, name: 'Operations', color: 'from-blue-600 to-indigo-600' },
            { icon: Building2, name: 'Finance', color: 'from-violet-500 to-purple-600' },
            { icon: Layers, name: 'Management', color: 'from-amber-500 to-orange-600' },
          ].map((item, i) => (
            <div key={item.name} className="group relative rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm transition hover:-translate-y-1 hover:shadow-xl dark:border-slate-800 dark:bg-slate-900">
              {i < 3 && <div className="absolute -right-2 top-1/2 hidden h-px w-4 bg-indigo-300 sm:block dark:bg-indigo-700" />}
              <div className={`mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br ${item.color} shadow-lg`}>
                <item.icon size={26} className="text-white" />
              </div>
              <h3 className="font-[var(--font-anton)] text-xl uppercase tracking-wide text-slate-900 dark:text-white">{item.name}</h3>
              <p className="mt-1 text-xs font-semibold uppercase tracking-wider text-slate-400">AI System</p>
            </div>
          ))}
        </div>
        <p className="mx-auto mt-10 max-w-3xl text-center text-base font-medium leading-relaxed text-slate-500 dark:text-slate-400">
          A sales system talks to operations. Operations coordinates with finance. Finance informs management. Industry-specific intelligence works alongside all of them.
        </p>
      </div>

      {/* ── INDUSTRIES ── */}
      <div className="border-y border-slate-200 bg-white px-6 py-16 sm:py-20 dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto max-w-5xl">
          <div className="mb-10 text-center">
            <div className="mx-auto mb-5 inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-indigo-50 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950/50 dark:text-indigo-300">
              <Globe size={14} />
              Every Sector
            </div>
            <h2 className="font-[var(--font-anton)] text-4xl uppercase tracking-wide text-slate-900 sm:text-5xl md:text-6xl dark:text-white">Built for Business. Built for Industry.</h2>
          </div>
          <p className="mx-auto mb-12 max-w-3xl text-center text-lg font-medium leading-relaxed text-slate-600 dark:text-slate-400">
            From micro and small businesses to industrial organizations, our long-term vision spans sectors including construction, healthcare, retail, hospitality, energy, finance, agriculture, manufacturing, and more. Every industry carries its own processes, challenges, regulations, knowledge, and ways of working. Our vision is intelligence that <strong className="text-slate-900 dark:text-white">adapts to those realities</strong>&mdash;not a generic AI experience forced onto every organization alike.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            {INDUSTRIES.map((name) => (
              <div key={name} className="cursor-default rounded-full border border-slate-200 bg-slate-50 px-5 py-2.5 font-[var(--font-anton)] text-lg uppercase text-slate-700 transition hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:border-indigo-500 dark:hover:bg-indigo-950/50 dark:hover:text-indigo-300">{name}</div>
            ))}
            <div className="cursor-default rounded-full bg-gradient-to-r from-blue-600 to-indigo-600 px-5 py-2.5 font-[var(--font-anton)] text-lg uppercase text-white">+ Many More</div>
          </div>
        </div>
      </div>

      {/* ── OUR VISION ── */}
      <div className="mx-auto max-w-5xl px-6 py-20 sm:py-24">
        <div className="mb-12 text-center">
          <div className="mx-auto mb-5 inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-indigo-50 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950/50 dark:text-indigo-300">
            <Eye size={14} />
            Our Vision
          </div>
          <h2 className="font-[var(--font-anton)] text-4xl uppercase leading-[0.95] tracking-wide bg-gradient-to-r from-indigo-500 via-blue-500 to-cyan-500 bg-clip-text text-transparent sm:text-5xl md:text-6xl">The Next Layer of Infrastructure</h2>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-white p-7 shadow-lg shadow-slate-200/40 transition hover:shadow-xl sm:p-9 dark:border-slate-800 dark:bg-slate-900 dark:shadow-none">
            <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 shadow-md">
              <Network size={24} className="text-white" />
            </div>
            <h3 className="mb-3 text-xl font-extrabold text-slate-900 dark:text-white">Fundamental Infrastructure</h3>
            <p className="text-base font-medium leading-[1.85] text-slate-500 dark:text-slate-400">
              Just as businesses today depend on electricity, computing, software, databases, networks, and the internet, we believe intelligent AI infrastructure will become <strong className="text-slate-900 dark:text-white">just as fundamental</strong>. Gleska&apos;s ambition is to help build that infrastructure.
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-7 shadow-lg shadow-slate-200/40 transition hover:shadow-xl sm:p-9 dark:border-slate-800 dark:bg-slate-900 dark:shadow-none">
            <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 shadow-md">
              <Globe size={24} className="text-white" />
            </div>
            <h3 className="mb-3 text-xl font-extrabold text-slate-900 dark:text-white">AI for Everyone</h3>
            <p className="text-base font-medium leading-[1.85] text-slate-500 dark:text-slate-400">
              Gleska exists to make advanced artificial intelligence accessible not only to large enterprises, but to the <strong className="text-slate-900 dark:text-white">smaller businesses and organizations</strong> that have traditionally been priced out of complex technology systems.
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-7 shadow-lg shadow-slate-200/40 transition hover:shadow-xl sm:p-9 lg:col-span-2 dark:border-slate-800 dark:bg-slate-900 dark:shadow-none">
            <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-600 shadow-md">
              <Sparkles size={24} className="text-white" />
            </div>
            <h3 className="mb-3 text-xl font-extrabold text-slate-900 dark:text-white">Growing With You</h3>
            <p className="text-base font-medium leading-[1.85] text-slate-500 dark:text-slate-400">
              It is building an intelligent system that grows with an organization&mdash;understanding its work, preserving its knowledge, assisting its people, executing its processes, coordinating specialized intelligence, and becoming <strong className="text-slate-900 dark:text-white">more useful with every cycle of experience</strong>.
            </p>
          </div>
        </div>
      </div>

      {/* ── MANIFESTO STRIP ── */}
      <div className="relative overflow-hidden bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 py-16 text-center text-white sm:py-24">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(99,102,241,0.15),transparent_70%)]" />
        <div className="relative z-10 mx-auto max-w-4xl space-y-6 px-6">
          <p className="font-[var(--font-anton)] text-3xl uppercase leading-[0.95] tracking-wide sm:text-4xl md:text-6xl">
            Gleska&apos;s ambition is to become a{' '}
            <span className="bg-gradient-to-r from-indigo-400 to-cyan-400 bg-clip-text text-transparent">foundational AI company</span>{' '}
            for the business &amp; industrial world
          </p>
          <p className="mx-auto inline-block max-w-2xl rounded-2xl border border-white/10 bg-white/5 px-6 py-4 text-lg font-medium leading-relaxed text-white/70 backdrop-blur md:text-xl">
            A trusted technological layer between organizations and the rapidly expanding capabilities of artificial intelligence.
          </p>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Contact Section Constants                                         */
/* ------------------------------------------------------------------ */
const labelCls =
  'mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400';
const inputCls =
  'w-full rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-3 text-sm font-medium text-slate-900 placeholder:text-slate-400 outline-none transition focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-100 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:placeholder:text-slate-500 dark:focus:border-indigo-500 dark:focus:bg-slate-900 dark:focus:ring-indigo-900/40';
const primaryBtnCls =
  'inline-flex w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-blue-600 to-indigo-600 px-6 py-3.5 text-sm font-bold text-white shadow-lg shadow-indigo-500/25 transition hover:from-blue-700 hover:to-indigo-700 disabled:cursor-not-allowed disabled:opacity-60';

const FAQ_ITEMS = [
  {
    q: 'How quickly can I hire workers through GO LESKA?',
    a: 'Our AI dispatch engine matches your requirements with verified workers within 60 seconds. Once accepted, workers can be on-site within hours depending on proximity.',
  },
  {
    q: 'What kind of workers are available on the platform?',
    a: 'We cover 50+ blue-collar trade categories — welders, fitters, CNC operators, electricians, plumbers, security guards, housekeeping staff, and many more.',
  },
  {
    q: 'Is there a minimum hiring commitment?',
    a: 'No minimum commitment. You can hire for a single day or long-term contracts. Pay-as-you-go with transparent daily rates and zero hidden fees.',
  },
  {
    q: 'How are workers verified?',
    a: 'Every worker on GO LESKA undergoes Aadhaar-based identity verification, skill assessment, and background checks before they appear on the platform.',
  },
  {
    q: 'Which cities are you currently operational in?',
    a: 'We\'re live across major industrial hubs in Maharashtra, Tamil Nadu, Karnataka, and Gujarat. Expanding rapidly — contact us if your city isn\'t listed yet!',
  },
];

/* ------------------------------------------------------------------ */
/*  FAQ Accordion Item                                                */
/* ------------------------------------------------------------------ */
function FaqItem({ q, a, open, toggle }: { q: string; a: string; open: boolean; toggle: () => void }) {
  return (
    <button
      onClick={toggle}
      className="group w-full rounded-2xl border border-slate-200 bg-white p-5 text-left transition hover:shadow-md dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700"
    >
      <div className="flex items-start justify-between gap-4">
        <h3 className="text-base font-bold text-slate-900 dark:text-white">{q}</h3>
        <ChevronDown
          size={20}
          className={`mt-0.5 shrink-0 text-slate-400 transition-transform duration-300 ${
            open ? 'rotate-180 text-indigo-600 dark:text-indigo-400' : ''
          }`}
        />
      </div>
      <div
        className={`grid transition-all duration-300 ease-in-out ${
          open ? 'mt-3 grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
        }`}
      >
        <p className="overflow-hidden text-sm font-medium leading-relaxed text-slate-500 dark:text-slate-400">
          {a}
        </p>
      </div>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  Contact Section                                                   */
/* ------------------------------------------------------------------ */
function ContactSection() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    await new Promise((r) => setTimeout(r, 1500));
    setSubmitting(false);
    setSubmitted(true);
  };

  const contactCards = [
    {
      icon: Phone,
      label: 'Call Us',
      value: '+91 98765 43210',
      href: 'tel:+919876543210',
      description: 'Mon – Sat, 9 AM – 7 PM IST',
      color: 'from-emerald-500 to-teal-600',
    },
    {
      icon: Mail,
      label: 'Email Us',
      value: 'hello@goleska.com',
      href: 'mailto:hello@goleska.com',
      description: 'We reply within 4 hours',
      color: 'from-blue-600 to-indigo-600',
    },
    {
      icon: MapPin,
      label: 'Visit Us',
      value: 'Mumbai, Maharashtra',
      href: 'https://maps.google.com',
      description: 'Andheri East, BKC Road',
      color: 'from-amber-500 to-orange-600',
    },
  ];

  return (
    <section id="contact" className="border-y border-slate-200 bg-white px-6 py-20 sm:py-24 dark:border-slate-800 dark:bg-slate-900">
      <div className="mx-auto max-w-7xl">
        {/* Section header */}
        <div className="mb-14 text-center">
          <div className="mx-auto mb-4 inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-indigo-50 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950/50 dark:text-indigo-300">
            <MessageCircle size={14} />
            Get in touch
          </div>
          <h2 className="font-[var(--font-anton)] text-4xl uppercase tracking-wide text-slate-900 sm:text-5xl md:text-6xl dark:text-white">
            Contact Us
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-lg font-medium text-slate-600 dark:text-slate-400">
            Whether you&apos;re hiring or looking for work — we&apos;re here to help.
          </p>
        </div>

        {/* Contact info cards */}
        <div className="mb-12 grid grid-cols-1 gap-4 sm:grid-cols-3">
          {contactCards.map((card) => (
            <a
              key={card.label}
              href={card.href}
              target={card.label === 'Visit Us' ? '_blank' : undefined}
              rel={card.label === 'Visit Us' ? 'noopener noreferrer' : undefined}
              className="group relative flex items-start gap-4 rounded-2xl border border-slate-200 bg-slate-50/60 p-5 transition hover:-translate-y-1 hover:shadow-lg dark:border-slate-800 dark:bg-slate-800/60 dark:hover:border-slate-700"
            >
              <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${card.color} shadow-md`}>
                <card.icon size={22} className="text-white" />
              </div>
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">{card.label}</p>
                <p className="mt-0.5 text-base font-bold text-slate-900 dark:text-white">{card.value}</p>
                <p className="mt-1 flex items-center gap-1.5 text-xs font-medium text-slate-400 dark:text-slate-500">
                  <Clock size={12} /> {card.description}
                </p>
              </div>
              <ArrowRight size={18} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-300 transition group-hover:translate-x-1 group-hover:text-indigo-500 dark:text-slate-600 dark:group-hover:text-indigo-400" />
            </a>
          ))}
        </div>

        {/* Form + FAQ grid */}
        <div className="grid grid-cols-1 items-start gap-10 lg:grid-cols-5">
          {/* Form */}
          <div className="lg:col-span-3">
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xl shadow-slate-200/40 sm:p-8 dark:border-slate-700 dark:bg-slate-800 dark:shadow-none">
              <div className="mb-7">
                <h3 className="font-[var(--font-anton)] text-2xl uppercase tracking-wide text-slate-900 sm:text-3xl dark:text-white">
                  Send us a message
                </h3>
                <p className="mt-2 text-sm font-medium text-slate-500 dark:text-slate-400">
                  Fill in the form below and we&apos;ll get back to you within 4 hours.
                </p>
              </div>

              {submitted ? (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 shadow-lg shadow-emerald-500/30">
                    <CheckCircle2 size={32} className="text-white" />
                  </div>
                  <h3 className="text-xl font-extrabold text-slate-900 dark:text-white">Message Sent!</h3>
                  <p className="mt-2 max-w-sm text-sm font-medium text-slate-500 dark:text-slate-400">
                    Thank you for reaching out. Our team will respond to your inquiry within 4 hours during business hours.
                  </p>
                  <button
                    onClick={() => { setSubmitted(false); setName(''); setEmail(''); setPhone(''); setSubject(''); setMessage(''); }}
                    className="mt-6 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-5 py-2.5 text-sm font-bold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                  >
                    Send another message
                  </button>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-5" id="contact-form">
                  <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                    <div>
                      <label htmlFor="contact-name" className={labelCls}>Full Name</label>
                      <div className="relative">
                        <User size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input id="contact-name" type="text" value={name} onChange={(e) => setName(e.target.value)} className={inputCls + ' pl-11'} placeholder="Your name" required />
                      </div>
                    </div>
                    <div>
                      <label htmlFor="contact-email" className={labelCls}>Email</label>
                      <div className="relative">
                        <Mail size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input id="contact-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls + ' pl-11'} placeholder="you@company.com" required />
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                    <div>
                      <label htmlFor="contact-phone" className={labelCls}>Phone (optional)</label>
                      <div className="flex">
                        <span className="inline-flex items-center rounded-l-xl border border-r-0 border-slate-200 bg-slate-100 px-4 text-sm font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-700 dark:text-slate-400">+91</span>
                        <input id="contact-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className={inputCls + ' rounded-l-none'} placeholder="9999999999" maxLength={10} />
                      </div>
                    </div>
                    <div>
                      <label htmlFor="contact-subject" className={labelCls}>Subject</label>
                      <div className="relative">
                        <Building2 size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                        <select id="contact-subject" value={subject} onChange={(e) => setSubject(e.target.value)} className={inputCls + ' appearance-none pl-11 pr-10'} required>
                          <option value="">Select a topic</option>
                          <option value="hiring">I want to hire workers</option>
                          <option value="work">I&apos;m looking for work</option>
                          <option value="partnership">Business partnership</option>
                          <option value="support">Technical support</option>
                          <option value="other">Other</option>
                        </select>
                        <ChevronDown size={16} className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                      </div>
                    </div>
                  </div>

                  <div>
                    <label htmlFor="contact-message" className={labelCls}>Message</label>
                    <textarea id="contact-message" rows={5} value={message} onChange={(e) => setMessage(e.target.value)} className={inputCls + ' resize-none'} placeholder="Tell us how we can help you..." required />
                  </div>

                  <button type="submit" disabled={submitting} className={primaryBtnCls} id="contact-submit-btn">
                    {submitting ? <Loader2 className="animate-spin" size={18} /> : <><Send size={16} /> Send Message</>}
                  </button>
                </form>
              )}
            </div>
          </div>

          {/* FAQ sidebar */}
          <div className="lg:col-span-2">
            <div className="mb-6">
              <h3 className="font-[var(--font-anton)] text-2xl uppercase tracking-wide text-slate-900 sm:text-3xl dark:text-white">
                FAQs
              </h3>
              <p className="mt-2 text-sm font-medium text-slate-500 dark:text-slate-400">
                Quick answers to common questions.
              </p>
            </div>
            <div className="space-y-3" id="faq-section">
              {FAQ_ITEMS.map((item, i) => (
                <FaqItem key={i} q={item.q} a={item.a} open={openFaq === i} toggle={() => setOpenFaq(openFaq === i ? null : i)} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
