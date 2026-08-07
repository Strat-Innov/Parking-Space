import type { Metadata } from "next";
import "./globals.css";
import { getSession } from "@/lib/auth";
import Nav from "@/components/Nav";
import type { Role } from "@/lib/types";

export const metadata: Metadata = {
  title: "Parking Space",
  description: "Parking Space Request Automation",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();

  return (
    <html lang="en">
      <body>
        {session && <Nav name={session.name} role={session.role as Role} />}
        <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
