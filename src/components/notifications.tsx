"use client";

import { useEffect, useState } from "react";
import { Toaster } from "sonner";

export function Notifications() {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  useEffect(() => {
    const sync = () => setTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "light");
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);
  return <Toaster className="app-toaster" position="bottom-right" theme={theme} richColors closeButton duration={4500} offset={24} mobileOffset={{ bottom: 84, right: 14, left: 14 }} toastOptions={{ style: { fontFamily: "var(--font-ui)", borderRadius: "var(--radius)" }, actionButtonStyle: { borderRadius: "var(--radius)" }, cancelButtonStyle: { borderRadius: "var(--radius)" } }} />;
}
