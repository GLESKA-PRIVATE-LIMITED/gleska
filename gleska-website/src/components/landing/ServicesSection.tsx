"use client";

import React from "react";
import Link from "next/link";
import {
  Users,
  Truck,
  FileText,
  ShoppingCart,
  Landmark,
  Compass,
  Wrench,
  BrainCircuit,
  Search,
  ArrowRight,
  Zap,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/context/LanguageContext";

interface AgentCard {
  id: string;
  title: string;
  status: string;
  icon: React.ComponentType<{ className?: string; size?: number; strokeWidth?: number }>;
  iconBoxStyle: string;
  statusColor: string;
  ctaColor: string;
  dashboardCtaColor: string;
  hoverGlow: string;
}

function AgentCardsGrid({ agentCards }: { agentCards: AgentCard[] }) {
  const { user } = useAuth();
  const { t } = useLanguage();

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2.5 sm:gap-3.5 lg:gap-4 items-stretch">
      {agentCards.map((agent) => (
        <div
          key={agent.title}
          className={`group relative flex flex-col justify-between rounded-xl sm:rounded-2xl border border-slate-200/90 bg-white p-3 sm:p-3.5 md:p-4 shadow-sm shadow-slate-900/5 transition-all duration-250 ease-out hover:-translate-y-1 active:translate-y-0 active:scale-[0.99] dark:border-slate-800 dark:bg-slate-900 ${agent.hoverGlow}`}
        >
          {/* Top Row: Icon & Title on the Same Row */}
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
            <div
              className={`flex h-8 w-8 sm:h-9 sm:w-9 items-center justify-center rounded-lg sm:rounded-xl border transition-transform duration-200 group-hover:scale-105 shrink-0 ${agent.iconBoxStyle}`}
            >
              <agent.icon className="h-4 w-4 sm:h-4.5 sm:w-4.5 text-black dark:text-white" strokeWidth={2.25} />
            </div>
            <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white leading-tight tracking-tight min-w-0">
              {agent.title}
            </h3>
          </div>

          {/* Action Row: Subscribe / Dashboard */}
          <div className="mt-3 sm:mt-3.5 flex items-center justify-start border-t border-slate-100 pt-2 sm:pt-2.5 text-xs font-semibold dark:border-slate-800/80">
            {agent.id === "01" ? (
              <Link
                href={
                  user
                    ? "/employer/dashboard"
                    : "/auth/signin?next=%2Femployer%2Fdashboard"
                }
                className={`inline-flex items-center gap-1 text-[11px] sm:text-xs font-bold transition-colors ${agent.dashboardCtaColor}`}
              >
                <span>{t("services.dashboard")}</span>
                <ArrowRight size={13} className="shrink-0" />
              </Link>
            ) : agent.id === "02" ? (
              <Link
                href="/logistics"
                className={`inline-flex items-center gap-1 text-[11px] sm:text-xs font-bold transition-colors ${agent.ctaColor}`}
              >
                <span>{t("services.dashboard")}</span>
                <ArrowRight size={13} className="shrink-0" />
              </Link>
            ) : agent.id === "03" ? (
              <Link
                href="/tender-filing"
                className={`inline-flex items-center gap-1 text-[11px] sm:text-xs font-bold transition-colors ${agent.ctaColor}`}
              >
                <span>{t("services.dashboard")}</span>
                <ArrowRight size={13} className="shrink-0" />
              </Link>
            ) : agent.id === "04" ? (
              <Link
                href="/procurement"
                className={`inline-flex items-center gap-1 text-[11px] sm:text-xs font-bold transition-colors ${agent.ctaColor}`}
              >
                <span>{t("services.dashboard")}</span>
                <ArrowRight size={13} className="shrink-0" />
              </Link>
            ) : agent.id === "05" ? (
              <Link
                href="/financial"
                className={`inline-flex items-center gap-1 text-[11px] sm:text-xs font-bold transition-colors ${agent.ctaColor}`}
              >
                <span>{t("services.dashboard")}</span>
                <ArrowRight size={13} className="shrink-0" />
              </Link>
            ) : agent.id === "06" ? (
              <Link
                href="/tender-tracking"
                className={`inline-flex items-center gap-1 text-[11px] sm:text-xs font-bold transition-colors ${agent.ctaColor}`}
              >
                <span>{t("services.dashboard")}</span>
                <ArrowRight size={13} className="shrink-0" />
              </Link>
            ) : (
              <Link
                href="/#services"
                className={`inline-flex items-center gap-1 text-[11px] sm:text-xs font-bold transition-colors ${agent.ctaColor}`}
              >
                <span>{t("services.dashboard")}</span>
                <ArrowRight size={13} className="shrink-0" />
              </Link>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function ServicesSection() {
  const { t } = useLanguage();

  const agentCards: AgentCard[] = [
    {
      id: "01",
      title: t('services.agentHiring'),
      status: t('services.active'),
      icon: Users,
      iconBoxStyle: "bg-blue-50 border-blue-100 dark:bg-blue-950/60 dark:border-blue-800",
      statusColor: "bg-blue-50 text-blue-600 border border-blue-200/60 dark:bg-blue-950/60 dark:text-blue-400 dark:border-blue-800",
      ctaColor: "text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300",
      dashboardCtaColor: "text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300",
      hoverGlow: "hover:border-blue-400/80 hover:shadow-[0_10px_25px_-5px_rgba(37,99,235,0.22),0_4px_10px_-3px_rgba(37,99,235,0.15)] focus-within:border-blue-400 focus-within:shadow-[0_10px_25px_-5px_rgba(37,99,235,0.22)] active:shadow-[0_4px_12px_-2px_rgba(37,99,235,0.2)]",
    },
    {
      id: "02",
      title: t('services.agentLogistics'),
      status: t('services.comingSoon'),
      icon: Truck,
      iconBoxStyle: "bg-emerald-50 border-emerald-100 dark:bg-emerald-950/60 dark:border-emerald-800",
      statusColor: "bg-emerald-50 text-emerald-600 border border-emerald-200/60 dark:bg-emerald-950/60 dark:text-emerald-400 dark:border-emerald-800",
      ctaColor: "text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300",
      dashboardCtaColor: "text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300",
      hoverGlow: "hover:border-emerald-400/80 hover:shadow-[0_10px_25px_-5px_rgba(16,185,129,0.22),0_4px_10px_-3px_rgba(16,185,129,0.15)] focus-within:border-emerald-400 focus-within:shadow-[0_10px_25px_-5px_rgba(16,185,129,0.22)] active:shadow-[0_4px_12px_-2px_rgba(16,185,129,0.2)]",
    },
    {
      id: "03",
      title: t('services.agentTender'),
      status: t('services.comingSoon'),
      icon: FileText,
      iconBoxStyle: "bg-amber-50 border-amber-100 dark:bg-amber-950/60 dark:border-amber-800",
      statusColor: "bg-amber-50 text-amber-600 border border-amber-200/60 dark:bg-amber-950/60 dark:text-amber-400 dark:border-amber-800",
      ctaColor: "text-amber-600 hover:text-amber-700 dark:text-amber-400 dark:hover:text-amber-300",
      dashboardCtaColor: "text-amber-600 hover:text-amber-700 dark:text-amber-400 dark:hover:text-amber-300",
      hoverGlow: "hover:border-amber-400/80 hover:shadow-[0_10px_25px_-5px_rgba(245,158,11,0.24),0_4px_10px_-3px_rgba(245,158,11,0.16)] focus-within:border-amber-400 focus-within:shadow-[0_10px_25px_-5px_rgba(245,158,11,0.24)] active:shadow-[0_4px_12px_-2px_rgba(245,158,11,0.2)]",
    },
    {
      id: "04",
      title: t('services.agentProcurement'),
      status: t('services.comingSoon'),
      icon: ShoppingCart,
      iconBoxStyle: "bg-purple-50 border-purple-100 dark:bg-purple-950/60 dark:border-purple-800",
      statusColor: "bg-purple-50 text-purple-600 border border-purple-200/60 dark:bg-purple-950/60 dark:text-purple-400 dark:border-purple-800",
      ctaColor: "text-purple-600 hover:text-purple-700 dark:text-purple-400 dark:hover:text-purple-300",
      dashboardCtaColor: "text-purple-600 hover:text-purple-700 dark:text-purple-400 dark:hover:text-purple-300",
      hoverGlow: "hover:border-purple-400/80 hover:shadow-[0_10px_25px_-5px_rgba(168,85,247,0.22),0_4px_10px_-3px_rgba(168,85,247,0.15)] focus-within:border-purple-400 focus-within:shadow-[0_10px_25px_-5px_rgba(168,85,247,0.22)] active:shadow-[0_4px_12px_-2px_rgba(168,85,247,0.2)]",
    },
    {
      id: "05",
      title: t('services.agentFinancial'),
      status: t('services.comingSoon'),
      icon: Landmark,
      iconBoxStyle: "bg-indigo-50 border-indigo-100 dark:bg-indigo-950/60 dark:border-indigo-800",
      statusColor: "bg-indigo-50 text-indigo-600 border border-indigo-200/60 dark:bg-indigo-950/60 dark:text-indigo-400 dark:border-indigo-800",
      ctaColor: "text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300",
      dashboardCtaColor: "text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300",
      hoverGlow: "hover:border-indigo-400/80 hover:shadow-[0_10px_25px_-5px_rgba(99,102,241,0.22),0_4px_10px_-3px_rgba(99,102,241,0.15)] focus-within:border-indigo-400 focus-within:shadow-[0_10px_25px_-5px_rgba(99,102,241,0.22)] active:shadow-[0_4px_12px_-2px_rgba(99,102,241,0.2)]",
    },
    {
      id: "06",
      title: t('services.agentTenderTracking'),
      status: t('services.comingSoon'),
      icon: Compass,
      iconBoxStyle: "bg-cyan-50 border-cyan-100 dark:bg-cyan-950/60 dark:border-cyan-800",
      statusColor: "bg-cyan-50 text-cyan-600 border border-cyan-200/60 dark:bg-cyan-950/60 dark:text-cyan-400 dark:border-cyan-800",
      ctaColor: "text-cyan-600 hover:text-cyan-700 dark:text-cyan-400 dark:hover:text-cyan-300",
      dashboardCtaColor: "text-cyan-600 hover:text-cyan-700 dark:text-cyan-400 dark:hover:text-cyan-300",
      hoverGlow: "hover:border-cyan-400/80 hover:shadow-[0_10px_25px_-5px_rgba(6,182,212,0.22),0_4px_10px_-3px_rgba(6,182,212,0.15)] focus-within:border-cyan-400 focus-within:shadow-[0_10px_25px_-5px_rgba(6,182,212,0.22)] active:shadow-[0_4px_12px_-2px_rgba(6,182,212,0.2)]",
    },
    {
      id: "07",
      title: t('services.agentMaintenance'),
      status: t('services.comingSoon'),
      icon: Wrench,
      iconBoxStyle: "bg-rose-50 border-rose-100 dark:bg-rose-950/60 dark:border-rose-800",
      statusColor: "bg-rose-50 text-rose-600 border border-rose-200/60 dark:bg-rose-950/60 dark:text-rose-400 dark:border-rose-800",
      ctaColor: "text-rose-600 hover:text-rose-700 dark:text-rose-400 dark:hover:text-rose-300",
      dashboardCtaColor: "text-rose-600 hover:text-rose-700 dark:text-rose-400 dark:hover:text-rose-300",
      hoverGlow: "hover:border-rose-400/80 hover:shadow-[0_10px_25px_-5px_rgba(244,63,94,0.22),0_4px_10px_-3px_rgba(244,63,94,0.15)] focus-within:border-rose-400 focus-within:shadow-[0_10px_25px_-5px_rgba(244,63,94,0.22)] active:shadow-[0_4px_12px_-2px_rgba(244,63,94,0.2)]",
    },
    {
      id: "08",
      title: t('services.agentBrain'),
      status: t('services.comingSoon'),
      icon: BrainCircuit,
      iconBoxStyle: "bg-violet-50 border-violet-100 dark:bg-violet-950/60 dark:border-violet-800",
      statusColor: "bg-violet-50 text-violet-600 border border-violet-200/60 dark:bg-violet-950/60 dark:text-violet-400 dark:border-violet-800",
      ctaColor: "text-violet-600 hover:text-violet-700 dark:text-violet-400 dark:hover:text-violet-300",
      dashboardCtaColor: "text-violet-600 hover:text-violet-700 dark:text-violet-400 dark:hover:text-violet-300",
      hoverGlow: "hover:border-violet-400/80 hover:shadow-[0_10px_25px_-5px_rgba(139,92,246,0.22),0_4px_10px_-3px_rgba(139,92,246,0.15)] focus-within:border-violet-400 focus-within:shadow-[0_10px_25px_-5px_rgba(139,92,246,0.22)] active:shadow-[0_4px_12px_-2px_rgba(139,92,246,0.2)]",
    },
  ];

  const deploymentAgents = [
    {
      name: t('services.agentHiring'),
      status: t('services.statusSubscribed'),
      dotColor: "bg-blue-600 shadow-blue-500/50",
      statusStyle: "bg-blue-50 text-blue-600 border-blue-200/60 dark:bg-blue-950/60 dark:text-blue-400 dark:border-blue-800",
    },
    {
      name: t('services.agentLogistics'),
      status: t('services.statusUnsubscribed'),
      dotColor: "bg-emerald-500 shadow-emerald-500/50",
      statusStyle: "bg-slate-100 text-slate-500 border-slate-200/60 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700",
    },
    {
      name: t('services.agentTender'),
      status: t('services.statusUnsubscribed'),
      dotColor: "bg-amber-500 shadow-amber-500/50",
      statusStyle: "bg-slate-100 text-slate-500 border-slate-200/60 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700",
    },
  ];

  return (
    <section id="services" className="relative px-3 sm:px-6 py-8 sm:py-16 md:py-20">
      <div className="mx-auto max-w-7xl space-y-8 sm:space-y-12">
        
        {/* ========================================================= */}
        {/* FIRST LARGE CONTAINER: Agent Cards                        */}
        {/* ========================================================= */}
        <div className="rounded-2xl sm:rounded-3xl border border-slate-200/80 bg-white/70 p-3.5 sm:p-8 md:p-10 lg:p-12 shadow-2xl shadow-slate-900/5 backdrop-blur-xl dark:border-slate-800/80 dark:bg-slate-900/70">
          
          {/* Section Header */}
          <div className="mb-4 sm:mb-8 md:mb-10 text-center">
            {/* HEADING: BUSINESS & INDUSTRIAL AI AGENTS */}
            <h1 className="mb-1 sm:mb-2 block font-[var(--font-anton)] text-xl sm:text-3xl md:text-5xl lg:text-6xl uppercase tracking-wide text-slate-900 md:whitespace-nowrap dark:text-white">
              {t('services.title')}
            </h1>

            <h2 className="inline-block pr-2 sm:pr-3 font-[var(--font-anton)] text-base sm:text-2xl md:text-4xl lg:text-5xl uppercase tracking-wide bg-gradient-to-r from-blue-600 via-indigo-600 to-emerald-600 bg-clip-text text-transparent sm:whitespace-nowrap">
              {t('services.subtitle')}
            </h2>
            <p className="mt-1.5 sm:mt-3 text-xs sm:text-base md:text-lg font-medium leading-relaxed text-slate-600 dark:text-slate-300 max-w-2xl mx-auto line-clamp-2 sm:line-clamp-none">
              {t('services.description')}
            </p>
          </div>

          {/* Compact Square Agent Cards Grid */}
          <AgentCardsGrid agentCards={agentCards} />

          {/* Compact Pill Search Bar */}
          <div className="mt-5 sm:mt-7 md:mt-8 flex justify-center">
            <div className="w-full max-w-xs sm:max-w-md">
              <div className="group flex items-center rounded-full border border-slate-200/90 bg-white/95 px-3.5 py-2 sm:px-4 sm:py-2.5 shadow-sm shadow-slate-900/5 backdrop-blur-sm transition-all duration-200 focus-within:border-indigo-400 focus-within:shadow-md focus-within:shadow-indigo-500/10 hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900/95 dark:focus-within:border-indigo-500">
                <Search className="h-4 w-4 shrink-0 text-slate-400 transition-colors group-focus-within:text-indigo-600 dark:text-slate-500 dark:group-focus-within:text-indigo-400" />
                <input
                  type="text"
                  placeholder="Search AI agents..."
                  aria-label="Search AI agents"
                  className="ml-2.5 w-full bg-transparent text-xs sm:text-sm font-medium text-slate-800 placeholder:text-slate-400 focus:outline-none dark:text-slate-100 dark:placeholder:text-slate-500"
                />
                <div className="ml-2 flex h-6 w-6 sm:h-7 sm:w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition-colors group-focus-within:bg-indigo-50 group-focus-within:text-indigo-600 dark:bg-slate-800 dark:text-slate-400 dark:group-focus-within:bg-indigo-950 dark:group-focus-within:text-indigo-400">
                  <ArrowRight size={13} />
                </div>
              </div>
            </div>
          </div>

        </div>

        {/* ========================================================= */}
        {/* SECOND LARGE CONTAINER: Live Deployment Map & Brain Viz   */}
        {/* ========================================================= */}
        <div className="rounded-3xl border border-slate-200/80 bg-white/70 p-6 sm:p-10 md:p-12 shadow-2xl shadow-slate-900/5 backdrop-blur-xl dark:border-slate-800/80 dark:bg-slate-900/70">
          <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-12">
            
            {/* LEFT SIDE: Deployment Text & Status List */}
            <div className="lg:col-span-7 space-y-6">
              <div className="inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-indigo-50 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950/50 dark:text-indigo-300">
                <Zap size={14} />
                {t('services.liveAgentsBadge')}
              </div>

              <h2 className="inline-block pr-3 font-[var(--font-anton)] text-3xl sm:text-4xl lg:text-[2.6rem] xl:text-5xl uppercase tracking-wide bg-gradient-to-r from-blue-600 via-indigo-600 to-emerald-600 bg-clip-text text-transparent sm:whitespace-nowrap">
                {t('services.liveTitle')}
              </h2>

              <p className="text-base font-medium leading-relaxed text-slate-600 sm:text-lg dark:text-slate-300">
                {t('services.liveDescription')}
              </p>

              {/* Three Specialist Agent Entries */}
              <div className="pt-2 space-y-3">
                {deploymentAgents.map((agent) => (
                  <div
                    key={agent.name}
                    className="flex items-center justify-between rounded-xl border border-slate-200/80 bg-white/90 px-4 py-3.5 shadow-sm transition hover:border-indigo-200 dark:border-slate-800 dark:bg-slate-800/80"
                  >
                    <div className="flex items-center gap-3">
                      <span className={`h-3 w-3 rounded-full ${agent.dotColor} shadow-md`}></span>
                      <span className="text-base font-bold text-slate-900 dark:text-white">
                        {agent.name}
                      </span>
                    </div>
                    <span
                      className={`rounded-full border px-3 py-1 text-[11px] font-bold uppercase tracking-wider ${agent.statusStyle}`}
                    >
                      {agent.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* RIGHT SIDE: Circular Digital Brain Visualization */}
            <div className="lg:col-span-5 flex justify-center py-4">
              <div className="relative flex h-72 w-72 items-center justify-center sm:h-96 sm:w-96">
                
                {/* Outer Glow effect */}
                <div className="absolute inset-0 rounded-full bg-gradient-to-tr from-blue-400/20 via-emerald-400/20 to-amber-400/20 blur-2xl"></div>

                {/* Rotating Ring Container */}
                <div
                  className="absolute inset-0 rounded-full animate-[spin_20s_linear_infinite]"
                  style={{
                    background:
                      "conic-gradient(from 0deg, #2563eb 0deg 120deg, #10b981 120deg 240deg, #f59e0b 240deg 360deg)",
                    padding: "12px",
                  }}
                >
                  {/* Inner masking shadow ring */}
                  <div className="h-full w-full rounded-full bg-slate-100/30 backdrop-blur-xs"></div>
                </div>

                {/* Stationary Center Core Card */}
                <div className="relative z-10 flex h-48 w-48 sm:h-64 sm:w-64 flex-col items-center justify-center rounded-full border border-slate-200/90 bg-white/95 p-4 text-center shadow-xl backdrop-blur-md dark:border-slate-800 dark:bg-slate-900/95">
                  <span className="font-[var(--font-anton)] text-xl sm:text-2xl uppercase tracking-wider text-slate-900 dark:text-white leading-tight">
                    {t('services.companys')}
                  </span>
                  <span className="font-[var(--font-anton)] text-xl sm:text-2xl uppercase tracking-wider text-indigo-600 dark:text-indigo-400 leading-tight">
                    {t('services.digitalBrain')}
                  </span>
                  <span className="mt-2 text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">
                    {t('services.coreOrchestrator')}
                  </span>
                </div>

              </div>
            </div>

          </div>
        </div>

      </div>
    </section>
  );
}
