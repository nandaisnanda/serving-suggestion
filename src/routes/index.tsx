import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Peta Suara, Kemiskinan, dan Dapur MBG" },
      { name: "description", content: "Hasil Pilpres 2024 per provinsi, disandingkan dengan kemiskinan, lama sekolah, dan dapur MBG." },
      { property: "og:title", content: "Peta Suara, Kemiskinan, dan Dapur MBG" },
      { property: "og:description", content: "#30DayMapChallenge Hari 3 · Poligon — 38 provinsi Indonesia." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

// The map itself is a plain static site in public/peta/ (GitHub Pages-ready).
function Index() {
  useEffect(() => {
    window.location.replace("/peta/index.html" + window.location.search);
  }, []);
  return null;
}
