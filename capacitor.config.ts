import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "app.lovable.726e77222f8e412f8aa88fc60fbb6966",
  appName: "airtouch-v5",
  webDir: "dist",
  server: {
    // Hot-reload from the Lovable sandbox preview while developing on device.
    // Remove this block (or comment it out) before producing a release build
    // for the Play Store / App Store so the bundled web assets are used.
    url: "https://726e7722-2f8e-412f-8aa8-8fc60fbb6966.lovableproject.com?forceHideBadge=true",
    cleartext: true,
  },
};

export default config;
