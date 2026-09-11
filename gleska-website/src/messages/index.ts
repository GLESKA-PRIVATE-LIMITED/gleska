export const localeCodes = ["en", "hi", "mr", "ta"] as const;
export type LocaleCode = (typeof localeCodes)[number];

export const localeMessages: Record<LocaleCode, Record<string, unknown>> = {
  en: {},
  hi: {},
  mr: {},
  ta: {},
};
