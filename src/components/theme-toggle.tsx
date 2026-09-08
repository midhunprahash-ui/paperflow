"use client";

import { toast } from "sonner";
import { Moon, Sun } from "lucide-react";

export function ThemeToggle() {
  function toggleTheme() {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    toast.info(next === "dark" ? "Dark theme enabled" : "Light theme enabled", { id: "theme" });
    try { localStorage.setItem("paperflow-theme", next); } catch { /* Theme still works when storage is disabled. */ }
  }

  return (
    <button className="icon-button theme-toggle" type="button" onClick={toggleTheme} aria-label="Toggle light and dark theme">
      <Moon className="theme-icon-light" size={18} />
      <Sun className="theme-icon-dark" size={18} />
    </button>
  );
}
