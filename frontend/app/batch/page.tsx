"use client";

import { useState, useCallback } from "react";
import { useDropzone } from "react-dropzone";
import { motion, AnimatePresence } from "framer-motion";
import {
  Upload,
  Loader2,
  Layers,
  ChevronDown,
  ChevronUp,
  ShieldCheck,
  ShieldAlert,
  ShieldQuestion,
  X,
  RotateCcw,
} from "lucide-react";
import { batchAnalyze } from "@/lib/api";
import type { BatchResult } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";

const MAX_FILES = 10;

export default function BatchPage() {
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<BatchResult | null>(null);
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const onDrop = useCallback(
    (accepted: File[]) => {
      const combined = [...files, ...accepted].slice(0, MAX_FILES);
      setFiles(combined);
      setPreviews(combined.map((f) => URL.createObjectURL(f)));
      setResult(null);
      setError(null);
    },
    [files]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "image/*": [".png", ".jpg", ".jpeg", ".webp"] },
    maxFiles: MAX_FILES,
  });

  const removeFile = (i: number) => {
    setFiles((prev) => prev.filter((_, idx) => idx !== i));
    setPreviews((prev) => prev.filter((_, idx) => idx !== i));
  };

  const handleSubmit = async () => {
    if (!files.length) return;
    setLoading(true);
    setError(null);
    try {
      const res = await batchAnalyze(files);
      setResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Batch analysis failed");
    } finally {
      setLoading(false);
    }
  };

  const toggleRow = (i: number) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });
  };

  const handleReset = () => {
    setResult(null);
    setFiles([]);
    setPreviews([]);
    setExpandedRows(new Set());
  };

  const verdictIcon = (v: string) => {
    if (v === "PASS") return <ShieldCheck className="w-4 h-4 text-green-400" />;
    if (v === "FAIL") return <ShieldAlert className="w-4 h-4 text-red-400" />;
    return <ShieldQuestion className="w-4 h-4 text-amber-400" />;
  };

  const verdictColor = (v: string) =>
    v === "PASS" ? "text-green-400" : v === "FAIL" ? "text-red-400" : "text-amber-400";

  return (
    <div className="min-h-screen p-6 lg:p-8">
      <div className="max-w-6xl mx-auto">
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
          <div className="flex items-center gap-3 mb-1">
            <div className="p-2 rounded-lg bg-primary/10">
              <Layers className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Batch Analysis</h1>
              <p className="text-sm text-muted-foreground">
                Upload up to {MAX_FILES} images for parallel compliance checking
              </p>
            </div>
          </div>
        </motion.div>

        {!result && (
          <div className="space-y-5">
            <Card className="overflow-hidden">
              <CardContent className="p-0">
                <div
                  {...getRootProps()}
                  className={`p-10 text-center cursor-pointer transition-all duration-300 ${
                    isDragActive ? "bg-primary/5 ring-2 ring-primary/30" : ""
                  }`}
                >
                  <input {...getInputProps()} />
                  <motion.div
                    animate={isDragActive ? { scale: 1.1 } : { scale: 1 }}
                    className="inline-flex p-4 rounded-2xl bg-primary/5 mb-4"
                  >
                    <Layers className="w-8 h-8 text-primary/60" />
                  </motion.div>
                  <p className="text-sm font-medium mb-1">
                    {isDragActive ? "Release to add images" : "Drop images or click to browse"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {files.length}/{MAX_FILES} selected
                  </p>
                </div>
              </CardContent>
            </Card>

            {previews.length > 0 && (
              <div className="grid grid-cols-5 sm:grid-cols-5 md:grid-cols-5 gap-3">
                {previews.map((src, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="relative group"
                  >
                    <Card className="overflow-hidden aspect-square">
                      <img
                        src={src}
                        alt={files[i]?.name}
                        className="w-full h-full object-cover"
                      />
                      <button
                        onClick={(e) => { e.stopPropagation(); removeFile(i); }}
                        className="absolute top-1.5 right-1.5 rounded-full w-5 h-5 flex items-center justify-center bg-black/70 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <X className="w-3 h-3" />
                      </button>
                      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent px-2 py-1">
                        <p className="text-[10px] text-white truncate">{files[i]?.name}</p>
                      </div>
                    </Card>
                  </motion.div>
                ))}
              </div>
            )}

            {error && (
              <Card className="border-red-500/30 bg-red-500/5">
                <CardContent className="p-4">
                  <p className="text-sm text-red-400">{error}</p>
                </CardContent>
              </Card>
            )}

            <Button
              onClick={handleSubmit}
              disabled={!files.length || loading}
              className="gap-2"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Analyzing {files.length} images...
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4" />
                  Analyze {files.length} Image{files.length !== 1 ? "s" : ""}
                </>
              )}
            </Button>
          </div>
        )}

        {result && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-6"
          >
            <div className="grid grid-cols-3 gap-4">
              {[
                { label: "Passed", count: result.summary.passed, color: "text-green-400", bg: "bg-green-500/10", border: "border-green-500/20" },
                { label: "Failed", count: result.summary.failed, color: "text-red-400", bg: "bg-red-500/10", border: "border-red-500/20" },
                { label: "Warnings", count: result.summary.warnings, color: "text-amber-400", bg: "bg-amber-500/10", border: "border-amber-500/20" },
              ].map(({ label, count, color, bg, border }) => (
                <Card key={label} className={`${border} ${bg}`}>
                  <CardContent className="p-5 text-center">
                    <p className={`text-3xl font-bold ${color}`}>{count}</p>
                    <p className={`text-xs mt-1 ${color}`}>{label}</p>
                  </CardContent>
                </Card>
              ))}
            </div>

            <Card>
              <CardContent className="p-0">
                <ScrollArea className="max-h-[600px]">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/30">
                        <th className="text-left px-4 py-3 text-[10px] uppercase tracking-wider text-muted-foreground font-medium">#</th>
                        <th className="text-left px-4 py-3 text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Image</th>
                        <th className="text-left px-4 py-3 text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Verdict</th>
                        <th className="text-left px-4 py-3 text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Issues</th>
                        <th className="text-left px-4 py-3 text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Confidence</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.results.map((r, i) => (
                        <AnimatePresence key={i}>
                          <tr
                            onClick={() => r.violations.length > 0 && toggleRow(i)}
                            className={`border-b border-border/50 transition-colors ${
                              r.violations.length > 0 ? "cursor-pointer hover:bg-accent/30" : ""
                            } ${expandedRows.has(i) ? "bg-accent/20" : ""}`}
                          >
                            <td className="px-4 py-3 text-muted-foreground">{i + 1}</td>
                            <td className="px-4 py-3 font-medium truncate max-w-[200px]">{r.image_name}</td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                {verdictIcon(r.verdict)}
                                <span className={`font-semibold ${verdictColor(r.verdict)}`}>{r.verdict}</span>
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              {r.violations.length > 0 ? (
                                <Badge variant="outline" className="text-red-400 border-red-500/30 text-xs">
                                  {r.violations.length}
                                </Badge>
                              ) : (
                                <span className="text-xs text-green-400">None</span>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                <Progress value={r.confidence} className="w-16 h-1.5" />
                                <span className="text-xs text-muted-foreground">{r.confidence}%</span>
                                {r.violations.length > 0 && (
                                  expandedRows.has(i) ? (
                                    <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" />
                                  ) : (
                                    <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                                  )
                                )}
                              </div>
                            </td>
                          </tr>
                          {expandedRows.has(i) && r.violations.length > 0 && (
                            <tr>
                              <td colSpan={5} className="p-4 bg-muted/10">
                                <div className="space-y-2">
                                  {r.violations.map((v, j) => (
                                    <div
                                      key={j}
                                      className="rounded-lg px-4 py-3 bg-card border border-border/50"
                                    >
                                      <div className="flex items-center gap-2 mb-1">
                                        <code className="text-xs font-mono font-bold text-primary">{v.rule_id}</code>
                                        <Badge variant="outline" className="text-[10px] px-1.5">
                                          {v.severity}
                                        </Badge>
                                      </div>
                                      <p className="text-sm mb-1">{v.issue}</p>
                                      {v.fix_suggestion && (
                                        <p className="text-xs text-green-400/80">Fix: {v.fix_suggestion}</p>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              </td>
                            </tr>
                          )}
                        </AnimatePresence>
                      ))}
                    </tbody>
                  </table>
                </ScrollArea>
              </CardContent>
            </Card>

            <Button variant="outline" onClick={handleReset} className="gap-2">
              <RotateCcw className="w-4 h-4" />
              New Batch
            </Button>
          </motion.div>
        )}
      </div>
    </div>
  );
}
