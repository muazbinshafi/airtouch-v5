import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// PWA / service worker registration — strictly guarded so the SW never
// activates inside Lovable's preview iframe (which would cause stale
// content + navigation interference).
const isInIframe = (() => {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
})();
const isPreviewHost =
  typeof window !== "undefined" &&
  (window.location.hostname.includes("id-preview--") ||
    window.location.hostname.includes("lovableproject.com"));

if (isInIframe || isPreviewHost) {
  // Belt-and-suspenders: if a SW was ever registered, kill it in preview.
  navigator.serviceWorker?.getRegistrations().then((regs) => {
    regs.forEach((r) => r.unregister());
  });
} else if ("serviceWorker" in navigator && import.meta.env.PROD) {
  // Use the auto-generated SW from vite-plugin-pwa.
  import("virtual:pwa-register").then(({ registerSW }) => {
    registerSW({ immediate: true });
  });
}

createRoot(document.getElementById("root")!).render(<App />);
