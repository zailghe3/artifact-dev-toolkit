"use client";

import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";
import { buttonStyles } from "@/components/Ui";

const storageKey = "artifact-library-theme";
const themeChangeEvent = "artifact-library-theme-change";
type Theme = "dark" | "light";

function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#111214" : "#fafafb");
}

function getThemeSnapshot(): Theme {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

function subscribeToThemeChanges(onStoreChange: () => void) {
  window.addEventListener(themeChangeEvent, onStoreChange);
  window.addEventListener("storage", onStoreChange);

  return () => {
    window.removeEventListener(themeChangeEvent, onStoreChange);
    window.removeEventListener("storage", onStoreChange);
  };
}

function getServerThemeSnapshot(): Theme {
  return "dark";
}

export function useThemePreference() {
  const theme = useSyncExternalStore(subscribeToThemeChanges, getThemeSnapshot, getServerThemeSnapshot);
  const nextTheme = theme === "dark" ? "light" : "dark";

  function toggleTheme() {
    applyTheme(nextTheme);
    try { window.localStorage.setItem(storageKey, nextTheme); } catch { /* storage may be disabled */ }
    window.dispatchEvent(new Event(themeChangeEvent));
  }

  return { nextTheme, toggleTheme };
}

export function ThemeToggle() {
  const { nextTheme, toggleTheme } = useThemePreference();
  const Icon = nextTheme === "light" ? Sun : Moon;
  return (
    <button type="button" onClick={toggleTheme} className={buttonStyles.secondary} aria-label={`Switch to ${nextTheme} mode`}>
      <Icon className="size-4" aria-hidden="true" />
      {nextTheme === "light" ? "Light" : "Dark"}
    </button>
  );
}
