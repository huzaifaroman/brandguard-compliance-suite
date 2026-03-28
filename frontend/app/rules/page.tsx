"use client";

import { useEffect, useState } from "react";
import { BookOpen, Loader2 } from "lucide-react";
import { getRules } from "@/lib/api";

export default function RulesPage() {
  const [rules, setRules] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getRules()
      .then((r) => {
        if (r.rules && typeof r.rules === "object") {
          setRules(r.rules as Record<string, unknown>);
        } else {
          setRules({});
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const categoryColors: Record<string, { bg: string; border: string; icon: string }> = {
    logo_rules: { bg: "rgba(59,130,246,0.08)", border: "rgba(59,130,246,0.2)", icon: "#3b82f6" },
    color_rules: { bg: "rgba(168,85,247,0.08)", border: "rgba(168,85,247,0.2)", icon: "#a855f7" },
    typography_rules: { bg: "rgba(245,158,11,0.08)", border: "rgba(245,158,11,0.2)", icon: "#f59e0b" },
    gradient_rules: { bg: "rgba(236,72,153,0.08)", border: "rgba(236,72,153,0.2)", icon: "#ec4899" },
    background_rules: { bg: "rgba(34,197,94,0.08)", border: "rgba(34,197,94,0.2)", icon: "#22c55e" },
    regulatory_rules: { bg: "rgba(239,68,68,0.08)", border: "rgba(239,68,68,0.2)", icon: "#ef4444" },
  };

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold" style={{ color: "var(--foreground)" }}>
          Compliance Rules
        </h1>
        <p className="mt-1 text-sm" style={{ color: "var(--muted-foreground)" }}>
          The brand guidelines currently loaded into the compliance engine.
        </p>
      </div>

      {loading && (
        <div className="flex items-center gap-3 text-sm" style={{ color: "var(--muted-foreground)" }}>
          <Loader2 size={16} className="animate-spin" />
          Loading rules...
        </div>
      )}

      {error && (
        <div className="rounded-xl px-4 py-3 text-sm" style={{ background: "rgba(239,68,68,0.08)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.2)" }}>
          {error}
        </div>
      )}

      {rules && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {Object.entries(rules).map(([category, data]) => {
            if (category.startsWith("_") || category === "version") return null;
            const colors = categoryColors[category] || { bg: "rgba(255,255,255,0.04)", border: "rgba(255,255,255,0.08)", icon: "#718096" };
            const label = category.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
            const items = Array.isArray(data) ? data : typeof data === "object" && data ? Object.values(data as object) : [];

            return (
              <div
                key={category}
                className="rounded-xl p-5"
                style={{ background: colors.bg, border: `1px solid ${colors.border}` }}
              >
                <div className="flex items-center gap-2 mb-4">
                  <BookOpen size={16} style={{ color: colors.icon }} />
                  <h3 className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>
                    {label}
                  </h3>
                  <span
                    className="ml-auto text-xs px-2 py-0.5 rounded-full"
                    style={{ background: "rgba(255,255,255,0.06)", color: "var(--muted-foreground)" }}
                  >
                    {items.length} rule{items.length !== 1 ? "s" : ""}
                  </span>
                </div>
                {items.length === 0 ? (
                  <p className="text-xs italic" style={{ color: "var(--muted-foreground)" }}>
                    No rules in this category yet.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {(items as unknown[]).map((item, i) => (
                      <div
                        key={i}
                        className="rounded-lg px-3 py-2.5 text-xs"
                        style={{ background: "rgba(0,0,0,0.2)", color: "var(--foreground)" }}
                      >
                        {typeof item === "string"
                          ? item
                          : typeof item === "object" && item !== null
                          ? JSON.stringify(item, null, 2)
                          : String(item)}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
