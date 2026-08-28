"use client";

import React from "react";
import Link from "next/link";
import { ArrowLeft, FileText, Shield, Zap } from "lucide-react";
import Navbar from "@/components/landing/Navbar";

export default function TermsPage() {
  return (
    <div className="relative min-h-screen overflow-x-clip bg-[#eef1fb] font-sans text-slate-900 selection:bg-indigo-500 selection:text-white dark:bg-slate-950 dark:text-slate-100">
      
      {/* ── NAVIGATION ── */}
      <Navbar />

      {/* ── HERO HEADER ── */}
      <section className="relative overflow-hidden bg-gradient-to-br from-indigo-600 via-blue-600 to-indigo-700 text-white">
        {/* Background blobs */}
        <div className="pointer-events-none absolute -right-32 -top-32 h-96 w-96 rounded-full bg-white/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-20 -left-20 h-72 w-72 rounded-full bg-indigo-400/20 blur-3xl" />

        <div className="relative z-10 mx-auto max-w-7xl px-6 py-16 sm:py-20 md:py-24">
          <Link
            href="/"
            className="mb-8 inline-flex items-center gap-1.5 text-sm font-semibold text-white/70 transition hover:text-white"
          >
            <ArrowLeft size={16} /> Back to home
          </Link>

          <div className="max-w-3xl space-y-4">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-white/90 backdrop-blur">
              <FileText size={14} />
              Legal &amp; Compliance
            </div>
            <h1 className="font-[var(--font-anton)] text-4xl uppercase leading-[0.95] tracking-wide sm:text-6xl md:text-7xl">
              Terms &amp;{" "}
              <span className="bg-gradient-to-r from-amber-300 to-yellow-300 bg-clip-text text-transparent">
                Conditions
              </span>
            </h1>
            <p className="max-w-2xl text-base font-medium leading-relaxed text-white/75 sm:text-lg">
              Users of the Platform, Eligibility, and the Business–Worker Relationship
            </p>
          </div>
        </div>
      </section>

      {/* ── TERMS DOCUMENT CONTENT CONTAINER ── */}
      <section className="relative px-6 py-16 sm:py-20">
        <div className="mx-auto max-w-5xl">
          <div className="rounded-3xl border border-slate-200/80 bg-white/90 p-6 sm:p-12 md:p-16 shadow-2xl shadow-slate-900/5 backdrop-blur-xl dark:border-slate-800/80 dark:bg-slate-900/90 space-y-12">

            {/* Document Header Note */}
            <div className="flex items-center gap-3 rounded-2xl border border-indigo-100 bg-indigo-50/60 p-4 text-xs font-semibold text-indigo-900 dark:border-indigo-900/50 dark:bg-indigo-950/40 dark:text-indigo-200">
              <Shield size={18} className="shrink-0 text-indigo-600 dark:text-indigo-400" />
              <span>
                These Terms and Conditions govern the use of the GO LESKA AI platform, establishing eligibility standards and defining the Business–Worker relationship.
              </span>
            </div>

            {/* SECTION 1 */}
            <div className="space-y-6 border-b border-slate-100 pb-10 dark:border-slate-800">
              <h2 className="font-[var(--font-anton)] text-2xl uppercase tracking-wide text-indigo-600 sm:text-3xl dark:text-indigo-400">
                1. Types of Users
              </h2>
              <p className="text-sm font-medium leading-relaxed text-slate-600 sm:text-base dark:text-slate-300">
                The Platform may be used by different categories of Users, including the following:
              </p>
              
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 pt-2">
                <div className="rounded-2xl border border-slate-200/80 bg-slate-50/70 p-5 dark:border-slate-800 dark:bg-slate-800/60">
                  <h3 className="text-base font-bold text-slate-900 dark:text-white">1.1 Businesses</h3>
                  <p className="mt-2 text-sm font-medium leading-relaxed text-slate-600 dark:text-slate-300">
                    Businesses include registered companies, firms, proprietorships, partnerships, limited liability partnerships, organisations, industrial entities, and any other legally operating entity that uses the Platform.
                  </p>
                </div>

                <div className="rounded-2xl border border-slate-200/80 bg-slate-50/70 p-5 dark:border-slate-800 dark:bg-slate-800/60">
                  <h3 className="text-base font-bold text-slate-900 dark:text-white">1.2 Unregistered Businesses</h3>
                  <p className="mt-2 text-sm font-medium leading-relaxed text-slate-600 dark:text-slate-300">
                    Gleska may, at its discretion, permit business operators that are not formally registered as companies or other legal entities to use applicable Platform services, subject to such information and verification requirements as Gleska may determine from time to time.
                  </p>
                </div>

                <div className="rounded-2xl border border-slate-200/80 bg-slate-50/70 p-5 dark:border-slate-800 dark:bg-slate-800/60">
                  <h3 className="text-base font-bold text-slate-900 dark:text-white">1.3 Workers</h3>
                  <p className="mt-2 text-sm font-medium leading-relaxed text-slate-600 dark:text-slate-300">
                    Workers may create profiles on the Platform and use applicable functionality to discover, and connect with, Businesses seeking workers.
                  </p>
                </div>

                <div className="rounded-2xl border border-slate-200/80 bg-slate-50/70 p-5 dark:border-slate-800 dark:bg-slate-800/60">
                  <h3 className="text-base font-bold text-slate-900 dark:text-white">1.4 Individual Users</h3>
                  <p className="mt-2 text-sm font-medium leading-relaxed text-slate-600 dark:text-slate-300">
                    Individuals may use applicable Gleska services for their own purposes, including obtaining services or connecting with Workers, where such functionality is made available by Gleska.
                  </p>
                </div>
              </div>
            </div>

            {/* SECTION 2 */}
            <div className="space-y-6 border-b border-slate-100 pb-10 dark:border-slate-800">
              <h2 className="font-[var(--font-anton)] text-2xl uppercase tracking-wide text-indigo-600 sm:text-3xl dark:text-indigo-400">
                2. Eligibility and Authority
              </h2>

              <div className="space-y-6">
                <div>
                  <h3 className="text-lg font-bold text-slate-900 dark:text-white">2.1 Accuracy of Information</h3>
                  <p className="mt-1.5 text-sm font-medium leading-relaxed text-slate-600 sm:text-base dark:text-slate-300">
                    Users must provide accurate, current, and complete information when creating and maintaining their account on the Platform, and must promptly update such information if it changes.
                  </p>
                </div>

                <div>
                  <h3 className="text-lg font-bold text-slate-900 dark:text-white">2.2 Authority to Represent a Business</h3>
                  <p className="mt-1.5 text-sm font-medium leading-relaxed text-slate-600 sm:text-base dark:text-slate-300">
                    A person registering an organisation or Business on the Platform represents and warrants that they hold the authority necessary to act on behalf of, and to bind, that organisation or Business.
                  </p>
                </div>

                <div>
                  <h3 className="text-lg font-bold text-slate-900 dark:text-white">2.3 Prohibited Conduct</h3>
                  <p className="mt-1.5 text-sm font-medium leading-relaxed text-slate-600 sm:text-base dark:text-slate-300">
                    Users must not:
                  </p>
                  <ul className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2 text-sm font-medium text-slate-700 dark:text-slate-300">
                    <li className="flex items-start gap-2.5 rounded-xl border border-slate-100 bg-slate-50/60 p-3 dark:border-slate-800 dark:bg-slate-800/40">
                      <span className="font-mono text-xs font-bold text-indigo-600 dark:text-indigo-400">(a)</span>
                      <span>Impersonate any other person or organisation;</span>
                    </li>
                    <li className="flex items-start gap-2.5 rounded-xl border border-slate-100 bg-slate-50/60 p-3 dark:border-slate-800 dark:bg-slate-800/40">
                      <span className="font-mono text-xs font-bold text-indigo-600 dark:text-indigo-400">(b)</span>
                      <span>Create an account using false or misleading information;</span>
                    </li>
                    <li className="flex items-start gap-2.5 rounded-xl border border-slate-100 bg-slate-50/60 p-3 dark:border-slate-800 dark:bg-slate-800/40">
                      <span className="font-mono text-xs font-bold text-indigo-600 dark:text-indigo-400">(c)</span>
                      <span>Provide fraudulent, forged, or altered documents;</span>
                    </li>
                    <li className="flex items-start gap-2.5 rounded-xl border border-slate-100 bg-slate-50/60 p-3 dark:border-slate-800 dark:bg-slate-800/40">
                      <span className="font-mono text-xs font-bold text-indigo-600 dark:text-indigo-400">(d)</span>
                      <span>Misrepresent their qualifications or experience;</span>
                    </li>
                    <li className="flex items-start gap-2.5 rounded-xl border border-slate-100 bg-slate-50/60 p-3 dark:border-slate-800 dark:bg-slate-800/40">
                      <span className="font-mono text-xs font-bold text-indigo-600 dark:text-indigo-400">(e)</span>
                      <span>Misrepresent the identity of a Business;</span>
                    </li>
                    <li className="flex items-start gap-2.5 rounded-xl border border-slate-100 bg-slate-50/60 p-3 dark:border-slate-800 dark:bg-slate-800/40">
                      <span className="font-mono text-xs font-bold text-indigo-600 dark:text-indigo-400">(f)</span>
                      <span>Use another person&apos;s account without that person&apos;s authorisation; or</span>
                    </li>
                    <li className="flex items-start gap-2.5 rounded-xl border border-slate-100 bg-slate-50/60 p-3 sm:col-span-2 dark:border-slate-800 dark:bg-slate-800/40">
                      <span className="font-mono text-xs font-bold text-indigo-600 dark:text-indigo-400">(g)</span>
                      <span>Otherwise attempt to deceive Gleska or another User.</span>
                    </li>
                  </ul>
                </div>

                <div>
                  <h3 className="text-lg font-bold text-slate-900 dark:text-white">2.4 Minimum Age</h3>
                  <p className="mt-1.5 text-sm font-medium leading-relaxed text-slate-600 sm:text-base dark:text-slate-300">
                    Except where an individual service is specifically permitted for minors, Users must be at least 18 years of age to use the Platform.
                  </p>
                </div>

                <div>
                  <h3 className="text-lg font-bold text-slate-900 dark:text-white">2.5 Additional Eligibility Requirements</h3>
                  <p className="mt-1.5 text-sm font-medium leading-relaxed text-slate-600 sm:text-base dark:text-slate-300">
                    Gleska may establish additional eligibility, verification, or age requirements for particular services offered through the Platform, and may communicate such requirements to Users as applicable.
                  </p>
                </div>
              </div>
            </div>

            {/* SECTION 3 */}
            <div className="space-y-6 border-b border-slate-100 pb-10 dark:border-slate-800">
              <h2 className="font-[var(--font-anton)] text-2xl uppercase tracking-wide text-indigo-600 sm:text-3xl dark:text-indigo-400">
                3. The Business–Worker Relationship
              </h2>

              <div className="space-y-6">
                <div>
                  <h3 className="text-lg font-bold text-slate-900 dark:text-white">3.1 Independent Parties</h3>
                  <p className="mt-1.5 text-sm font-medium leading-relaxed text-slate-600 sm:text-base dark:text-slate-300">
                    Where Gleska facilitates a connection between a Business and a Worker, the Business and the Worker deal with each other as independent parties.
                  </p>
                </div>

                <div>
                  <h3 className="text-lg font-bold text-slate-900 dark:text-white">3.2 No Employment Relationship Created by Gleska</h3>
                  <p className="mt-1.5 text-sm font-medium leading-relaxed text-slate-600 sm:text-base dark:text-slate-300">
                    By providing the Platform, Gleska does not:
                  </p>
                  <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2 text-sm font-medium text-slate-700 dark:text-slate-300">
                    {[
                      { letter: "a", text: "employ the Worker;" },
                      { letter: "b", text: "become the Worker's employer;" },
                      { letter: "c", text: "become the Worker's principal or agent;" },
                      { letter: "d", text: "guarantee employment or engagement;" },
                      { letter: "e", text: "guarantee wages or other compensation;" },
                      { letter: "f", text: "determine the terms of employment or engagement;" },
                      { letter: "g", text: "assume responsibility for workplace conditions;" },
                      { letter: "h", text: "assume responsibility for the Worker's conduct;" },
                      { letter: "i", text: "assume responsibility for the Business's conduct; or" },
                      { letter: "j", text: "become a party to the employment or service relationship between the Business and the Worker." },
                    ].map((item) => (
                      <div key={item.letter} className="flex items-start gap-2.5 rounded-xl border border-slate-100 bg-slate-50/60 p-3 dark:border-slate-800 dark:bg-slate-800/40">
                        <span className="font-mono text-xs font-bold text-indigo-600 dark:text-indigo-400">({item.letter})</span>
                        <span>{item.text}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <h3 className="text-lg font-bold text-slate-900 dark:text-white">3.3 Responsibilities of the Business</h3>
                  <p className="mt-1.5 text-sm font-medium leading-relaxed text-slate-600 sm:text-base dark:text-slate-300">
                    Unless expressly agreed otherwise in a separate written agreement with Gleska, the Business is solely responsible for its relationship with the Worker, including all applicable employment, contractual, workplace, payment, statutory, tax, safety, and other obligations arising from that relationship.
                  </p>
                </div>

                <div>
                  <h3 className="text-lg font-bold text-slate-900 dark:text-white">3.4 Responsibilities of the Worker</h3>
                  <p className="mt-1.5 text-sm font-medium leading-relaxed text-slate-600 sm:text-base dark:text-slate-300">
                    The Worker is responsible for accurately representing their identity, qualifications, experience, availability, documents, and any other information supplied through the Platform.
                  </p>
                </div>

                <div>
                  <h3 className="text-lg font-bold text-slate-900 dark:text-white">3.5 No Guarantee of Outcome</h3>
                  <p className="mt-1.5 text-sm font-medium leading-relaxed text-slate-600 sm:text-base dark:text-slate-300">
                    Gleska does not guarantee that a Business will hire, or continue to engage, any particular Worker, or that a Worker will obtain employment or engagement through the Platform.
                  </p>
                </div>
              </div>
            </div>

            {/* SECTION 4 */}
            <div className="space-y-6 border-b border-slate-100 pb-10 dark:border-slate-800">
              <h2 className="font-[var(--font-anton)] text-2xl uppercase tracking-wide text-indigo-600 sm:text-3xl dark:text-indigo-400">
                4. Payments Between Businesses and Workers
              </h2>

              <div className="space-y-6">
                <div>
                  <h3 className="text-lg font-bold text-slate-900 dark:text-white">4.1 Direct Payments</h3>
                  <p className="mt-1.5 text-sm font-medium leading-relaxed text-slate-600 sm:text-base dark:text-slate-300">
                    Where a Business and a Worker enter into a direct employment, engagement, or service relationship, all payments between them are made directly between the relevant parties, unless Gleska expressly states otherwise for a particular service.
                  </p>
                </div>

                <div>
                  <h3 className="text-lg font-bold text-slate-900 dark:text-white">4.2 No Custody of Funds</h3>
                  <p className="mt-1.5 text-sm font-medium leading-relaxed text-slate-600 sm:text-base dark:text-slate-300">
                    Gleska does not ordinarily receive, hold, distribute, or control wages or other payments owed by a Business to a Worker.
                  </p>
                </div>

                <div>
                  <h3 className="text-lg font-bold text-slate-900 dark:text-white">4.3 Compliance Obligations</h3>
                  <p className="mt-1.5 text-sm font-medium leading-relaxed text-slate-600 sm:text-base dark:text-slate-300">
                    The relevant Business and Worker are each responsible for determining and complying with all applicable payment, tax, employment, contractual, and statutory obligations arising from their relationship.
                  </p>
                </div>

                <div>
                  <h3 className="text-lg font-bold text-slate-900 dark:text-white">4.4 Platform Fees Are Separate</h3>
                  <p className="mt-1.5 text-sm font-medium leading-relaxed text-slate-600 sm:text-base dark:text-slate-300">
                    Any subscription or Platform fees charged by Gleska are separate from, and independent of, any payment or compensation agreed between a Business and a Worker.
                  </p>
                </div>
              </div>
            </div>

            {/* SECTION 5 */}
            <div className="space-y-6">
              <h2 className="font-[var(--font-anton)] text-2xl uppercase tracking-wide text-indigo-600 sm:text-3xl dark:text-indigo-400">
                5. Business Verification
              </h2>
              <p className="text-sm font-medium leading-relaxed text-slate-600 sm:text-base dark:text-slate-300">
                Gleska may establish verification processes, identity checks, and operational criteria for Businesses and Workers accessing the Platform to ensure safety, compliance, and platform integrity.
              </p>
            </div>

          </div>
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
            AI-powered, real-time hiring platform matching industrial &amp; commercial employers with blue-collar workers.
          </p>

          <div className="flex w-full flex-col items-center justify-between gap-4 border-t border-white/15 pt-6 text-sm font-semibold text-white/60 md:flex-row">
            <div className="flex gap-6">
              <Link href="#" className="transition-colors hover:text-white">
                Privacy Policy
              </Link>
              <Link href="/terms" className="text-white/90 transition-colors hover:text-white">
                Terms of Service
              </Link>
              <Link href="/contact" className="transition-colors hover:text-white">
                Contact
              </Link>
            </div>
            <p className="text-amber-300"> BHARAT </p>
          </div>
        </div>
      </footer>

    </div>
  );
}
