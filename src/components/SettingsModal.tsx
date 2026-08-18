"use client";

import { useEffect, useState } from "react";
import ThemeToggle from "@/components/ThemeToggle";

// Just one tab today (Theme) — structured as a tab bar rather than a plain
// panel so future settings (e.g. notification preferences) have somewhere
// to go without redesigning this.
const TABS = [{ key: "theme", label: "Theme" }] as const;
type TabKey = (typeof TABS)[number]["key"];

export default function SettingsModal({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<TabKey>("theme");

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onClick={onClose}>
      <div
        className="card w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
      >
        <div className="mb-4 flex items-start justify-between">
          <h2 className="text-lg font-semibold tracking-tight">Settings</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-slate-400 hover:text-slate-700 dark:text-slate-500 dark:hover:text-slate-200"
          >
            ✕
          </button>
        </div>

        <div className="mb-4 flex gap-1 border-b border-slate-200 dark:border-slate-800">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
                tab === t.key
                  ? "border-slate-900 text-slate-900 dark:border-slate-100 dark:text-slate-100"
                  : "border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "theme" && (
          <div className="field">
            <label>Appearance</label>
            <ThemeToggle />
          </div>
        )}
      </div>
    </div>
  );
}
