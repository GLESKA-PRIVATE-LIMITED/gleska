"use client";

import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import apiClient from '@/lib/api';
import { LanguageCode, TRANSLATIONS } from '@/lib/translations';

const STORAGE_KEY = 'goleska_lang';

export const LANGUAGE_TO_LOCALE: Record<LanguageCode, string> = {
  EN: 'en',
  HI: 'hi',
  MR: 'mr',
  TA: 'ta',
};

const isValidLanguage = (value?: string | null): value is LanguageCode => Boolean(value && value in TRANSLATIONS);

const normalizeLanguage = (value?: string | null): LanguageCode => {
  if (isValidLanguage(value)) return value;
  return 'EN';
};

const readStoredLanguage = (): LanguageCode => {
  if (typeof window === 'undefined') return 'EN';
  const saved = window.localStorage.getItem(STORAGE_KEY);
  return normalizeLanguage(saved);
};

const persistStoredLanguage = (lang: LanguageCode) => {
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(STORAGE_KEY, lang);
    document.cookie = `${STORAGE_KEY}=${lang}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`;
  }
};

interface LanguageContextType {
  language: LanguageCode;
  setLanguage: (lang: LanguageCode) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}

const LanguageContext = createContext<LanguageContextType>({
  language: 'EN',
  setLanguage: () => {},
  t: (key: string, params?: Record<string, string | number>) => {
    const value = TRANSLATIONS.EN[key] || key;
    if (!params) return value;
    return Object.entries(params).reduce((result, [keyName, valueToReplace]) => {
      return result.replace(new RegExp(`\\{${keyName}\\}`, 'g'), String(valueToReplace));
    }, value);
  },
});

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  const [language, setLanguageState] = useState<LanguageCode>('EN');
  const activeSelectionRef = useRef(0);

  const syncDocumentLanguage = (lang: LanguageCode) => {
    if (typeof document !== 'undefined') {
      document.documentElement.lang = LANGUAGE_TO_LOCALE[lang];
    }
  };

  useEffect(() => {
    syncDocumentLanguage(language);
  }, [language]);

  useEffect(() => {
    if (isLoading) return;

    if (!user) {
      const fallbackLanguage = readStoredLanguage();
      const currentSelection = activeSelectionRef.current;
      if (currentSelection === 0) {
        setLanguageState(fallbackLanguage);
      }
      syncDocumentLanguage(fallbackLanguage);
      return;
    }

    let ignore = false;
    const loadToken = activeSelectionRef.current;

    const loadAuthenticatedLanguage = async () => {
      const endpoint = user.role === 'WORKER'
        ? '/api/v1/workers/me/preferences'
        : user.role === 'EMPLOYER'
          ? '/api/v1/employers/me/preferences'
          : null;

      if (!endpoint) {
        const fallbackLanguage = readStoredLanguage();
        if (!ignore && loadToken === activeSelectionRef.current) {
          setLanguageState(fallbackLanguage);
          persistStoredLanguage(fallbackLanguage);
          syncDocumentLanguage(fallbackLanguage);
        }
        return;
      }

      try {
        const response = await apiClient.get<{ language?: string }>(endpoint, { withCredentials: true });
        const nextLanguage = normalizeLanguage(response.data?.language);

        if (!ignore && loadToken === activeSelectionRef.current) {
          setLanguageState(nextLanguage);
          persistStoredLanguage(nextLanguage);
          syncDocumentLanguage(nextLanguage);
        }
      } catch {
        const fallbackLanguage = readStoredLanguage();
        if (!ignore && loadToken === activeSelectionRef.current) {
          setLanguageState(fallbackLanguage);
          syncDocumentLanguage(fallbackLanguage);
        }
      }
    };

    void loadAuthenticatedLanguage();

    return () => {
      ignore = true;
    };
  }, [isLoading, user]);

  const setLanguage = (lang: LanguageCode) => {
    activeSelectionRef.current += 1;
    const selectionToken = activeSelectionRef.current;
    setLanguageState(lang);
    persistStoredLanguage(lang);
    syncDocumentLanguage(lang);

    if (!user) return;

    const endpoint = user.role === 'WORKER'
      ? '/api/v1/workers/me/preferences'
      : user.role === 'EMPLOYER'
        ? '/api/v1/employers/me/preferences'
        : null;

    if (!endpoint) return;

    void apiClient.put(endpoint, { language: lang }, { withCredentials: true }).catch(() => {
      if (selectionToken === activeSelectionRef.current) {
        persistStoredLanguage(lang);
      }
    });
  };

  const t = (key: string, params?: Record<string, string | number>): string => {
    const value = TRANSLATIONS[language]?.[key] || TRANSLATIONS.EN[key] || key;
    if (!params) return value;
    return Object.entries(params).reduce((result, [keyName, valueToReplace]) => {
      return result.replace(new RegExp(`\\{${keyName}\\}`, 'g'), String(valueToReplace));
    }, value);
  };

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  return useContext(LanguageContext);
}
