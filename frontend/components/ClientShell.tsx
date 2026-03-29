"use client";

import { usePathname } from "next/navigation";
import dynamic from "next/dynamic";
import { motion, AnimatePresence } from "framer-motion";
import { TooltipProvider } from "@/components/ui/tooltip";
import ErrorBoundary from "@/components/ErrorBoundary";

const Sidebar = dynamic(() => import("@/components/Sidebar"), { ssr: false });
const ExtErrorFilter = dynamic(() => import("@/components/ExtErrorFilter"), { ssr: false });

const pageVariants = {
  initial: { opacity: 0, y: 8, filter: "blur(4px)" },
  enter: { opacity: 1, y: 0, filter: "blur(0px)" },
  exit: { opacity: 0, y: -8, filter: "blur(4px)" },
};

export default function ClientShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <>
      <ExtErrorFilter />
      <TooltipProvider>
        <div className="flex min-h-screen">
          <Sidebar />
          <main className="flex-1 overflow-auto" style={{ marginLeft: "var(--sidebar-width)" }}>
            <ErrorBoundary>
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={pathname}
                  variants={pageVariants}
                  initial="initial"
                  animate="enter"
                  exit="exit"
                  transition={{
                    duration: 0.3,
                    ease: [0.16, 1, 0.3, 1],
                  }}
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
