import { getRequestConfig } from "next-intl/server";
import { cookies } from "next/headers";
import { UI_LOCALES, type UiLocale } from "@/lib/locales";

export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const requested = cookieStore.get("ui-locale")?.value as UiLocale | undefined;
  const locale: UiLocale = requested && UI_LOCALES.includes(requested) ? requested : "en";
  const messages = (await import(`../../messages/${locale}.json`)).default;
  return { locale, messages };
});
