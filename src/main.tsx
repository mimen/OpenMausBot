import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { applySkin, readSkin, SKIN_IDS } from "./lib/skins";
import "./styles.css";

// Before the first paint, not inside a component: stamping the skin during
// render would show one frame of the default palette first.
const search = new URLSearchParams(window.location.search);
const gallery = search.get("component-gallery") === "1";
const requestedSkin = search.get("skin");
const gallerySkin = gallery ? SKIN_IDS.find((skin) => skin === requestedSkin) ?? null : null;
applySkin(gallerySkin ?? readSkin());
if (gallery) {
  document.documentElement.style.height = "auto";
  document.body.style.height = "auto";
  document.body.style.overflow = "auto";
  const root = document.getElementById("root");
  if (root) root.style.height = "auto";
}

const GalleryRoute = lazy(async () => {
  const module = await import("./component-gallery");
  return { default: module.ComponentGallery };
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {gallery ? <Suspense fallback={<div className="min-h-full bg-app" />}><GalleryRoute /></Suspense> : <App />}
  </StrictMode>,
);
