import type { Metadata } from "next";
import "./globals.css";
import { getSession } from "@/lib/auth";
import Nav from "@/components/Nav";
import { ThemeProvider } from "@/components/ThemeProvider";
import ThemeToggle from "@/components/ThemeToggle";
import type { Role } from "@/lib/types";

export const metadata: Metadata = {
  title: "Parking Space",
  description: "Parking Space Request Automation",
};

// Runs before hydration so the page never flashes the wrong theme: applies
// the "dark" class synchronously from localStorage, or the OS preference
// when no choice has been saved yet (default = follow system).
const NO_FLASH_THEME_SCRIPT = `
(function () {
  try {
    var stored = localStorage.getItem('parking-space-theme');
    var isDark = stored === 'dark' || (stored !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    if (isDark) document.documentElement.classList.add('dark');
  } catch (e) {}
})();
`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH_THEME_SCRIPT }} />
      </head>
      <body>
        <ThemeProvider>
          {session ? (
            <Nav name={session.name} role={session.role as Role} />
          ) : (
            <div className="flex justify-end px-6 py-3">
              <ThemeToggle />
            </div>
          )}
          <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
        </ThemeProvider>
      </body>
    </html>
  );
}
