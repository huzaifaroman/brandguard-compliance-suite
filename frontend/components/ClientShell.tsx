"use client";

import { usePathname } from "next/navigation";
import { useState, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import { motion, AnimatePresence } from "framer-motion";
import { TooltipProvider } from "@/components/ui/tooltip";
import ErrorBoundary from "@/components/ErrorBoundary";

const Sidebar = dynamic(() => import("@/components/Sidebar"), { ssr: false });
const ExtErrorFilter = dynamic(() => import("@/components/ExtErrorFilter"), { ssr: false });

export default function ClientShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);
  const [navigating, setNavigating] = useState(false);
  const prevPathRef = useRef(pathname);

  useEffect(() => {
    const timer = setTimeout(() => setMounted(true), 50);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (prevPathRef.current !== pathname) {
      setNavigating(true);
      prevPathRef.current = pathname;
      const timer = setTimeout(() => setNavigating(false), 100);
      return () => clearTimeout(timer);
    }
  }, [pathname]);

  return (
    <>
      <ExtErrorFilter />
      <TooltipProvider>
        <div
          className="flex min-h-screen transition-opacity duration-500 ease-out"
          style={{ opacity: mounted ? 1 : 0 }}
        >
          <Sidebar />
          <main className="flex-1 overflow-auto" style={{ marginLeft: "var(--sidebar-width)" }}>
            <AnimatePresence>
              {navigating && (
                <motion.div
                  className="fixed top-0 left-0 right-0 z-[100] h-0.5"
                  style={{ marginLeft: "var(--sidebar-width)" }}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                >
                  <div className="h-full bg-primary progress-bar-indeterminate" />
                </motion.div>
              )}
            </AnimatePresence>
            <ErrorBoundary>
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.div
                  key={pathname}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15, ease: [0.25, 0.1, 0.25, 1] }}
                >
                  {children}
                </motion.div>
              </AnimatePresence>
            </ErrorBoundary>
          </main>
        </div>
      </TooltipProvider>
    </>
  );
}
