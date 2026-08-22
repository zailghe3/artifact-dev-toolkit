import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Artifact Dev Toolkit",
    short_name: "ADT",
    description: "A fast searchable library for prompts, agents, snippets, templates, and app ideas.",
    start_url: "/",
    display: "standalone",
    background_color: "#020617",
    theme_color: "#020617",
    icons: [
      {
        src: "/icons/adt-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/icons/adt-512.png",
        sizes: "512x512",
        type: "image/png",
      },
      {
        src: "/icons/adt-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
