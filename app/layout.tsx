import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Artifact Library",
  description: "A fast searchable library for prompts, agents, snippets, templates, and app ideas.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
