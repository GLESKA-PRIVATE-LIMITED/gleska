import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Shield } from "lucide-react";
import Navbar from "@/components/landing/Navbar";

export const metadata: Metadata = {
  title: "Privacy Policy | Gleska",
  description: "Learn how Gleska collects, uses, and shares personal information.",
};

const sections = [
  {
    title: "1. Who we are",
    paragraphs: [
      "This Privacy Policy explains how Gleska Private Limited (\"Gleska\", \"we\", \"us\", or \"our\") handles personal information when you use our website, mobile applications, platform, and related services (the \"Services\").",
    ],
  },
  {
    title: "2. Information we collect",
    paragraphs: [
      "Depending on how you use the Services, we may collect the following types of information:",
    ],
    items: [
      "Account and contact details, such as your name, phone number, email address, account type, and sign-in information.",
      "Profile and verification details, such as business information, work history, skills, qualifications, availability, and documents you submit for verification.",
      "Location information, including a location you provide or location data collected when you enable a location-based feature.",
      "Service and transaction records, such as job or service activity, attendance, payments, and support requests.",
      "Technical and usage information, such as device and browser details, log data, and how you interact with the Services.",
      "Messages and other information you choose to send to us or through the Services.",
    ],
  },
  {
    title: "3. How we use information",
    paragraphs: [
      "We use information to provide and operate the Services; create and manage accounts; verify users and submitted information; help businesses and workers find and connect with each other; support payments and service activity; respond to questions; protect the Services from misuse; improve our features; and meet legal obligations. We may also use your contact details for service-related messages and, where permitted, other communications. You can use any unsubscribe option included in a non-essential communication.",
    ],
  },
  {
    title: "4. How information may be shared",
    paragraphs: [
      "We may share information with other users when needed for the feature you choose, such as sharing relevant worker profile information with a business for a job connection. We may also share information with service providers that help us operate the Services, with professional advisers, when required by law or needed to protect people and the Services, or as part of a business reorganization. Where another user or provider receives your information, their handling of it may be governed by their own privacy terms.",
    ],
  },
  {
    title: "5. Cookies and device storage",
    paragraphs: [
      "Our Services may use cookies, local storage, and similar technologies to support sign-in, remember your preferences, maintain security, and operate the features you request. You can manage cookies through your browser settings, though disabling them may affect some features.",
    ],
  },
  {
    title: "6. Retention and security",
    paragraphs: [
      "We keep personal information for as long as reasonably needed for the purposes described in this Policy, including to provide the Services, meet legal requirements, and address disputes. Retention depends on the type of information and how it is used. We use safeguards intended to protect information, but no online service or method of storage can be guaranteed to be completely secure.",
    ],
  },
  {
    title: "7. Your choices and requests",
    paragraphs: [
      "You can review and update some information through your account. You can also control device permissions, such as location access, through your device settings. Depending on applicable law, you may be able to request access to, correction of, or deletion of your personal information, or raise an objection about how it is used. Contact us using the details below to make a privacy request. We may need to verify your identity before responding.",
    ],
  },
  {
    title: "8. Children",
    paragraphs: [
      "The Services are not intended for children, except where a particular service is expressly made available to them in accordance with applicable law. We do not knowingly collect children's personal information for services that are not intended for them. If you believe a child has provided us information improperly, please contact us.",
    ],
  },
  {
    title: "9. Changes to this Policy",
    paragraphs: [
      "We may update this Policy as our Services or legal requirements change. We will post the updated version here and revise the date below. Your continued use of the Services after an update means the revised Policy applies to your use, subject to applicable law.",
    ],
  },
  {
    title: "10. Contact us",
    paragraphs: [
      "For questions or requests about this Privacy Policy or your personal information, contact Gleska Private Limited at office@goleska.in.",
    ],
  },
];

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-[#eef1fb] text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <Navbar />

      <header className="bg-gradient-to-br from-indigo-600 via-blue-600 to-indigo-700 text-white">
        <div className="mx-auto max-w-7xl px-6 py-14 sm:py-18 md:py-20">
          <Link
            href="/"
            className="mb-8 inline-flex items-center gap-1.5 text-sm font-semibold text-white/75 transition hover:text-white"
          >
            <ArrowLeft size={16} /> Back to home
          </Link>
          <div className="max-w-3xl space-y-4">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-white/90">
              <Shield size={14} /> Your information
            </div>
            <h1 className="font-[var(--font-anton)] text-4xl uppercase leading-[0.95] sm:text-6xl md:text-7xl">
              Privacy Policy
            </h1>
            <p className="text-sm font-medium text-white/75">Last updated: October 20, 2026</p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl space-y-10 px-6 py-12 sm:py-16">
        <p className="text-base leading-7 text-slate-600 dark:text-slate-300">
          This Policy applies to information handled through Gleska&apos;s Services. Some features may involve additional notices or choices when you use them.
        </p>
        {sections.map((section) => (
          <section key={section.title} className="space-y-3">
            <h2 className="font-[var(--font-anton)] text-2xl uppercase text-indigo-700 dark:text-indigo-300">
              {section.title}
            </h2>
            {section.paragraphs.map((paragraph) => (
              <p key={paragraph} className="text-sm leading-7 text-slate-600 sm:text-base dark:text-slate-300">
                {paragraph}
              </p>
            ))}
            {section.items && (
              <ul className="list-disc space-y-2 pl-6 text-sm leading-7 text-slate-600 sm:text-base dark:text-slate-300">
                {section.items.map((item) => <li key={item}>{item}</li>)}
              </ul>
            )}
          </section>
        ))}
      </main>
    </div>
  );
}