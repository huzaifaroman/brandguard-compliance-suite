"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { prefetchRoute } from "@/lib/api";
import {
  Scan,
  Layers,
  BookOpen,
  Clock,
  ShieldCheck,
  Zap,
} from "lucide-react";
import ThemeToggle from "@/components/ThemeToggle";

const navItems = [
  { href: "/analyze", label: "Analyze", icon: Scan, description: "Single image" },
  { href: "/batch", label: "Batch", icon: Layers, description: "Up to 10 images" },
  { href: "/rules", label: "Rules", icon: BookOpen, description: "Brand guidelines" },
  { href: "/history", label: "History", icon: Clock, description: "Past analyses" },
];

const poweredByIcons = [
  { src: "/icons/azure-color.png", alt: "Microsoft Azure", tooltip: "Microsoft Azure" },
  { src: "/icons/azure-openai.png", alt: "Azure OpenAI", tooltip: "GPT-4.1" },
  { src: "/icons/computer-vision.png", alt: "Computer Vision", tooltip: "Computer Vision" },
  { src: "/icons/ai-studio.png", alt: "AI Studio", tooltip: "AI Studio" },
  { src: "/icons/azure-blob.png", alt: "Blob Storage", tooltip: "Blob Storage" },
  { src: "/icons/container-apps.png", alt: "Container Apps", tooltip: "Container Apps" },
  { src: "/icons/upstash-icon-white-bg.png", alt: "Upstash", tooltip: "Upstash Redis" },
];

export default function Sidebar() {
  const pathname = usePathname();
  return (
    <aside
      className="fixed left-0 top-0 h-screen flex flex-col glass-strong z-50"
      style={{ width: "var(--sidebar-width)" }}
    >
      <Link href="/analyze" className="block">
        <motion.div
          className="p-5 border-b border-border group cursor-pointer"
          whileHover={{ backgroundColor: "rgba(99,102,241,0.04)" }}
          transition={{ duration: 0.3 }}
        >
          <div className="flex items-center gap-3">
            <motion.div
              className="w-11 h-11 rounded-xl bg-gradient-to-br from-primary/15 to-primary/5 flex items-center justify-center relative animate-glow-pulse"
              whileHover={{ scale: 1.08, rotate: 3 }}
              whileTap={{ scale: 0.95 }}
              transition={{ type: "spring", stiffness: 400, damping: 20 }}
            >
              <ShieldCheck className="w-6 h-6 text-primary" />
              <motion.div
                className="absolute inset-0 rounded-xl border border-primary/20"
                initial={{ opacity: 0 }}
                whileHover={{ opacity: 1 }}
                transition={{ duration: 0.2 }}
              />
            </motion.div>
            <div>
              <motion.h1
                className="text-base font-bold tracking-tight gradient-text leading-tight"
                whileHover={{ letterSpacing: "0.01em" }}
                transition={{ duration: 0.3 }}
              >
                BrandGuard
              </motion.h1>
              <p className="text-[10px] text-muted-foreground tracking-wider uppercase group-hover:text-muted-foreground/80 transition-colors duration-300">
                Compliance Suite
              </p>
            </div>
          </div>
        </motion.div>
      </Link>

      <nav className="flex-1 p-3 space-y-0.5">
        {navItems.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              prefetch={true}
              className="relative block"
              onMouseEnter={() => prefetchRoute(item.href)}
              onFocus={() => prefetchRoute(item.href)}
            >
              <motion.div
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors duration-200 group relative z-10 ${
                  isActive
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                whileHover={{ x: isActive ? 0 : 2 }}
                whileTap={{ scale: 0.98 }}
                transition={{ type: "spring", stiffness: 400, damping: 25 }}
              >
                <AnimatePresence>
                  {isActive && (
                    <motion.div
                      layoutId="sidebar-active"
                      className="absolute inset-0 rounded-lg bg-primary/8 border border-primary/20"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ type: "spring", stiffness: 350, damping: 30 }}
                    />
                  )}
                </AnimatePresence>
                <Icon className={`w-[18px] h-[18px] relative z-10 transition-colors duration-200 ${isActive ? "text-primary" : "text-muted-foreground group-hover:text-foreground"}`} />
                <div className="flex flex-col relative z-10">
                  <span className="text-[13px] font-medium leading-tight">{item.label}</span>
                  <span className="text-[10px] text-muted-foreground leading-tight">{item.description}</span>
                </div>
                {isActive && (
                  <motion.div
                    className="ml-auto w-1.5 h-1.5 rounded-full bg-primary relative z-10"
                    layoutId="sidebar-dot"
                    transition={{ type: "spring", stiffness: 400, damping: 25 }}
                  />
                )}
              </motion.div>
            </Link>
          );
        })}
      </nav>

      <div className="px-3 pb-2">
        <ThemeToggle />
      </div>

      <div className="p-4 border-t border-border">
        <div className="flex items-center gap-2 mb-3">
          <Zap className="w-3.5 h-3.5 text-primary/70" />
          <span className="text-[11px] text-muted-foreground uppercase tracking-wider font-medium">
            Powered By
          </span>
        </div>

        <div className="flex flex-wrap gap-2.5">
          {poweredByIcons.map((icon, i) => (
            <motion.div
              key={icon.alt}
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.1 + i * 0.06, type: "spring", stiffness: 400, damping: 20 }}
              className="group/icon relative"
            >
              <motion.div
                className="w-10 h-10 rounded-xl bg-background/80 border border-border/50 flex items-center justify-center cursor-default hover:border-primary/30 hover:bg-primary/5 hover:shadow-md transition-all duration-200"
                whileHover={{ scale: 1.15, y: -3 }}
                whileTap={{ scale: 0.95 }}
                transition={{ type: "spring", stiffness: 400, damping: 20 }}
              >
                <img
                  src={icon.src}
                  alt={icon.alt}
                  className="w-[22px] h-[22px] object-contain"
                />
              </motion.div>
              <div className="absolute -top-8 left-1/2 -translate-x-1/2 px-2 py-1 rounded-md bg-popover border border-border text-[9px] text-foreground whitespace-nowrap opacity-0 group-hover/icon:opacity-100 transition-opacity duration-200 pointer-events-none shadow-lg z-50">
                {icon.tooltip}
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </aside>
  );
}

