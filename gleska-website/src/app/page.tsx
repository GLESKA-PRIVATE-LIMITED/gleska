"use client";

import React, { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Phone, Mail, MapPin } from 'lucide-react';
import Navbar from '@/components/landing/Navbar';
import GetHiredSection from '@/components/landing/GetHiredSection';
import ServicesSection from '@/components/landing/ServicesSection';
import AboutSection from '@/components/landing/AboutSection';
import ContactUsSection from '@/components/landing/ContactUsSection';
import { useLanguage } from '@/context/LanguageContext';

// Configurable social media link placeholders
const SOCIAL_LINKS = {
  linkedin: 'https://www.linkedin.com/company/gleska-private-limited/',
  instagram: '#',
  youtube: 'https://www.youtube.com/channel/UC5VlGdcHwmPLMfS6IL9sp3A',
};

function LinkedinIcon({ size = 18, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z" />
      <rect x="2" y="9" width="4" height="12" />
      <circle cx="4" cy="4" r="2" />
    </svg>
  );
}

function InstagramIcon({ size = 18, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
      <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
    </svg>
  );
}

function YoutubeIcon({ size = 18, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M22.54 6.42a2.78 2.78 0 0 0-1.94-2C18.88 4 12 4 12 4s-6.88 0-8.6.46a2.78 2.78 0 0 0-1.94 2A29 29 0 0 0 1 11.75a29 29 0 0 0 .46 5.33A2.78 2.78 0 0 0 3.4 19c1.72.46 8.6.46 8.6.46s6.88 0 8.6-.46a2.78 2.78 0 0 0 1.94-2 29 29 0 0 0 .46-5.25 29 29 0 0 0-.46-5.33z" />
      <polygon points="9.75 15.02 15.5 11.75 9.75 8.48 9.75 15.02" fill="currentColor" />
    </svg>
  );
}

export default function LandingPage() {
  const { t } = useLanguage();
  const router = useRouter();

  return (
    <div className="relative min-h-screen overflow-x-clip bg-[#eef1fb] font-sans text-slate-900 selection:bg-indigo-500 selection:text-white dark:bg-slate-950 dark:text-slate-100">

      {/* FLOATING PILL NAV */}
      <Navbar />

      {/* 1. SERVICES SECTION */}
      <ServicesSection />

      {/* 2. GET HIRED / JOIN AS WORKING PARTNER SECTION */}
      <GetHiredSection />

      {/* 3. CONTACT US SECTION */}
      <ContactUsSection />

      {/* 4. ABOUT SECTION */}
      <AboutSection />

      {/* FOOTER */}
      <footer className="relative border-t border-indigo-900/40 bg-gradient-to-br from-indigo-700 via-blue-700 to-indigo-800 px-6 pb-8 pt-16 text-white sm:pt-20">
        <div className="mx-auto max-w-7xl">
          
          {/* Top Section: 3 Columns on Desktop, Clean Stack on Mobile */}
          <div className="grid grid-cols-1 gap-10 pb-12 text-left md:grid-cols-12 md:gap-8 lg:gap-12">
            
            {/* COLUMN 1 (LEFT): Logo, Short Description, Social Icons */}
            <div className="space-y-4 md:col-span-5 lg:col-span-5">
              <Link href="/" className="inline-flex items-center gap-3">
                <img src="/favicon.ico" alt="GO LESKA AI" className="h-8 w-8 rounded-lg object-contain sm:h-9 sm:w-9" />
                <span className="select-none bg-[linear-gradient(180deg,#E86100_0%,#FFF5EA_48%,#128807_100%)] bg-clip-text font-[var(--font-anton)] text-2xl uppercase tracking-wider text-transparent sm:text-3xl">
                  GO LESKA AI
                </span>
              </Link>
              
              <p className="max-w-sm text-sm font-medium leading-relaxed text-white/80">
                {t('footer.subtitle')}
              </p>

              {/* Social Icons */}
              <div className="pt-2">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-white/60">
                  Follow Us
                </p>
                <div className="flex items-center gap-3">
                  <a
                    href={SOCIAL_LINKS.linkedin}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="LinkedIn"
                    className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/20 bg-white/10 text-white transition hover:border-white/40 hover:bg-white/20 hover:scale-105 active:scale-95"
                  >
                    <LinkedinIcon size={18} />
                  </a>
                  <a
                    href={SOCIAL_LINKS.instagram}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="Instagram"
                    className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/20 bg-white/10 text-white transition hover:border-white/40 hover:bg-white/20 hover:scale-105 active:scale-95"
                  >
                    <InstagramIcon size={18} />
                  </a>
                  <a
                    href={SOCIAL_LINKS.youtube}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="YouTube"
                    className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/20 bg-white/10 text-white transition hover:border-white/40 hover:bg-white/20 hover:scale-105 active:scale-95"
                  >
                    <YoutubeIcon size={18} />
                  </a>
                </div>
              </div>
            </div>

            {/* COLUMN 2 (MIDDLE): Navigation Links */}
            <div className="space-y-4 md:col-span-3 lg:col-span-3">
              <h4 className="font-[var(--font-anton)] text-lg uppercase tracking-wider text-white">
                {t('footer.navigation')}
              </h4>
              <ul className="space-y-2.5 text-sm font-medium text-white/80">
                <li>
                  <Link href="/#services" className="transition-colors hover:text-white hover:underline">
                    {t('footer.services')}
                  </Link>
                </li>
                <li>
                  <Link href="/get-hired" className="transition-colors hover:text-white hover:underline">
                    {t('footer.getHired')}
                  </Link>
                </li>
                <li>
                  <Link href="/about" className="transition-colors hover:text-white hover:underline">
                    {t('footer.about')}
                  </Link>
                </li>
                <li>
                  <Link href="/contact" className="transition-colors hover:text-white hover:underline">
                    {t('footer.contact')}
                  </Link>
                </li>
                <li>
                  <Link href="/terms" className="transition-colors hover:text-white hover:underline">
                    {t('footer.terms')}
                  </Link>
                </li>
                <li>
                  <Link href="/terms" className="transition-colors hover:text-white hover:underline">
                    {t('footer.privacy')}
                  </Link>
                </li>
              </ul>
            </div>

            {/* COLUMN 3 (RIGHT): Company Information & Contact Actions */}
            <div className="space-y-4 md:col-span-4 lg:col-span-4">
              <h4 className="font-[var(--font-anton)] text-lg uppercase tracking-wider text-white">
                {t('footer.contactInfo')}
              </h4>
              
              <div className="space-y-3.5 text-sm font-medium text-white/80">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-300">
                    {t('footer.companyName')}
                  </p>
                  <p className="mt-1 flex items-start gap-2 text-xs leading-relaxed text-white/80">
                    <MapPin size={16} className="mt-0.5 shrink-0 text-amber-300" />
                    <span>{t('footer.address')}</span>
                  </p>
                </div>

                <div className="space-y-2.5 pt-1">
                  <a
                    href="tel:+917372888875"
                    className="group flex items-center gap-3 rounded-2xl border border-white/20 bg-white/10 p-3.5 transition hover:border-white/40 hover:bg-white/15"
                  >
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/20 text-white transition group-hover:bg-white group-hover:text-indigo-700">
                      <Phone size={18} />
                    </div>
                    <div className="min-w-0">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-white/60">Phone</p>
                      <p className="text-sm font-bold tracking-wide text-white">+91 7372888875</p>
                    </div>
                  </a>

                  <a
                    href="mailto:office@goleska.in"
                    className="group flex items-center gap-3 rounded-2xl border border-white/20 bg-white/10 p-3.5 transition hover:border-white/40 hover:bg-white/15"
                  >
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/20 text-white transition group-hover:bg-white group-hover:text-indigo-700">
                      <Mail size={18} />
                    </div>
                    <div className="min-w-0">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-white/60">Email</p>
                      <p className="break-all text-sm font-bold text-white">office@goleska.in</p>
                    </div>
                  </a>
                </div>
              </div>
            </div>

          </div>

          {/* Bottom Divider & Copyright Bar */}
          <div className="flex flex-col items-center justify-between gap-4 border-t border-white/15 pt-8 text-center text-xs font-semibold text-white/70 sm:flex-row sm:text-left">
            <p>
              © {new Date().getFullYear()} {t('footer.companyName')}. {t('footer.allRightsReserved')}
            </p>
            <p className="text-amber-300 font-bold tracking-wide">
              {t('footer.madeIn')}
            </p>
          </div>

        </div>
      </footer>
    </div>
  );
}
