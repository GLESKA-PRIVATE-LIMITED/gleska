"use client";

import React, { useState } from "react";
import {
  ArrowRight,
  Mail,
  Phone,
  MapPin,
  Send,
  Clock,
  MessageCircle,
  Loader2,
  CheckCircle2,
  HelpCircle,
  X,
  Zap,
  AlertCircle,
} from "lucide-react";
import apiClient from "@/lib/api";

/* ------------------------------------------------------------------ */
/*  Shared Tailwind class-strings                                     */
/* ------------------------------------------------------------------ */
const labelCls =
  "mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500";
const inputCls =
  "w-full rounded-xl border border-slate-200 bg-white/90 px-4 py-3 text-sm font-medium text-slate-900 placeholder:text-slate-400 outline-none transition focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-100 dark:border-slate-700/80 dark:bg-slate-800/90 dark:text-white dark:placeholder:text-slate-500 dark:focus:border-indigo-500 dark:focus:ring-indigo-900/40";

/* ------------------------------------------------------------------ */
/*  FAQ data                                                          */
/* ------------------------------------------------------------------ */
export const FAQ_ITEMS = [
  {
    q: "How quickly can I hire workers through GO LESKA?",
    a: "Our AI dispatch engine matches your requirements with verified workers within 60 seconds. Once accepted, workers can be on-site within hours depending on proximity.",
  },
  {
    q: "What kind of workers are available on the platform?",
    a: "We cover 50+ blue-collar trade categories — welders, fitters, CNC operators, electricians, plumbers, security guards, housekeeping staff, and many more.",
  },
  {
    q: "Is there a minimum hiring commitment?",
    a: "No minimum commitment. You can hire for a single day or long-term contracts. Pay-as-you-go with transparent daily rates and zero hidden fees.",
  },
  {
    q: "How are workers verified?",
    a: "Every worker on GO LESKA undergoes Aadhaar-based identity verification, skill assessment, and background checks before they appear on the platform.",
  },
  {
    q: "Which cities are you currently operational in?",
    a: "We're live across major industrial hubs in Maharashtra, Tamil Nadu, Karnataka, and Gujarat. Expanding rapidly — contact us if your city isn't listed yet!",
  },
];

/* ------------------------------------------------------------------ */
/*  FAQ Accordion Item                                                */
/* ------------------------------------------------------------------ */
export function FaqItem({ q, a, open, toggle }: { q: string; a: string; open: boolean; toggle: () => void }) {
  return (
    <button
      onClick={toggle}
      className="group w-full rounded-2xl border border-slate-200 bg-white p-5 text-left transition hover:shadow-md dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700"
    >
      <div className="flex items-start justify-between gap-4">
        <h3 className="text-base font-bold text-slate-900 dark:text-white">{q}</h3>
        <HelpCircle
          size={18}
          className={`mt-0.5 shrink-0 text-slate-400 transition-transform duration-300 ${
            open ? "text-indigo-600 dark:text-indigo-400" : ""
          }`}
        />
      </div>
      <div
        className={`grid transition-all duration-300 ease-in-out ${
          open ? "mt-3 grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
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
/*  Contact Us Section Component                                      */
/* ------------------------------------------------------------------ */
export default function ContactUsSection({ showHeader = true }: { showHeader?: boolean }) {
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [faqDrawerOpen, setFaqDrawerOpen] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const response = await apiClient.post("/api/v1/contact", {
        name: name.trim(),
        company: company.trim() || null,
        email: email.trim(),
        message: message.trim(),
      });

      if (response.data && response.data.success) {
        setSubmitted(true);
      } else {
        setError("Failed to submit inquiry. Please try again.");
      }
    } catch (err: any) {
      const errorMessage = err?.response?.data?.detail || err?.message || "Unable to send your message. Please try again.";
      setError(errorMessage);
    } finally {
      setSubmitting(false);
    }
  };

  const contactCards = [
    {
      icon: Phone,
      label: "Call Us",
      value: "+91 7372888875",
      href: "tel:+917372888875",
      description: "Mon – Sat, 9 AM – 7 PM IST",
      color: "from-emerald-500 to-teal-600",
    },
    {
      icon: Mail,
      label: "Email Us",
      value: "office@goleska.in",
      href: "mailto:office@goleska.in",
      description: "We reply within 24 hours",
      color: "from-blue-600 to-indigo-600",
    },
    {
      icon: MapPin,
      label: "Visit Us",
      value: "MALVIYA NAGAR, SOUTH DELHI",
      href: "https://www.google.com/maps/dir/?api=1&destination=28.5376510%2C77.2132260&utm_source=chatgpt.com",
      description: "NEW MARKET, BUILDING NO. 16",
      color: "from-amber-500 to-orange-600",
    },
  ];

  const detailsList = [
    { label: "EMAIL", value: "office@goleska.in", isLink: true, href: "mailto:office@goleska.in" },
    { label: "COMPANY", value: "Gleska Private Limited" },
    { label: "LOCATION", value: "Delhi, India" },
    { label: "COVERAGE", value: "Delhi NCR industrial belt, expanding nationally" },
  ];

  return (
    <section id="contact" className="relative px-6 py-20 sm:py-24">
      <div className="mx-auto max-w-7xl">
        
        {/* ========================================================= */}
        {/* OUTER / MOTHER CONTACT CONTAINER                          */}
        {/* ========================================================= */}
        <div className="rounded-[2.5rem] border border-slate-200/80 bg-white/70 p-6 sm:p-10 md:p-12 shadow-2xl shadow-slate-900/5 backdrop-blur-xl dark:border-slate-800/80 dark:bg-slate-900/70">
          
          {/* 1. CONTACT US HEADER */}
          {showHeader && (
            <div className="mb-12 text-center">
              <div className="mx-auto mb-4 inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-indigo-50 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950/50 dark:text-indigo-300">
                <MessageCircle size={14} />
                GET IN TOUCH
              </div>
              <h2 className="font-[var(--font-anton)] text-4xl uppercase tracking-wide text-slate-900 sm:text-5xl md:text-6xl dark:text-white">
                CONTACT US
              </h2>
              <p className="mx-auto mt-4 max-w-2xl text-lg font-medium text-slate-600 dark:text-slate-400">
                Whether you&apos;re an employer looking to hire or a worker seeking opportunity — our team is ready to help you 24×7.
              </p>
            </div>
          )}

          {/* 2. THREE SMALL INFORMATION CARDS */}
          <div className="mb-10 grid grid-cols-1 gap-4 sm:grid-cols-3">
            {contactCards.map((card) => (
              <a
                key={card.label}
                href={card.href}
                target={card.label === "Visit Us" ? "_blank" : undefined}
                rel={card.label === "Visit Us" ? "noopener noreferrer" : undefined}
                className="group relative flex items-start gap-4 rounded-2xl border border-slate-200/80 bg-white/90 p-5 shadow-sm transition hover:-translate-y-1 hover:shadow-md dark:border-slate-800 dark:bg-slate-800/90"
              >
                <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${card.color} shadow-md`}>
                  <card.icon size={22} className="text-white" />
                </div>
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                    {card.label}
                  </p>
                  <p className="mt-0.5 text-base font-bold text-slate-900 dark:text-white">{card.value}</p>
                  <p className="mt-1 flex items-center gap-1.5 text-xs font-medium text-slate-400 dark:text-slate-500">
                    <Clock size={12} /> {card.description}
                  </p>
                </div>
                <ArrowRight
                  size={18}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-300 transition group-hover:translate-x-1 group-hover:text-indigo-500 dark:text-slate-600 dark:group-hover:text-indigo-400"
                />
              </a>
            ))}
          </div>

          {/* 3. DISTINCT INNER CONTAINER ("BRING YOUR BUSINESS ONLINE") */}
          <div className="rounded-3xl border border-slate-200/90 bg-white/95 p-6 sm:p-10 md:p-12 shadow-xl backdrop-blur-md dark:border-slate-800/90 dark:bg-slate-900/95">
            <div className="grid grid-cols-1 items-start gap-12 lg:grid-cols-12">
              
              {/* LEFT COLUMN */}
              <div className="lg:col-span-5 space-y-8">
                <div className="space-y-4">
                  <div className="inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-indigo-50 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950/50 dark:text-indigo-300">
                    <MessageCircle size={14} />
                    CONTACT
                  </div>

                  <h3 className="font-[var(--font-anton)] text-3xl uppercase tracking-wide text-slate-900 sm:text-4xl md:text-5xl dark:text-white leading-[0.95]">
                    Bring your business online.
                  </h3>
                </div>

                <div className="space-y-5 pt-2">
                  {detailsList.map((item, idx) => (
                    <div
                      key={item.label}
                      className={`${
                        idx !== detailsList.length - 1 ? "border-b border-slate-200/60 pb-4 dark:border-slate-800" : ""
                      }`}
                    >
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                        {item.label}
                      </p>
                      {item.isLink ? (
                        <a
                          href={item.href}
                          className="mt-1 block text-base font-bold text-slate-900 underline transition hover:text-indigo-600 dark:text-white dark:hover:text-indigo-400"
                        >
                          {item.value}
                        </a>
                      ) : (
                        <p className="mt-1 text-base font-bold text-slate-900 dark:text-white">
                          {item.value}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* RIGHT COLUMN */}
              <div className="lg:col-span-7 space-y-6">
                <p className="text-base font-medium leading-relaxed text-slate-600 sm:text-lg dark:text-slate-300">
                  Tell us what your business runs on — we&apos;ll tell you which deputy fits.
                </p>

                {submitted ? (
                  <div className="flex flex-col items-center justify-center rounded-2xl border border-slate-200/80 bg-white/90 p-12 text-center shadow-sm dark:border-slate-800 dark:bg-slate-800/80">
                    <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 shadow-lg shadow-emerald-500/30">
                      <CheckCircle2 size={32} className="text-white" />
                    </div>
                    <h3 className="text-xl font-extrabold text-slate-900 dark:text-white">Message Sent!</h3>
                    <p className="mt-2 max-w-sm text-sm font-medium text-slate-500 dark:text-slate-400">
                      Thank you for reaching out. Our team will respond to your inquiry within 24 hours.
                    </p>
                    <button
                      onClick={() => {
                        setSubmitted(false);
                        setName("");
                        setCompany("");
                        setEmail("");
                        setMessage("");
                        setError(null);
                      }}
                      className="mt-6 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-5 py-2.5 text-sm font-bold text-slate-700 shadow-sm transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                    >
                      Send another message
                    </button>
                  </div>
                ) : (
                  <form onSubmit={handleSubmit} className="space-y-5" id="contact-form">
                    
                    {error && (
                      <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50/90 p-4 dark:border-red-900/60 dark:bg-red-950/20">
                        <AlertCircle size={18} className="mt-0.5 shrink-0 text-red-600 dark:text-red-400" />
                        <div>
                          <p className="text-sm font-semibold text-red-700 dark:text-red-300">Error</p>
                          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
                        </div>
                      </div>
                    )}
                    
                    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                      <div>
                        <label htmlFor="contact-name" className={labelCls}>
                          NAME
                        </label>
                        <input
                          id="contact-name"
                          type="text"
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          className={inputCls}
                          placeholder="Your name"
                          required
                        />
                      </div>
                      <div>
                        <label htmlFor="contact-company" className={labelCls}>
                          COMPANY
                        </label>
                        <input
                          id="contact-company"
                          type="text"
                          value={company}
                          onChange={(e) => setCompany(e.target.value)}
                          className={inputCls}
                          placeholder="Business name"
                        />
                      </div>
                    </div>

                    <div>
                      <label htmlFor="contact-email" className={labelCls}>
                        EMAIL
                      </label>
                      <input
                        id="contact-email"
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className={inputCls}
                        placeholder="you@company.com"
                        required
                      />
                    </div>

                    <div>
                      <label htmlFor="contact-message" className={labelCls}>
                        WHAT DOES YOUR BUSINESS NEED?
                      </label>
                      <textarea
                        id="contact-message"
                        rows={4}
                        value={message}
                        onChange={(e) => setMessage(e.target.value)}
                        className={inputCls + " resize-none"}
                        placeholder="e.g. we need help filling government tenders"
                        required
                      />
                    </div>

                    <div className="pt-2">
                      <button
                        type="submit"
                        disabled={submitting}
                        className="inline-flex items-center justify-center gap-2 rounded-full bg-gradient-to-r from-orange-500 via-pink-500 to-indigo-600 px-8 py-3.5 text-base font-bold text-white shadow-lg shadow-orange-500/25 transition hover:opacity-95 active:scale-95 disabled:opacity-60"
                        id="contact-submit-btn"
                      >
                        {submitting ? (
                          <Loader2 className="animate-spin" size={18} />
                        ) : (
                          <>
                            Send Message <ArrowRight size={18} />
                          </>
                        )}
                      </button>
                    </div>

                  </form>
                )}
              </div>

            </div>
          </div>

        </div>
      </div>

      {/* Floating FAQs Button */}
      <button
        onClick={() => setFaqDrawerOpen(true)}
        className="fixed bottom-6 right-6 z-40 flex items-center gap-2.5 rounded-full bg-gradient-to-r from-blue-600 to-indigo-600 px-5 py-3.5 text-sm font-bold text-white shadow-xl shadow-indigo-500/30 transition-all hover:scale-105 hover:from-blue-700 hover:to-indigo-700 active:scale-95"
        id="open-faq-drawer-btn"
        aria-label="Open FAQs"
      >
        <HelpCircle size={20} />
        <span>FAQs</span>
      </button>

      {/* FAQ Drawer Backdrop */}
      <div
        onClick={() => setFaqDrawerOpen(false)}
        className={`fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs transition-opacity duration-300 ${
          faqDrawerOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
      />

      {/* FAQ Slide-in Drawer */}
      <div
        className={`fixed top-0 right-0 z-50 flex h-full w-full max-w-md flex-col justify-between overflow-y-auto bg-white p-6 shadow-2xl transition-transform duration-300 ease-in-out sm:p-8 dark:bg-slate-900 ${
          faqDrawerOpen ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div>
          {/* Drawer Header */}
          <div className="flex items-center justify-between border-b border-slate-100 pb-5 dark:border-slate-800">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-400">
                <HelpCircle size={22} />
              </div>
              <div>
                <h3 className="font-[var(--font-anton)] text-xl uppercase tracking-wide text-slate-900 dark:text-white">
                  FAQs
                </h3>
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                  Quick answers to common questions
                </p>
              </div>
            </div>
            <button
              onClick={() => setFaqDrawerOpen(false)}
              className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
              aria-label="Close FAQs"
            >
              <X size={20} />
            </button>
          </div>

          {/* Accordion List */}
          <div className="mt-6 space-y-3" id="faq-section">
            {FAQ_ITEMS.map((item, i) => (
              <FaqItem
                key={i}
                q={item.q}
                a={item.a}
                open={openFaq === i}
                toggle={() => setOpenFaq(openFaq === i ? null : i)}
              />
            ))}
          </div>
        </div>

        {/* Drawer Footer CTA */}
        <div className="mt-8 rounded-2xl border border-indigo-200 bg-gradient-to-br from-indigo-50 to-blue-50 p-5 dark:border-indigo-900/50 dark:from-indigo-950/40 dark:to-blue-950/40">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600">
              <Zap size={16} className="text-white" fill="currentColor" />
            </div>
            <div>
              <h4 className="text-sm font-bold text-slate-900 dark:text-white">Have more questions?</h4>
              <p className="mt-0.5 text-xs font-medium text-slate-500 dark:text-slate-400">
                Our team is available 24/7 to assist you. Fill out the form to get in touch.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
