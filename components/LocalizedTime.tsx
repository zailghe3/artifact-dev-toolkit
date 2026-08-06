"use client";

import { useSyncExternalStore } from "react";

export const LOCAL_TIME_FORMAT: Intl.DateTimeFormatOptions = { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short" };
export function formatLocalizedTime(value: string, locale?: string, timeZone?: string): string | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(locale, { ...LOCAL_TIME_FORMAT, ...(timeZone ? { timeZone } : {}) }).format(date);
}
export function LocalizedTime({ value, prefix, title }: { value: string; prefix?: string; title?: string }) {
  const valid = !Number.isNaN(new Date(value).getTime());
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);
  const display = mounted ? formatLocalizedTime(value) ?? "Invalid timestamp" : valid ? value : "Invalid timestamp";
  return <time dateTime={valid ? value : undefined} title={title ?? value} suppressHydrationWarning>{prefix}{display}</time>;
}
