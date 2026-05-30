import "./globals.css";
import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import Link from "next/link";
import { LocaleSwitcher } from "@/components/LocaleSwitcher";

export const metadata: Metadata = {
  title: "Huawei AppGallery Auto-Publish",
  description: "Upload an APK. We generate metadata, screenshots, translations, and submit to Huawei.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const messages = await getMessages();
  const dir = locale === "ar" ? "rtl" : "ltr";

  return (
    <html lang={locale} dir={dir}>
      <body className="min-h-screen bg-neutral-50 text-neutral-900 antialiased">
        <NextIntlClientProvider locale={locale} messages={messages}>
          <header className="border-b border-neutral-200 bg-white">
            <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
              <Link href="/" className="flex items-center gap-2">
                <span className="inline-block h-6 w-6 rounded bg-brand" />
                <span className="font-semibold">AGC Auto-Publish</span>
              </Link>
              <nav className="flex items-center gap-4 text-sm">
                <Link href="/" className="hover:underline">Dashboard</Link>
                <Link href="/settings" className="hover:underline">Settings</Link>
                <LocaleSwitcher />
              </nav>
            </div>
          </header>
          <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
