"use client";

import { NextIntlClientProvider } from "next-intl";
import { useLanguage } from "@/context/LanguageContext";
import { localeMessages } from "@/messages";

const getLocaleKey = (language: string) => {
  switch (language) {
    case "HI":
      return "hi";
    case "MR":
      return "mr";
    case "TA":
      return "ta";
    case "EN":
    default:
      return "en";
  }
};

export function IntlProvider({ children }: { children: React.ReactNode }) {
  const { language } = useLanguage();
  const locale = getLocaleKey(language);
  const messages = localeMessages[locale] ?? localeMessages.en;

  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      {children}
    </NextIntlClientProvider>
  );
}
