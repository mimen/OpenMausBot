import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { applySkin, readSkin } from "./lib/skins";
import "./styles.css";

// Before the first paint, not inside a component: stamping the skin during
// render would show one frame of the default palette first.
applySkin(readSkin());

const gallery = new URLSearchParams(window.location.search).get("component-gallery") === "1";
const GalleryRoute = lazy(async () => {
  const module = await import("./component-gallery");
  return { default: module.ComponentGallery };
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {gallery ? <Suspense fallback={<div className="min-h-full bg-app" />}><GalleryRoute /></Suspense> : <App />}
  </StrictMode>,
);
