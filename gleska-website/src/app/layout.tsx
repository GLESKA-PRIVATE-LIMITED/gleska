import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "GO LESKA — Kaam Milega. Turant.",
  description: "AI-powered hiring for India's blue-collar workforce.",
};

import { LanguageProvider } from "@/context/LanguageContext";
import { AuthProvider } from "@/context/AuthContext";
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
            {children}
            <Toaster position="top-right" richColors closeButton />
          </LanguageProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
