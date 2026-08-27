"use client";

import React, { useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Mail,
  Phone,
  MapPin,
  Send,
  Zap,
  Clock,
  ChevronDown,
  MessageCircle,
  Building2,
  User,
  Loader2,
  CheckCircle2,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Shared Tailwind class-strings                                     */
/* ------------------------------------------------------------------ */
const labelCls =
  "mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400";
const inputCls =
  "w-full rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-3 text-sm font-medium text-slate-900 placeholder:text-slate-400 outline-none transition focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-100 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:placeholder:text-slate-500 dark:focus:border-indigo-500 dark:focus:bg-slate-900 dark:focus:ring-indigo-900/40";
const primaryBtnCls =
  "inline-flex w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-blue-600 to-indigo-600 px-6 py-3.5 text-sm font-bold text-white shadow-lg shadow-indigo-500/25 transition hover:from-blue-700 hover:to-indigo-700 disabled:cursor-not-allowed disabled:opacity-60";

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
        <ChevronDown
          size={20}
          className={`mt-0.5 shrink-0 text-slate-400 transition-transform duration-300 ${
            open ? "rotate-180 text-indigo-600 dark:text-indigo-400" : ""
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
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
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
      href: "https://maps.google.com",
      description: "NEW MARKET,BULDING NO. 16",
      color: "from-amber-500 to-orange-600",
    },
  ];

  return (
    <section id="contact" className="border-y border-slate-200 bg-white px-6 py-20 sm:py-24 dark:border-slate-800 dark:bg-slate-900">
      <div className="mx-auto max-w-7xl">
        {/* Optional Section header */}
        {showHeader && (
          <div className="mb-14 text-center">
            <div className="mx-auto mb-4 inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-indigo-50 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950/50 dark:text-indigo-300">
              <MessageCircle size={14} />
              Get in touch
            </div>
            <h2 className="font-[var(--font-anton)] text-4xl uppercase tracking-wide text-slate-900 sm:text-5xl md:text-6xl dark:text-white">
              Contact Us
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-lg font-medium text-slate-600 dark:text-slate-400">
              Whether you&apos;re an employer looking to hire or a worker seeking opportunity — our team is ready to help you 24×7.
            </p>
          </div>
        )}

        {/* Contact info cards */}
        <div className="mb-12 grid grid-cols-1 gap-4 sm:grid-cols-3">
          {contactCards.map((card) => (
            <a
              key={card.label}
              href={card.href}
              target={card.label === "Visit Us" ? "_blank" : undefined}
              rel={card.label === "Visit Us" ? "noopener noreferrer" : undefined}
              id={`contact-card-${card.label.toLowerCase().replace(/\s/g, "-")}`}
              className="group relative flex items-start gap-4 rounded-2xl border border-slate-200 bg-slate-50/60 p-5 transition hover:-translate-y-1 hover:shadow-lg dark:border-slate-800 dark:bg-slate-800/60 dark:hover:border-slate-700"
            >
              <div
                className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${card.color} shadow-md`}
              >
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

        {/* Form + FAQ grid */}
        <div className="grid grid-cols-1 items-start gap-10 lg:grid-cols-5">
          {/* Form */}
          <div className="lg:col-span-3">
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xl shadow-slate-200/40 sm:p-8 dark:border-slate-800 dark:bg-slate-900 dark:shadow-none">
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
                    Thank you for reaching out. Our team will respond to your inquiry within 4 hours during business
                    hours.
                  </p>
                  <button
                    onClick={() => {
                      setSubmitted(false);
                      setName("");
                      setEmail("");
                      setPhone("");
                      setSubject("");
                      setMessage("");
                    }}
                    className="mt-6 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-5 py-2.5 text-sm font-bold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                  >
                    Send another message
                  </button>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-5" id="contact-form">
                  <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                    <div>
                      <label htmlFor="contact-name" className={labelCls}>
                        Full Name
                      </label>
                      <div className="relative">
                        <User
                          size={18}
                          className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400"
                        />
                        <input
                          id="contact-name"
                          type="text"
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          className={inputCls + " pl-11"}
                          placeholder="Your name"
                          required
                        />
                      </div>
                    </div>
                    <div>
                      <label htmlFor="contact-email" className={labelCls}>
                        Email
                      </label>
                      <div className="relative">
                        <Mail
                          size={18}
                          className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400"
                        />
                        <input
                          id="contact-email"
                          type="email"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          className={inputCls + " pl-11"}
                          placeholder="you@company.com"
                          required
                        />
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                    <div>
                      <label htmlFor="contact-phone" className={labelCls}>
                        Phone (optional)
                      </label>
                      <div className="flex">
                        <span className="inline-flex items-center rounded-l-xl border border-r-0 border-slate-200 bg-slate-100 px-4 text-sm font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
                          +91
                        </span>
                        <input
                          id="contact-phone"
                          type="tel"
                          value={phone}
                          onChange={(e) => setPhone(e.target.value)}
                          className={inputCls + " rounded-l-none"}
                          placeholder="9999999999"
                          maxLength={10}
                        />
                      </div>
                    </div>
                    <div>
                      <label htmlFor="contact-subject" className={labelCls}>
                        Subject
                      </label>
                      <div className="relative">
                        <Building2
                          size={18}
                          className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400"
                        />
                        <select
                          id="contact-subject"
                          value={subject}
                          onChange={(e) => setSubject(e.target.value)}
                          className={inputCls + " appearance-none pl-11 pr-10"}
                          required
                        >
                          <option value="">Select a topic</option>
                          <option value="hiring">I want to hire workers</option>
                          <option value="work">I'm looking for work</option>
                          <option value="partnership">Business partnership</option>
                          <option value="support">Technical support</option>
                          <option value="other">Other</option>
                        </select>
                        <ChevronDown
                          size={16}
                          className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400"
                        />
                      </div>
                    </div>
                  </div>

                  <div>
                    <label htmlFor="contact-message" className={labelCls}>
                      Message
                    </label>
                    <textarea
                      id="contact-message"
                      rows={5}
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      className={inputCls + " resize-none"}
                      placeholder="Tell us how we can help you..."
                      required
                    />
                  </div>

                  <button type="submit" disabled={submitting} className={primaryBtnCls} id="contact-submit-btn">
                    {submitting ? (
                      <Loader2 className="animate-spin" size={18} />
                    ) : (
                      <>
                        <Send size={16} /> Send Message
                      </>
                    )}
                  </button>
                </form>
              )}
            </div>
          </div>

          {/* FAQ sidebar */}
          <div className="lg:col-span-2">
            <div className="mb-6">
              <h3 className="font-[var(--font-anton)] text-2xl uppercase tracking-wide text-slate-900 sm:text-4xl dark:text-white">
                FAQs
              </h3>
              <p className="mt-2 text-sm font-medium text-slate-500 dark:text-slate-400">
                Quick answers to common questions.
              </p>
            </div>
            <div className="space-y-3" id="faq-section">
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

            {/* Extra CTA card */}
            <div className="mt-6 rounded-2xl border border-indigo-200 bg-gradient-to-br from-indigo-50 to-blue-50 p-6 dark:border-indigo-900/50 dark:from-indigo-950/40 dark:to-blue-950/40">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600">
                  <Zap size={18} className="text-white" fill="currentColor" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-white">Ready to get started?</h3>
                  <p className="mt-1 text-sm font-medium text-slate-500 dark:text-slate-400">
                    Join Businesses and Industries already using GO LESKA AI.
                  </p>
                  <Link
                    href="#contact-form"
                    className="mt-4 inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-blue-600 to-indigo-600 px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-indigo-500/25 transition hover:from-blue-700 hover:to-indigo-700"
                  >
                    Start now <ArrowRight size={16} />
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
