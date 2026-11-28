import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";

export const metadata: Metadata = {
  title: "Artifact Library",
  description: "A fast searchable library for prompts, agents, snippets, templates, and app ideas.",
  appleWebApp: {
    capable: true,
    title: "ADT",
    statusBarStyle: "black-translucent",
  },
};

export const viewport = {
  themeColor: "#111214",
  viewportFit: "cover" as const,
};

const themeInitScript = `
(() => {
  try {
    const storedTheme = window.localStorage.getItem("artifact-library-theme");
    const theme = storedTheme === "light" || storedTheme === "dark" ? storedTheme : "dark";
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#111214" : "#fafafb");
  } catch {
    document.documentElement.classList.add("dark");
    document.documentElement.dataset.theme = "dark";
  }
})();
`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="dark" data-theme="dark" suppressHydrationWarning>
      <Script id="theme-init" strategy="beforeInteractive" dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      <body>
        <div className="flex min-h-dvh flex-col">
          <div className="flex-1">{children}</div>
        </div>
      </body>
    </html>
  );
}
