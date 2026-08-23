"use client";

import React, { useEffect, useState } from 'react';
import { Sun, Moon, Monitor } from 'lucide-react';

type Theme = 'light' | 'dark' | 'system';

// Applies the resolved theme by toggling the `dark` class on <html>.
// (The `dark` variant is enabled in globals.css.)
function applyTheme(theme: Theme) {
  if (typeof window === 'undefined') return;
  const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const isDark = theme === 'dark' || (theme === 'system' && systemDark);
  document.documentElement.classList.toggle('dark', isDark);
}

const OPTIONS: { value: Theme; icon: React.ComponentType<{ size?: number }>; label: string }[] = [
  { value: 'light', icon: Sun, label: 'Light' },
  { value: 'dark', icon: Moon, label: 'Dark' },
  { value: 'system', icon: Monitor, label: 'System default' },
];

export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('system');

  useEffect(() => {
    const saved = (localStorage.getItem('theme') as Theme) || 'system';
    setTheme(saved);
    applyTheme(saved);

    // Keep "system" in sync if the OS theme changes while selected.
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      if (((localStorage.getItem('theme') as Theme) || 'system') === 'system') applyTheme('system');
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const choose = (t: Theme) => {
    setTheme(t);
    localStorage.setItem('theme', t);
    applyTheme(t);
  };

  return (
    <div className="flex items-center gap-0.5 rounded-full border border-slate-200 bg-white p-0.5 dark:border-slate-700 dark:bg-slate-800">
      {OPTIONS.map((o) => {
        const Icon = o.icon;
        const active = theme === o.value;
        return (
          <button
            key={o.value}
            onClick={() => choose(o.value)}
            title={o.label}
            aria-label={o.label}
            aria-pressed={active}
            className={`flex h-7 w-7 items-center justify-center rounded-full transition ${
              active
                ? 'bg-gradient-to-br from-blue-600 to-indigo-600 text-white shadow-sm'
                : 'text-slate-500 hover:text-indigo-600 dark:text-slate-400 dark:hover:text-indigo-400'
            }`}
          >
            <Icon size={15} />
          </button>
        );
      })}
    </div>
  );
}
