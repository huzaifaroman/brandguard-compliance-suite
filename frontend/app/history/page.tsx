"use client";

import { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Clock,
  ImageIcon,
  ShieldCheck,
  ShieldAlert,
  ShieldQuestion,
  Fingerprint,
  ExternalLink,
  RefreshCw,
  Inbox,
} from "lucide-react";
import { getHistory } from "@/lib/api";
import { cacheInvalidatePrefix } from "@/lib/cache";
import type { HistoryItem } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { HistorySkeleton } from "@/components/Skeletons";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export default function HistoryPage() {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadHistory = useCallback((forceRefresh = false) => {
    if (forceRefresh) cacheInvalidatePrefix("history:");
    setLoading(true);
    getHistory()
      .then((res) => {
        setItems(res.items);
        setTotal(res.total);
        setError(null);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadHistory();
  }, []);

  const hashGroups = items.reduce<Record<string, HistoryItem[]>>((acc, item) => {
    if (!acc[item.image_hash]) acc[item.image_hash] = [];
    acc[item.image_hash].push(item);
    return acc;
  }, {});

  const verdictIcon = (v: string) => {
    if (v === "PASS") return <ShieldCheck className="w-4 h-4 text-green-400" />;
    if (v === "FAIL") return <ShieldAlert className="w-4 h-4 text-red-400" />;
    return <ShieldQuestion className="w-4 h-4 text-amber-400" />;
  };

  const verdictColor = (v: string) =>
    v === "PASS" ? "text-green-400" : v === "FAIL" ? "text-red-400" : "text-amber-400";

  return (
    <div className="min-h-screen p-6 lg:p-8">
      <div className="max-w-5xl mx-auto">
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-primary/10 animate-glow-pulse">
                <Clock className="w-5 h-5 text-primary" />
              </div>
              <div>
                <h1 className="text-2xl font-bold tracking-tight gradient-text">Analysis History</h1>
                <p className="text-sm text-muted-foreground">
                  {total} analyses stored with consistency verification
                </p>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={() => loadHistory(true)} disabled={loading} className="gap-2">
              <RefreshCw className={`w-3.5 h-3.5 transition-transform duration-500 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        </motion.div>

        <AnimatePresence mode="wait">
          {loading && items.length === 0 && (
            <motion.div key="skeleton" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <HistorySkeleton />
            </motion.div>
          )}

          {error && (
            <motion.div key="error" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <Card className="border-red-500/30 bg-red-500/5">
                <CardContent className="p-4 flex items-center justify-between">
                  <p className="text-sm text-red-400">{error}</p>
                  <Button variant="ghost" size="sm" onClick={loadHistory} className="text-red-400 h-7 text-xs gap-1.5">
                    <RefreshCw className="w-3 h-3" /> Retry
                  </Button>
                </CardContent>
              </Card>
            </motion.div>
          )}

          {!loading && items.length === 0 && !error && (
            <motion.div key="empty" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
              <Card>
                <CardContent className="p-16 text-center">
                  <motion.div
                    animate={{ y: [0, -6, 0] }}
                    transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
                    className="inline-flex p-4 rounded-2xl bg-muted/50 mb-4"
                  >
                    <Inbox className="w-10 h-10 text-muted-foreground/50" />
                  </motion.div>
                  <p className="text-sm font-medium mb-1">No analyses yet</p>
                  <p className="text-xs text-muted-foreground">
                    Run your first compliance check on the Analyze page.
                  </p>
                </CardContent>
              </Card>
            </motion.div>
          )}

          {!loading && items.length > 0 && (
            <motion.div key="list" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <ScrollArea className="max-h-[calc(100vh-200px)]">
                <div className="space-y-3">
                  {Object.values(hashGroups).map((group, groupIdx) => {
                    const isMultiple = group.length > 1;
                    const allSameVerdict = group.every((g) => g.verdict === group[0].verdict);

                    return (
                      <motion.div
                        key={group[0].image_hash}
                        initial={{ opacity: 0, y: 15 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: groupIdx * 0.05, duration: 0.3 }}
                      >
                        <Card className={`overflow-hidden card-hover ${isMultiple ? "border-blue-500/30" : ""}`}>
                          {isMultiple && (
                            <div className="flex items-center gap-2 px-4 py-2.5 bg-blue-500/5 border-b border-blue-500/20">
                              <Fingerprint className="w-3.5 h-3.5 text-blue-400" />
                              <span className="text-xs font-medium text-blue-400">
                                Consistency {allSameVerdict ? "verified" : "check"} — analyzed {group.length} times
                                {allSameVerdict ? " with same result" : ""}
                              </span>
                              {allSameVerdict && <ShieldCheck className="w-3 h-3 text-green-400 ml-auto" />}
                            </div>
                          )}
                          <CardContent className="p-0">
                            <div className={isMultiple ? "divide-y divide-blue-500/10" : ""}>
                              {group.map((item) => (
                                <div key={item.id} className="flex items-center gap-4 p-4 hover:bg-accent/20 transition-colors duration-200">
                                  <ImageThumbnail url={item.blob_url} />
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 mb-1">
                                      {verdictIcon(item.verdict)}
                                      <span className={`text-sm font-semibold ${verdictColor(item.verdict)}`}>
                                        {item.verdict}
                                      </span>
                                      <span className="text-xs text-muted-foreground tabular-nums">
                                        {item.confidence}%
                                      </span>
                                      <Badge variant="outline" className="text-[10px] ml-auto">
                                        {item.violations_count} violation{item.violations_count !== 1 ? "s" : ""}
                                      </Badge>
                                    </div>
                                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                                      <span>{new Date(item.timestamp).toLocaleString()}</span>
                                      {item.session_id && (
                                        <code className="font-mono text-[10px] opacity-60 text-primary">
                                          RPT-{item.session_id.slice(0, 8).toUpperCase()}
                                        </code>
                                      )}
                                      {item.session_id && (
                                        <a
                                          href={`/report/${item.session_id}`}
                                          className="flex items-center gap-1 text-primary hover:underline transition-colors font-medium"
                                        >
                                          <ExternalLink className="w-3 h-3" />
                                          View Report
                                        </a>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </CardContent>
                        </Card>
                      </motion.div>
                    );
                  })}
                </div>
              </ScrollArea>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function ImageThumbnail({ url }: { url: string | null }) {
  const [failed, setFailed] = useState(false);

  useEffect(() => { setFailed(false); }, [url]);

  if (!url || failed) {
    return (
      <div className="w-12 h-12 rounded-lg bg-muted/60 flex items-center justify-center flex-shrink-0 border border-border/30">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-muted-foreground/40">
          <rect x="3" y="3" width="18" height="18" rx="3" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="9" cy="9" r="2" stroke="currentColor" strokeWidth="1.5" />
          <path d="M3 16l4.293-4.293a1 1 0 011.414 0L13 16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <path d="M13 14l2.293-2.293a1 1 0 011.414 0L21 16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </div>
    );
  }

  return (
    <div className="w-12 h-12 rounded-lg bg-muted/60 flex items-center justify-center flex-shrink-0 overflow-hidden border border-border/30">
      <img
        src={url}
        alt="Analysis"
        className="w-full h-full object-cover"
        onError={() => setFailed(true)}
      />
    </div>
  );
}
