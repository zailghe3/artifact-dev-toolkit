import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{js,ts,jsx,tsx,mdx}", "./components/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        ink: "#14213d",
        paper: "#f8fafc",
      },
      boxShadow: {
        soft: "0 18px 60px -30px rgba(15, 23, 42, 0.45)",
      },
    },
  },
  plugins: [],
};
export default config;
