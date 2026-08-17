"use client";

import { useEffect, useRef, useState } from "react";

export type DownloadOption = { format: string; label: string; description: string; href: string };

export default function DownloadMenu({ label, options }: { label: string; options: DownloadOption[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  return (
    <div className="relative inline-block" ref={ref}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="btn-secondary py-1.5">
        {label} <span className="ml-1 text-xs text-slate-400 dark:text-slate-500">▾</span>
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-2 w-64 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-900">
          {options.map((o) => (
            <a
              key={o.format}
              href={o.href}
              onClick={() => setOpen(false)}
              className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              <span className="font-medium text-slate-900 dark:text-slate-100">{o.label}</span>
              <span className="text-xs text-slate-400 dark:text-slate-500">{o.description}</span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
