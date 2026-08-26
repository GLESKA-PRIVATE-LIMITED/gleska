"use client";

import React from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  Zap,
  Brain,
  Building2,
  Network,
  Eye,
  Layers,
  TrendingUp,
  Factory,
  ShieldCheck,
  Sparkles,
  Globe,
  Target,
} from "lucide-react";
import LanguageSelector from "@/components/landing/LanguageSelector";

/* ------------------------------------------------------------------ */
/*  Animated gradient divider                                         */
/* ------------------------------------------------------------------ */
function GradientDivider() {
  return (
    <div className="mx-auto my-16 flex items-center justify-center gap-3 sm:my-20">
      <span className="h-px w-16 bg-gradient-to-r from-transparent to-indigo-300 dark:to-indigo-700" />
      <Sparkles size={18} className="text-indigo-400 dark:text-indigo-500" />
      <span className="h-px w-16 bg-gradient-to-l from-transparent to-indigo-300 dark:to-indigo-700" />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Section heading component                                         */
/* ------------------------------------------------------------------ */
function SectionHeading({ badge, title, gradient }: { badge: string; title: string; gradient?: string }) {
  return (
    <div className="mb-10 text-center sm:mb-14">
      <div className="mx-auto mb-5 inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-indigo-50 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950/50 dark:text-indigo-300">
        <Sparkles size={13} />
        {badge}
      </div>
      <h2
        className={`font-[var(--font-anton)] text-4xl uppercase leading-[0.95] tracking-wide sm:text-5xl md:text-6xl ${
          gradient
            ? "bg-gradient-to-r bg-clip-text text-transparent " + gradient
            : "text-slate-900 dark:text-white"
        }`}
      >
        {title}
      </h2>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Industry pill data                                                */
/* ------------------------------------------------------------------ */
const INDUSTRIES = [
  "Construction",
  "Healthcare",
  "Retail",
  "Hospitality",
  "Energy",
  "Finance",
  "Agriculture",
  "Manufacturing",
  "Logistics",
  "Education",
  "Real Estate",
  "Technology",
];

/* ------------------------------------------------------------------ */
/*  Page                                                              */
/* ------------------------------------------------------------------ */
export default function AboutPage() {
  return (
    <div className="relative min-h-screen overflow-x-clip bg-[#eef1fb] font-sans text-slate-900 selection:bg-indigo-500 selection:text-white dark:bg-slate-950 dark:text-slate-100">
      {/* ── NAV ── */}
      <div className="sticky top-4 z-50 px-4 sm:px-8">
        <nav className="mx-auto flex max-w-[1360px] items-center justify-between rounded-full border border-slate-200/80 bg-white/95 px-8 py-4 shadow-xl shadow-slate-900/5 backdrop-blur-md dark:border-slate-800/80 dark:bg-slate-900/95 dark:shadow-black/20">
          <Link href="/" className="flex items-center gap-3.5">
            <img src="/favicon.ico" alt="GO LESKA AI" className="h-9 w-9 rounded-lg object-contain" />
            <span className="font-[var(--font-anton)] text-2xl sm:text-3xl uppercase tracking-wider bg-[linear-gradient(180deg,#E86100_0%,#FFF5EA_48%,#128807_100%)] bg-clip-text text-transparent select-none">
              GO LESKA AI
            </span>
          </Link>
          <div className="hidden items-center gap-9 text-base font-bold tracking-wide text-slate-700 md:flex dark:text-slate-200">
            <Link href="/#worker" className="transition-all hover:text-indigo-600 dark:hover:text-indigo-400">
              For Workers
            </Link>
            <Link href="/#employer" className="transition-all hover:text-indigo-600 dark:hover:text-indigo-400">
              For Employers
            </Link>
            <Link href="/#contact" className="transition-all hover:text-indigo-600 dark:hover:text-indigo-400">
              Contact Us
            </Link>
            <Link href="/about" className="text-indigo-600 dark:text-indigo-400">
              About Us
            </Link>
          </div>
          <div className="flex items-center gap-4">
            <LanguageSelector />
          </div>
        </nav>
      </div>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/*  HERO                                                         */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <section className="relative overflow-hidden bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 text-white">
        {/* Decorative orbs */}
        <div className="pointer-events-none absolute -left-40 -top-40 h-[500px] w-[500px] rounded-full bg-indigo-600/20 blur-[120px]" />
        <div className="pointer-events-none absolute -bottom-32 -right-32 h-[400px] w-[400px] rounded-full bg-blue-500/15 blur-[100px]" />
        <div className="pointer-events-none absolute left-1/2 top-1/3 h-64 w-64 -translate-x-1/2 rounded-full bg-violet-500/10 blur-[80px]" />

        <div className="relative z-10 mx-auto max-w-5xl px-6 py-20 sm:py-28 md:py-36">
          <Link
            href="/"
            className="mb-10 inline-flex items-center gap-1.5 text-sm font-semibold text-white/50 transition hover:text-white"
          >
            <ArrowLeft size={16} /> Back to home
          </Link>

          <div className="space-y-7 text-center">
            <div className="mx-auto inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-5 py-2 text-[11px] font-semibold uppercase tracking-widest text-indigo-300 backdrop-blur">
              <Brain size={15} />
              About Gleska
            </div>

            <h1 className="mx-auto max-w-4xl font-[var(--font-anton)] text-5xl uppercase leading-[0.92] tracking-wide sm:text-6xl md:text-8xl">
              Building the{" "}
              <span className="bg-gradient-to-r from-indigo-400 via-blue-400 to-cyan-400 bg-clip-text text-transparent">
                AI Brain
              </span>{" "}
              for Businesses{" "}
              <span className="bg-gradient-to-r from-amber-300 to-orange-400 bg-clip-text text-transparent">
                &amp; Industries
              </span>
            </h1>

            <p className="mx-auto max-w-3xl text-lg font-medium leading-relaxed text-white/60 md:text-xl">
              Gleska is building an AI-powered digital brain for businesses and industries — intelligent
              infrastructure designed to understand how an organization works, help it make better decisions,
              execute work, coordinate operations, preserve institutional knowledge, and grow more capable with
              every cycle of experience.
            </p>
          </div>
        </div>

        {/* Bottom fade */}
        <div className="absolute bottom-0 left-0 right-0 h-24 bg-gradient-to-t from-[#eef1fb] to-transparent dark:from-slate-950" />
      </section>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/*  THE PLATFORM                                                 */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <section className="mx-auto max-w-5xl px-6 py-20 sm:py-24">
        <div className="rounded-3xl border border-slate-200 bg-white p-8 shadow-xl shadow-slate-200/50 sm:p-12 dark:border-slate-800 dark:bg-slate-900 dark:shadow-none">
          <div className="flex items-start gap-4 mb-8">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-600 shadow-lg shadow-indigo-500/25">
              <Layers size={24} className="text-white" />
            </div>
            <div>
              <h3 className="font-[var(--font-anton)] text-2xl uppercase tracking-wide text-slate-900 sm:text-3xl dark:text-white">
                One Platform. Every Capability.
              </h3>
            </div>
          </div>

          <div className="space-y-6 text-base font-medium leading-[1.85] text-slate-600 sm:text-lg dark:text-slate-300">
            <p>
              A business should be able to come to{" "}
              <span className="font-bold text-indigo-600 dark:text-indigo-400">one intelligent platform</span>{" "}
              and draw on whatever AI capability its operations, industry, and goals demand. That is the future
              Gleska is building toward.
            </p>
            <p>
              The platform unites specialized intelligence across functions such as{" "}
              <span className="rounded-lg bg-indigo-50 px-2 py-0.5 font-bold text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300">
                operations
              </span>
              ,{" "}
              <span className="rounded-lg bg-blue-50 px-2 py-0.5 font-bold text-blue-700 dark:bg-blue-950/50 dark:text-blue-300">
                finance
              </span>
              ,{" "}
              <span className="rounded-lg bg-violet-50 px-2 py-0.5 font-bold text-violet-700 dark:bg-violet-950/50 dark:text-violet-300">
                management
              </span>
              , and{" "}
              <span className="rounded-lg bg-amber-50 px-2 py-0.5 font-bold text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">
                industry-specific applications
              </span>
              . Over time, these capabilities will mature into{" "}
              <strong className="text-slate-900 dark:text-white">AI workers</strong> that carry out the work of
              specialized digital roles — operating under the authority, policies, and objectives the
              organization itself defines.
            </p>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/*  INTELLIGENCE THAT GROWS                                      */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <section className="relative overflow-hidden bg-gradient-to-br from-indigo-600 via-blue-600 to-indigo-700 text-white">
        <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-white/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 -left-16 h-72 w-72 rounded-full bg-indigo-400/20 blur-3xl" />

        <div className="relative z-10 mx-auto max-w-5xl px-6 py-20 sm:py-28">
          <div className="mb-12 text-center">
            <div className="mx-auto mb-5 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-white/90 backdrop-blur">
              <TrendingUp size={14} />
              Compounding Intelligence
            </div>
            <h2 className="font-[var(--font-anton)] text-4xl uppercase leading-[0.95] tracking-wide sm:text-5xl md:text-6xl">
              Intelligence That{" "}
              <span className="bg-gradient-to-r from-amber-300 to-yellow-300 bg-clip-text text-transparent">
                Grows
              </span>{" "}
              With the Organization
            </h2>
          </div>

          <div className="space-y-8 text-center">
            <p className="mx-auto max-w-3xl text-lg font-medium leading-relaxed text-white/80 md:text-xl">
              It learns the organization&apos;s approved knowledge, processes, history, preferences, decisions,
              and lessons learned. It remembers what worked, recognizes what did not, and keeps improving within
              the boundaries the organization sets.
            </p>

            {/* Feature pills */}
            <div className="mx-auto flex max-w-3xl flex-wrap justify-center gap-3 pt-4">
              {[
                { icon: Brain, text: "Organizational Memory" },
                { icon: TrendingUp, text: "Compounding Intelligence" },
                { icon: ShieldCheck, text: "Human Control" },
                { icon: Zap, text: "Automated Routine Work" },
              ].map((pill) => (
                <div
                  key={pill.text}
                  className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm font-bold text-white backdrop-blur transition hover:bg-white/20"
                >
                  <pill.icon size={16} className="text-amber-300" />
                  {pill.text}
                </div>
              ))}
            </div>

            <div className="mx-auto max-w-3xl rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur sm:p-8">
              <p className="text-base font-medium leading-relaxed text-white/75 sm:text-lg">
                The result is something fundamentally different: an AI system with{" "}
                <strong className="text-white">organizational memory, experience, and compounding intelligence</strong>{" "}
                — built to give people{" "}
                <span className="text-amber-300">greater intelligence, greater leverage, and greater operational capacity</span>.
                Humans stay in control of critical decisions, while routine and reversible work is increasingly
                automated.
              </p>
              <p className="mt-4 font-[var(--font-anton)] text-2xl uppercase tracking-wide text-amber-300 sm:text-3xl">
                Let AI carry more of the load.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/*  ONE INTELLIGENT ORGANIZATION                                 */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <section className="mx-auto max-w-5xl px-6 py-20 sm:py-28">
        <SectionHeading
          badge="Connected Intelligence"
          title="One Intelligent Organization"
          gradient="from-blue-600 to-indigo-600"
        />

        <p className="mx-auto mb-14 max-w-3xl text-center text-lg font-medium leading-relaxed text-slate-600 dark:text-slate-400">
          The real power emerges once specialized AI systems start working together. Rather than a scatter of
          isolated AI tools, Gleska is building toward one connected AI organization — where specialized
          intelligence collaborates as a single system.
        </p>

        {/* Connected system visual */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[
            { icon: Target, name: "Sales", color: "from-emerald-500 to-teal-600" },
            { icon: Factory, name: "Operations", color: "from-blue-600 to-indigo-600" },
            { icon: Building2, name: "Finance", color: "from-violet-500 to-purple-600" },
            { icon: Layers, name: "Management", color: "from-amber-500 to-orange-600" },
          ].map((item, i) => (
            <div
              key={item.name}
              className="group relative rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm transition hover:-translate-y-1 hover:shadow-xl dark:border-slate-800 dark:bg-slate-900"
            >
              {/* Connection line (not on last) */}
              {i < 3 && (
                <div className="absolute -right-2 top-1/2 hidden h-px w-4 bg-indigo-300 sm:block dark:bg-indigo-700" />
              )}
              <div
                className={`mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br ${item.color} shadow-lg`}
              >
                <item.icon size={26} className="text-white" />
              </div>
              <h3 className="font-[var(--font-anton)] text-xl uppercase tracking-wide text-slate-900 dark:text-white">
                {item.name}
              </h3>
              <p className="mt-1 text-xs font-semibold uppercase tracking-wider text-slate-400">
                AI System
              </p>
            </div>
          ))}
        </div>

        <p className="mx-auto mt-10 max-w-3xl text-center text-base font-medium leading-relaxed text-slate-500 dark:text-slate-400">
          A sales system talks to operations. Operations coordinates with finance. Finance informs management.
          Industry-specific intelligence works alongside all of them.
        </p>
      </section>

      <GradientDivider />

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/*  INDUSTRIES                                                   */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <section className="border-y border-slate-200 bg-white px-6 py-20 sm:py-24 dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto max-w-5xl">
          <SectionHeading badge="Every Sector" title="Built for Business. Built for Industry." />

          <p className="mx-auto mb-12 max-w-3xl text-center text-lg font-medium leading-relaxed text-slate-600 dark:text-slate-400">
            From micro and small businesses to industrial organizations, our long-term vision spans every sector.
            Every industry carries its own processes, challenges, regulations, knowledge, and ways of working.
            Our vision is intelligence that{" "}
            <strong className="text-slate-900 dark:text-white">adapts to those realities</strong> — not a
            generic AI experience forced onto every organization alike.
          </p>

          <div className="flex flex-wrap justify-center gap-3">
            {INDUSTRIES.map((name) => (
              <div
                key={name}
                className="cursor-default rounded-full border border-slate-200 bg-slate-50 px-5 py-2.5 font-[var(--font-anton)] text-lg uppercase text-slate-700 transition hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:border-indigo-500 dark:hover:bg-indigo-950/50 dark:hover:text-indigo-300"
              >
                {name}
              </div>
            ))}
            <div className="cursor-default rounded-full bg-gradient-to-r from-blue-600 to-indigo-600 px-5 py-2.5 font-[var(--font-anton)] text-lg uppercase text-white">
              + Many More
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/*  OUR VISION                                                   */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <section className="mx-auto max-w-5xl px-6 py-20 sm:py-28">
        <SectionHeading
          badge="Our Vision"
          title="The Next Layer of Infrastructure"
          gradient="from-indigo-500 via-blue-500 to-cyan-500"
        />

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Card 1 */}
          <div className="rounded-2xl border border-slate-200 bg-white p-7 shadow-lg shadow-slate-200/40 transition hover:shadow-xl sm:p-9 dark:border-slate-800 dark:bg-slate-900 dark:shadow-none">
            <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 shadow-md">
              <Network size={24} className="text-white" />
            </div>
            <h3 className="mb-3 text-xl font-extrabold text-slate-900 dark:text-white">
              Fundamental Infrastructure
            </h3>
            <p className="text-base font-medium leading-[1.85] text-slate-500 dark:text-slate-400">
              Just as businesses today depend on electricity, computing, software, databases, networks, and the
              internet, we believe intelligent AI infrastructure will become{" "}
              <strong className="text-slate-900 dark:text-white">just as fundamental</strong>. Gleska&apos;s
              ambition is to help build that infrastructure.
            </p>
          </div>

          {/* Card 2 */}
          <div className="rounded-2xl border border-slate-200 bg-white p-7 shadow-lg shadow-slate-200/40 transition hover:shadow-xl sm:p-9 dark:border-slate-800 dark:bg-slate-900 dark:shadow-none">
            <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 shadow-md">
              <Globe size={24} className="text-white" />
            </div>
            <h3 className="mb-3 text-xl font-extrabold text-slate-900 dark:text-white">
              AI for Everyone
            </h3>
            <p className="text-base font-medium leading-[1.85] text-slate-500 dark:text-slate-400">
              Gleska exists to make advanced artificial intelligence accessible not only to large enterprises,
              but to the{" "}
              <strong className="text-slate-900 dark:text-white">
                smaller businesses and organizations
              </strong>{" "}
              that have traditionally been priced out of complex technology systems.
            </p>
          </div>

          {/* Card 3 — full width */}
          <div className="rounded-2xl border border-slate-200 bg-white p-7 shadow-lg shadow-slate-200/40 transition hover:shadow-xl sm:p-9 lg:col-span-2 dark:border-slate-800 dark:bg-slate-900 dark:shadow-none">
            <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-600 shadow-md">
              <Eye size={24} className="text-white" />
            </div>
            <h3 className="mb-3 text-xl font-extrabold text-slate-900 dark:text-white">
              Growing With You
            </h3>
            <p className="text-base font-medium leading-[1.85] text-slate-500 dark:text-slate-400">
              It is building an intelligent system that grows with an organization — understanding its work,
              preserving its knowledge, assisting its people, executing its processes, coordinating specialized
              intelligence, and becoming{" "}
              <strong className="text-slate-900 dark:text-white">
                more useful with every cycle of experience
              </strong>
              .
            </p>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/*  MANIFESTO STRIP                                              */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <section className="relative overflow-hidden bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 py-20 text-center text-white sm:py-28">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(99,102,241,0.15),transparent_70%)]" />
        <div className="relative z-10 mx-auto max-w-4xl space-y-7 px-6">
          <p className="font-[var(--font-anton)] text-3xl uppercase leading-[0.95] tracking-wide sm:text-4xl md:text-6xl">
            Gleska&apos;s ambition is to become a{" "}
            <span className="bg-gradient-to-r from-indigo-400 to-cyan-400 bg-clip-text text-transparent">
              foundational AI company
            </span>{" "}
            for the business &amp; industrial world
          </p>
          <p className="mx-auto inline-block max-w-2xl rounded-2xl border border-white/10 bg-white/5 px-6 py-4 text-lg font-medium leading-relaxed text-white/70 backdrop-blur md:text-xl">
            A trusted technological layer between organizations and the rapidly expanding capabilities of
            artificial intelligence.
          </p>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="mx-auto max-w-4xl px-6 py-20 text-center sm:py-24">
        <h2 className="font-[var(--font-anton)] text-3xl uppercase tracking-wide text-slate-900 sm:text-4xl md:text-5xl dark:text-white">
          Ready to experience the future?
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-lg font-medium text-slate-500 dark:text-slate-400">
          Join businesses already building with Gleska&apos;s intelligent infrastructure.
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row">
          <Link
            href="/#contact"
            className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-blue-600 to-indigo-600 px-8 py-4 text-base font-bold text-white shadow-lg shadow-indigo-500/25 transition hover:from-blue-700 hover:to-indigo-700"
          >
            Get in Touch <ArrowRight size={20} />
          </Link>
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-8 py-4 text-base font-bold text-slate-700 shadow-sm transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            Back to Home
          </Link>
        </div>
      </section>

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
              <Link href="#" className="transition-colors hover:text-white">
                Terms of Service
              </Link>
              <Link href="/#contact" className="transition-colors hover:text-white">
                Contact
              </Link>
            </div>
            <p className="text-amber-300">Made with ❤️ in India</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
