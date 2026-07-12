import type { Config } from "tailwindcss";

// Tailwind CSS v4 is configured CSS-first in app/globals.css. This file remains
// as a compatibility shim for editor integrations or tools that still probe for
// a Tailwind config file.
const config: Config = {
  darkMode: "class",
  content: ["./app/**/*.{js,ts,jsx,tsx,mdx}", "./components/**/*.{js,ts,jsx,tsx,mdx}"],
};

export default config;
