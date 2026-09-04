"use client";

import React from "react";
import Link from "next/link";
import { ArrowRight, LayoutDashboard, Zap } from "lucide-react";
import { useAuth } from "@/context/AuthContext";

interface AgentCard {
  id: string;
  title: string;
  status: string;
  description: string;
  badgeColor: string;
  statusColor: string;
  topBorder: string;
  ctaColor: string;
  dashboardCtaColor: string;
}

function AgentCardsGrid({ agentCards }: { agentCards: AgentCard[] }) {
  const { user } = useAuth();

  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-3 sm:gap-8">
      {agentCards.map((agent) => (
        <div
          key={agent.title}
          className={`flex flex-col justify-between rounded-2xl border border-slate-200/80 bg-white/95 p-6 sm:p-8 shadow-lg shadow-slate-900/5 backdrop-blur-md transition-all duration-300 hover:-translate-y-1 hover:shadow-xl dark:border-slate-800/80 dark:bg-slate-900/90 ${agent.topBorder}`}
        >
          <div>
            {/* Top Bar: Number ID & Status Badge */}
            <div className="flex items-center justify-between">
              <span className={`flex h-10 w-12 items-center justify-center rounded-xl font-mono text-sm font-bold ${agent.badgeColor}`}>
                {agent.id}
              </span>
              <span className={`rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-wider ${agent.statusColor}`}>
                {agent.status}
              </span>
            </div>

            {/* Title & Description */}
            <h3 className="mt-6 text-xl font-bold tracking-tight text-slate-900 sm:text-2xl dark:text-white">
              {agent.title}
            </h3>
            <p className="mt-3 text-sm font-medium leading-relaxed text-slate-600 sm:text-base dark:text-slate-300">
              {agent.description}
            </p>
          </div>

          {/* Footer / CTA */}
          <div className="mt-8 flex items-center justify-between border-t border-slate-100 pt-5 text-sm font-semibold text-slate-500 dark:border-slate-800 dark:text-slate-400">
            <span className="font-mono text-xs uppercase tracking-wider">Custom pricing</span>
            {agent.title === "Hiring Agent" ? (
              <Link
                href={user ? "/employer/dashboard" : "/employer/auth"}
                className={`inline-flex items-center gap-1.5 font-bold transition-colors ${agent.dashboardCtaColor}`}
              >
                {user ? "Dashboard" : "Subscribe"} {user ? <LayoutDashboard size={16} /> : <ArrowRight size={16} />}
              </Link>
            ) : (
              <span className={`inline-flex items-center gap-1.5 font-bold ${agent.ctaColor}`}>
                Coming Soon
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function ServicesSection() {
  const agentCards: AgentCard[] = [
    {
      id: "01",
      title: "Hiring Agent",
      status: "ACTIVE",
      description:
        "Real-time blue-collar hiring — sources, screens, and fills open roles on the ground, not just on a job board.",
      badgeColor: "bg-blue-50 text-blue-600 border border-blue-100",
      statusColor: "bg-blue-50 text-blue-600 border border-blue-200/60",
      topBorder: "border-t-4 border-t-blue-600",
      ctaColor: "text-blue-600 hover:text-blue-700",
      dashboardCtaColor: "text-blue-600 hover:text-blue-700",
    },
    {
      id: "02",
      title: "Logistics Agent",
      status: "COMING SOON",
      description:
        "Runs dispatch for fleet, bus, and vehicle operations — coordinating routes, drivers, and schedules in real time.",
      badgeColor: "bg-emerald-50 text-emerald-600 border border-emerald-100",
      statusColor: "bg-emerald-50 text-emerald-600 border border-emerald-200/60",
      topBorder: "border-t-4 border-t-emerald-500",
      ctaColor: "text-emerald-600 hover:text-emerald-700",
      dashboardCtaColor: "text-emerald-600 hover:text-emerald-700",
    },
    {
      id: "03",
      title: "Tender Filing Agent",
      status: "COMING SOON",
      description:
        "Finds and fills government tender bids on your behalf — from document prep to submission.",
      badgeColor: "bg-amber-50 text-amber-600 border border-amber-100",
      statusColor: "bg-amber-50 text-amber-600 border border-amber-200/60",
      topBorder: "border-t-4 border-t-amber-500",
      ctaColor: "text-amber-600 hover:text-amber-700",
      dashboardCtaColor: "text-amber-600 hover:text-amber-700",
    },
  ];

  const deploymentAgents = [
    {
      name: "Hiring Agent",
      status: "SUBSCRIBED",
      dotColor: "bg-blue-600 shadow-blue-500/50",
      statusStyle: "bg-blue-50 text-blue-600 border-blue-200/60 dark:bg-blue-950/60 dark:text-blue-400 dark:border-blue-800",
    },
    {
      name: "Logistics Agent",
      status: "UNSUBSCRIBED",
      dotColor: "bg-emerald-500 shadow-emerald-500/50",
      statusStyle: "bg-slate-100 text-slate-500 border-slate-200/60 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700",
    },
    {
      name: "Tender Filing Agent",
      status: "UNSUBSCRIBED",
      dotColor: "bg-amber-500 shadow-amber-500/50",
      statusStyle: "bg-slate-100 text-slate-500 border-slate-200/60 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700",
    },
  ];

  return (
    <section id="services" className="relative px-6 py-20 sm:py-24">
      <div className="mx-auto max-w-7xl space-y-8 sm:space-y-12">
        
        {/* ========================================================= */}
        {/* FIRST LARGE CONTAINER: Agent Cards                        */}
        {/* ========================================================= */}
        <div className="rounded-3xl border border-slate-200/80 bg-white/70 p-6 sm:p-10 md:p-12 shadow-2xl shadow-slate-900/5 backdrop-blur-xl dark:border-slate-800/80 dark:bg-slate-900/70">
          
          {/* Section Header */}
          <div className="mb-12 text-center">
            {/* HEADING: BUSINESS & INDUSTRIAL AI AGENTS */}
            <h1 className="mb-2 block font-[var(--font-anton)] text-2xl sm:text-4xl md:text-5xl lg:text-6xl xl:text-7xl uppercase tracking-wide text-slate-900 md:whitespace-nowrap dark:text-white">
              BUSINESS &amp; INDUSTRIAL AI AGENTS
            </h1>

            <h2 className="inline-block pr-3 font-[var(--font-anton)] text-3xl sm:text-4xl md:text-5xl lg:text-5xl uppercase tracking-wide bg-gradient-to-r from-blue-600 via-indigo-600 to-emerald-600 bg-clip-text text-transparent sm:whitespace-nowrap">
              READY TO EXPERIENCE THE FUTURE
            </h2>
            <p className="mt-4 text-lg font-medium leading-relaxed text-slate-600 sm:text-xl dark:text-slate-300">
              Join businesses already building with Gleska&apos;s intelligent infrastructure.
            </p>
          </div>

          {/* Three Agent Cards Grid */}
          <AgentCardsGrid agentCards={agentCards} />

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
                LIVE DEPLOYED AGENTS
              </div>

              <h2 className="inline-block pr-3 font-[var(--font-anton)] text-3xl sm:text-4xl lg:text-[2.6rem] xl:text-5xl uppercase tracking-wide bg-gradient-to-r from-blue-600 via-indigo-600 to-emerald-600 bg-clip-text text-transparent sm:whitespace-nowrap">
                COMPANY&apos;S DEPLOYMENT
              </h2>

              <p className="text-base font-medium leading-relaxed text-slate-600 sm:text-lg dark:text-slate-300">
                Every agent plugs into the same intelligent core — subscribe to only the ones your business runs on.
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
                    COMPANY&apos;S
                  </span>
                  <span className="font-[var(--font-anton)] text-xl sm:text-2xl uppercase tracking-wider text-indigo-600 dark:text-indigo-400 leading-tight">
                    DIGITAL BRAIN
                  </span>
                  <span className="mt-2 text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">
                    CORE ORCHESTRATOR
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
