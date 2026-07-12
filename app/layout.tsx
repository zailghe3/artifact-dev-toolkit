import type { Metadata } from "next";
import Script from "next/script";
import { DeploymentFooter } from "@/components/DeploymentFooter";
import { deploymentMetadata } from "@/lib/deployment-metadata";
import "./globals.css";

export const metadata: Metadata = {
  title: "Artifact Library",
  description: "A fast searchable library for prompts, agents, snippets, templates, and app ideas.",
};

const themeInitScript = `
(() => {
  try {
    const storedTheme = window.localStorage.getItem("artifact-library-theme");
    const theme = storedTheme === "light" || storedTheme === "dark" ? storedTheme : "dark";
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.dataset.theme = theme;
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
        <div className="flex min-h-screen flex-col">
          <div className="flex-1">{children}</div>
          <DeploymentFooter metadata={deploymentMetadata} />
        </div>
      </body>
    </html>
  );
}
