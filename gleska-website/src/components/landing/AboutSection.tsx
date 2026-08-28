"use client";

import React from "react";
import { BrainCircuit, Cpu, Sparkles, Target } from "lucide-react";

export default function AboutSection() {
  return (
    <section id="about" className="relative px-6 py-20 sm:py-24">
      <div className="mx-auto max-w-7xl">
        
        {/* ========================================================= */}
        {/* MOTHER ABOUT CONTAINER                                    */}
        {/* ========================================================= */}
        <div className="rounded-[2.5rem] border border-slate-200/80 bg-white/70 p-6 sm:p-10 md:p-12 shadow-2xl shadow-slate-900/5 backdrop-blur-xl dark:border-slate-800/80 dark:bg-slate-900/70 space-y-8 sm:space-y-12">
          
          {/* Header */}
          <div className="max-w-3xl text-left">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-indigo-50 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950/50 dark:text-indigo-300">
              <BrainCircuit size={14} />
              ABOUT GO LESKA AI
            </div>
            <h2 className="font-[var(--font-anton)] text-4xl uppercase tracking-wide text-slate-900 sm:text-5xl md:text-6xl dark:text-white leading-[0.95]">
              BUILDING THE FUTURE OF INDUSTRIAL INTELLIGENCE
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
                  BUILDING THE{" "}
                  <span className="bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 bg-clip-text text-transparent">
                    AI BRAIN
                  </span>{" "}
                  FOR{" "}
                  <span className="bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
                    BUSINESSES
                  </span>{" "}
                  &amp;{" "}
                  <span className="bg-gradient-to-r from-emerald-500 to-teal-600 bg-clip-text text-transparent">
                    INDUSTRIES
                  </span>
                </h3>
              </div>

              <div className="space-y-4 pt-2 text-base font-medium leading-relaxed text-slate-600 sm:text-lg dark:text-slate-300">
                <p>
                  At Gleska, we believe AI is not just a feature or a tool — it is the underlying engine for modern business. As physical infrastructure was essential to the industrial era, digital infrastructure, intelligence, and execution engines are critical to the future. GO LESKA builds the digital brain for businesses and industries, ensuring intelligence scales alongside operational growth.
                </p>
                <p>
                  AI is designed to sit alongside existing operations, connect disconnected workflows, and draw actionable intelligence from across data streams. Whether managing workforce allocation, tracking fleet and logistics, or automating public tender discovery and bidding, our platform scales effortlessly with business complexity. Our agents are specialized execution engines built for real work, not conversational bots.
                </p>
              </div>

              <div className="mt-4 inline-flex items-center gap-2.5 rounded-xl border border-blue-200/80 bg-gradient-to-r from-blue-50 to-indigo-50 px-4 py-2.5 text-xs font-bold text-blue-800 dark:border-blue-900/50 dark:from-blue-950/40 dark:to-indigo-950/40 dark:text-blue-200">
                <Sparkles size={16} className="text-blue-600" />
                An AI brain built for real operations, real execution, and quantifiable outcomes.
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
                Traditional software requires manual inputs, constant training, and rigid processes that stall business growth. Our intelligence layer learns from operational patterns, user interactions, and workflow data to optimize dispatch, allocation, and response times automatically. The result is a system that understands the nuances of trade execution, worker preferences, and employer demands — continuously refining itself so businesses can focus on scale.
              </p>

              <div className="mt-4 inline-flex items-center gap-2.5 rounded-xl border border-emerald-200/80 bg-gradient-to-r from-emerald-50 to-teal-50 px-4 py-2.5 text-xs font-bold text-emerald-800 dark:border-emerald-900/50 dark:from-emerald-950/40 dark:to-teal-950/40 dark:text-emerald-200">
                <Cpu size={16} className="text-emerald-600" />
                Autonomous adaptation: Faster dispatch, higher match accuracy, lower overhead.
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
                  The modern enterprise operates across multiple domains — hiring, operations, supply chain, and compliance. Rather than deploying fragmented point solutions, GO LESKA provides a unified, specialized agent architecture that acts as a single cohesive intelligence layer.
                </p>
                <p>
                  From micro-enterprises and regional trade contractors to large industrial conglomerates spanning manufacturing, construction, logistics, and infrastructure, our platform empowers teams to run faster, eliminate administrative friction, and achieve seamless operational excellence.
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
                OUR VISION
              </h3>
            </div>

            <div className="space-y-4 text-base font-medium leading-relaxed text-slate-600 sm:text-lg dark:text-slate-300">
              <p>
                Our vision is to build India&apos;s premier AI execution infrastructure for blue-collar trade operations and enterprise management, connecting software, hardware networks, and ground operations into a single intelligent engine that will drive growth for millions of businesses and workers across the nation.
              </p>
              <p>
                We envision a world where autonomous digital intelligence takes over heavy administrative, scheduling, and logistical tasks, enabling businesses to scale effortlessly without linear operational costs.
              </p>
              <p>
                By building an intelligent system that grows with the organization — from automating workforce dispatch to streamlining language processing, worker tracking, and tender submissions, Gleska is establishing the digital foundation for next-generation industrial productivity.
              </p>
            </div>

            {/* Mission Highlight Card */}
            <div className="mt-6 rounded-2xl border border-amber-300/80 bg-gradient-to-r from-amber-500/10 via-indigo-500/10 to-blue-500/10 p-6 sm:p-8 dark:border-amber-500/40">
              <p className="font-[var(--font-anton)] text-lg uppercase tracking-wide text-slate-900 sm:text-xl md:text-2xl leading-snug dark:text-white">
                GLESKA&apos;S MISSION IS TO BECOME A TRANSFORMATIVE AI COMPANY FOR THE BUSINESS AND INDUSTRIAL WORLD — A TRUSTED TECHNOLOGICAL LAYER BETWEEN ORGANIZATIONS AND GROUND-LEVEL OPERATIONS WITH INTELLIGENCE, SPEED, AND SCALE.
              </p>
            </div>

          </div>

        </div>

      </div>
    </section>
  );
}
