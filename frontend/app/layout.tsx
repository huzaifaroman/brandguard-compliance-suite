import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Sidebar from "@/components/Sidebar";
import ErrorBoundary from "@/components/ErrorBoundary";
import { TooltipProvider } from "@/components/ui/tooltip";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ComplianceAI | Marketing Engine",
  description: "AI-powered marketing compliance analysis for ZONNIC brand guidelines",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              window.addEventListener('error', function(e) {
                if (e.filename && (e.filename.indexOf('webkit-masked-url') !== -1 || e.filename.indexOf('extension') !== -1)) {
                  e.stopImmediatePropagation();
                  e.preventDefault();
                  return true;
                }
                if (e.message && (e.message.indexOf('fixinatorInputs') !== -1 || e.message.indexOf('webkit-masked-url') !== -1)) {
                  e.stopImmediatePropagation();
                  e.preventDefault();
                  return true;
                }
              }, true);
              window.addEventListener('unhandledrejection', function(e) {
                var r = e.reason;
                if (r && typeof r === 'object' && r.stack && r.stack.indexOf('webkit-masked-url') !== -1) {
                  e.stopImmediatePropagation();
                  e.preventDefault();
                  return true;
                }
              }, true);
            `,
          }}
        />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`} suppressHydrationWarning>
        <TooltipProvider>
          <div className="flex min-h-screen">
            <Sidebar />
            <main className="flex-1 overflow-auto" style={{ marginLeft: "var(--sidebar-width)" }}>
              <ErrorBoundary>
                {children}
              </ErrorBoundary>
            </main>
          </div>
        </TooltipProvider>
      </body>
    </html>
  );
}
