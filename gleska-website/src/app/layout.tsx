import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "GO LESKA AI",
  description: "AI FOR BUSINESSES AND INDUSTRIES.",
  icons: {
    icon: "/favicon.ico",
    shortcut: "/favicon.ico",
  },
};

import { LanguageProvider } from "@/context/LanguageContext";
import { AuthProvider } from "@/context/AuthContext";
import { IntlProvider } from "@/components/providers/IntlProvider";
import { Toaster } from "sonner";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        suppressHydrationWarning
        className="antialiased selection:bg-[var(--color-saffron)] selection:text-white"
      >
        <AuthProvider>
          <LanguageProvider>
            <IntlProvider>
              {children}
              <Toaster position="top-right" richColors closeButton />
            </IntlProvider>
          </LanguageProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
