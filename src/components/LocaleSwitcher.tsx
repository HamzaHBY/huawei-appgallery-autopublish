"use client";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";

export function LocaleSwitcher() {
  const router = useRouter();
  const locale = useLocale();
  const next = locale === "ar" ? "en" : "ar";
  const label = locale === "ar" ? "English" : "العربية";
  async function switchTo() {
    document.cookie = `ui-locale=${next}; path=/; max-age=31536000`;
    router.refresh();
  }
  return (
    <button onClick={switchTo} className="text-sm text-neutral-600 hover:underline">
      {label}
    </button>
  );
}
