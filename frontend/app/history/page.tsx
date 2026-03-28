"use client";

import { useEffect, useState } from "react";
import { History, Loader2, ImageIcon } from "lucide-react";
import { getHistory } from "@/lib/api";
import type { HistoryItem } from "@/lib/types";

export default function HistoryPage() {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getHistory()
      .then((res) => {
        setItems(res.items);
        setTotal(res.total);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const hashGroups = items.reduce<Record<string, HistoryItem[]>>((acc, item) => {
    if (!acc[item.image_hash]) acc[item.image_hash] = [];
    acc[item.image_hash].push(item);
    return acc;
  }, {});

  const verdictColor = (v: string) =>
    v === "PASS" ? "#22c55e" : v === "FAIL" ? "#ef4444" : "#f59e0b";

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold" style={{ color: "var(--foreground)" }}>
          Analysis History
        </h1>
        <p className="mt-1 text-sm" style={{ color: "var(--muted-foreground)" }}>
          {total} analyses stored · same image hash = consistency verified
        </p>
      </div>

      {loading && (
        <div className="flex items-center gap-3 text-sm" style={{ color: "var(--muted-foreground)" }}>
          <Loader2 size={16} className="animate-spin" />
          Loading history...
        </div>
      )}

      {error && (
        <div className="rounded-xl px-4 py-3 text-sm" style={{ background: "rgba(239,68,68,0.08)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.2)" }}>
          {error}
        </div>
      )}

      {!loading && items.length === 0 && !error && (
        <div
          className="rounded-xl p-12 text-center"
          style={{ background: "var(--card)", border: "1px solid var(--border)" }}
        >
          <History size={32} className="mx-auto mb-3" style={{ color: "var(--muted-foreground)" }} />
          <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>
            No analyses yet. Run your first compliance check on the Analyze page.
          </p>
        </div>
      )}

      {!loading && items.length > 0 && (
        <div className="space-y-4">
          {Object.values(hashGroups).map((group) => {
            const isMultiple = group.length > 1;
            return (
              <div
                key={group[0].image_hash}
                className="rounded-xl overflow-hidden"
                style={{
                  border: isMultiple ? "1px solid rgba(59,130,246,0.3)" : "1px solid var(--border)",
                  background: isMultiple ? "rgba(59,130,246,0.04)" : "var(--card)",
                }}
              >
                {isMultiple && (
                  <div
                    className="px-4 py-2 text-xs font-medium flex items-center gap-2"
                    style={{ background: "rgba(59,130,246,0.1)", borderBottom: "1px solid rgba(59,130,246,0.2)", color: "#60a5fa" }}
                  >
                    ⚡ Consistency verified — same image analyzed {group.length} times
                  </div>
                )}
                <div className={isMultiple ? "grid grid-cols-2 divide-x" : ""} style={isMultiple ? { borderColor: "rgba(59,130,246,0.2)" } : {}}>
                  {group.map((item, i) => (
                    <div key={item.id} className="p-4 flex gap-4">
                      <div
                        className="w-14 h-14 rounded-lg flex items-center justify-center flex-shrink-0"
                        style={{ background: "var(--muted)" }}
                      >
                        {item.blob_url ? (
                          <img
                            src={item.blob_url}
                            alt="Analysis"
                            className="w-full h-full object-cover rounded-lg"
                          />
                        ) : (
                          <ImageIcon size={20} style={{ color: "var(--muted-foreground)" }} />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-sm font-semibold" style={{ color: verdictColor(item.verdict) }}>
                            {item.verdict}
                          </span>
                          <span className="text-xs" style={{ color: "var(--muted-foreground)" }}>
                            {item.confidence.toFixed(0)}% confidence
                          </span>
                          {isMultiple && (
                            <span className="text-xs ml-auto" style={{ color: "var(--muted-foreground)" }}>
                              Run {i + 1}
                            </span>
                          )}
                        </div>
                        <div className="text-xs" style={{ color: "var(--muted-foreground)" }}>
                          {item.violations_count} violation{item.violations_count !== 1 ? "s" : ""} ·{" "}
                          {new Date(item.timestamp).toLocaleString()}
                        </div>
                        <div
                          className="text-xs mt-1 font-mono truncate"
                          style={{ color: "var(--muted-foreground)", opacity: 0.5 }}
                        >
                          {item.image_hash.slice(0, 16)}...
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
