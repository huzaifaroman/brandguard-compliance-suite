"use client";

import { useState, useCallback, useEffect } from "react";
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
  Download,
  FileText,
  CheckCircle2,
} from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip } from "recharts";
import { batchAnalyze } from "@/lib/api";
import type { BatchResult } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";

const MAX_FILES = 10;
const DONUT_COLORS = { passed: "#22c55e", failed: "#ef4444", warnings: "#f59e0b" };

export default function BatchPage() {
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<BatchResult | null>(null);
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [batchProgress, setBatchProgress] = useState(0);

  const onDrop = useCallback(
    (accepted: File[]) => {
      previews.forEach((url) => URL.revokeObjectURL(url));
      const combined = [...files, ...accepted].slice(0, MAX_FILES);
      setFiles(combined);
      setPreviews(combined.map((f) => URL.createObjectURL(f)));
      setResult(null);
      setError(null);
    },
    [files, previews]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "image/*": [".png", ".jpg", ".jpeg", ".webp"] },
    maxFiles: MAX_FILES,
  });

  const removeFile = (i: number) => {
    URL.revokeObjectURL(previews[i]);
    setFiles((prev) => prev.filter((_, idx) => idx !== i));
    setPreviews((prev) => prev.filter((_, idx) => idx !== i));
  };

  useEffect(() => {
    return () => { previews.forEach((url) => URL.revokeObjectURL(url)); };
  }, []);

  useEffect(() => {
    if (!loading) { setBatchProgress(0); return; }
    setBatchProgress(5);
    const interval = setInterval(() => {
      setBatchProgress((prev) => Math.min(prev + Math.random() * 8, 92));
    }, 800);
    return () => clearInterval(interval);
  }, [loading]);

  const handleSubmit = async () => {
    if (!files.length) return;
    setLoading(true);
    setError(null);
    try {
      const res = await batchAnalyze(files);
      setBatchProgress(100);
      await new Promise((r) => setTimeout(r, 400));
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
    previews.forEach((p) => URL.revokeObjectURL(p));
    setResult(null);
    setFiles([]);
    setPreviews([]);
    setExpandedRows(new Set());
  };

  const exportCSV = () => {
    if (!result) return;
    const headers = ["Image", "Verdict", "Confidence", "Violations", "Rule IDs", "Issues"];
    const rows = result.results.map((r) => [
      r.image_name,
      r.verdict,
      String(r.confidence),
      String(r.violations.length),
      r.violations.map((v) => v.rule_id).join("; "),
      r.violations.map((v) => v.issue).join("; "),
    ]);
    const csv = [headers, ...rows].map((row) => row.map((c) => `"${c.replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `compliance-batch-${result.batch_id.slice(0, 8)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportPDF = async () => {
    if (!result) return;
    const { jsPDF } = await import("jspdf");
    const doc = new jsPDF();
    doc.setFontSize(18);
    doc.text("Compliance Batch Report", 14, 20);
    doc.setFontSize(10);
    doc.text(`Batch ID: ${result.batch_id}`, 14, 30);
    doc.text(`Total: ${result.total_images} | Passed: ${result.summary.passed} | Failed: ${result.summary.failed} | Warnings: ${result.summary.warnings}`, 14, 38);

    let y = 50;
    result.results.forEach((r, i) => {
      if (y > 260) { doc.addPage(); y = 20; }
      doc.setFontSize(12);
      doc.text(`${i + 1}. ${r.image_name} — ${r.verdict} (${r.confidence}%)`, 14, y);
      y += 8;
      if (r.violations.length > 0) {
        doc.setFontSize(9);
        r.violations.forEach((v) => {
          if (y > 270) { doc.addPage(); y = 20; }
          doc.text(`  [${v.rule_id}] ${v.severity}: ${v.issue}`, 18, y);
          y += 6;
          if (v.fix_suggestion) {
            doc.text(`    Fix: ${v.fix_suggestion}`, 22, y);
            y += 6;
          }
        });
      }
      y += 4;
    });
    doc.save(`compliance-batch-${result.batch_id.slice(0, 8)}.pdf`);
  };

  const verdictIcon = (v: string) => {
    if (v === "PASS") return <ShieldCheck className="w-4 h-4 text-green-400" />;
    if (v === "FAIL") return <ShieldAlert className="w-4 h-4 text-red-400" />;
    return <ShieldQuestion className="w-4 h-4 text-amber-400" />;
  };

  const verdictColor = (v: string) =>
    v === "PASS" ? "text-green-400" : v === "FAIL" ? "text-red-400" : "text-amber-400";

  const donutData = result
    ? [
        { name: "Passed", value: result.summary.passed, color: DONUT_COLORS.passed },
        { name: "Failed", value: result.summary.failed, color: DONUT_COLORS.failed },
        { name: "Warnings", value: result.summary.warnings, color: DONUT_COLORS.warnings },
      ].filter((d) => d.value > 0)
    : [];

  return (
    <div className="min-h-screen p-6 lg:p-8">
      <div className="max-w-6xl mx-auto">
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
          <div className="flex items-center gap-3 mb-1">
            <div className="p-2 rounded-xl bg-primary/10 animate-glow-pulse">
              <Layers className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight gradient-text">Batch Analysis</h1>
              <p className="text-sm text-muted-foreground">
                Upload up to {MAX_FILES} images for parallel compliance checking
              </p>
            </div>
          </div>
        </motion.div>

        <AnimatePresence mode="wait">
          {!result ? (
            <motion.div
              key="upload"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-5"
            >
              <Card className="overflow-hidden card-hover">
                <CardContent className="p-0">
                  <div
                    {...getRootProps()}
                    className={`p-10 text-center cursor-pointer transition-all duration-300 ${
                      isDragActive ? "bg-primary/5 ring-2 ring-primary/30" : ""
                    }`}
                  >
                    <input {...getInputProps()} />
                    <motion.div
                      animate={isDragActive ? { scale: 1.1, y: -5 } : { scale: 1, y: 0 }}
                      transition={{ type: "spring", stiffness: 400, damping: 20 }}
                      className="inline-flex p-4 rounded-2xl bg-primary/5 mb-4"
                    >
                      <Layers className="w-8 h-8 text-primary/50" />
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

              <AnimatePresence>
                {previews.length > 0 && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="grid grid-cols-5 gap-3"
                  >
                    {previews.map((src, i) => (
                      <motion.div
                        key={i}
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.8 }}
                        transition={{ delay: i * 0.05 }}
                        className="relative group"
                      >
                        <Card className="overflow-hidden aspect-square card-hover">
                          <img
                            src={src}
                            alt={files[i]?.name}
                            className="w-full h-full object-cover"
                          />
                          <button
                            onClick={(e) => { e.stopPropagation(); removeFile(i); }}
                            className="absolute top-1.5 right-1.5 rounded-full w-5 h-5 flex items-center justify-center bg-black/70 text-white opacity-0 group-hover:opacity-100 transition-all duration-200 hover:bg-red-500/80"
                          >
                            <X className="w-3 h-3" />
                          </button>
                          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent px-2 py-1">
                            <p className="text-[10px] text-white truncate">{files[i]?.name}</p>
                          </div>
                          {loading && (
                            <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                              <Loader2 className="w-5 h-5 text-white animate-spin" />
                            </div>
                          )}
                        </Card>
                      </motion.div>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>

              <AnimatePresence>
                {loading && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                  >
                    <Card className="border-primary/20">
                      <CardContent className="p-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Loader2 className="w-4 h-4 text-primary animate-spin" />
                            <p className="text-sm font-medium">Analyzing {files.length} images...</p>
                          </div>
                          <span className="text-xs font-mono text-primary">{Math.round(batchProgress)}%</span>
                        </div>
                        <Progress value={batchProgress} className="h-1.5" />
                      </CardContent>
                    </Card>
                  </motion.div>
                )}
              </AnimatePresence>

              <AnimatePresence>
                {error && (
                  <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                    <Card className="border-red-500/30 bg-red-500/5">
                      <CardContent className="p-4 flex items-center justify-between">
                        <p className="text-sm text-red-400">{error}</p>
                        <Button variant="ghost" size="sm" onClick={handleSubmit} className="text-red-400 h-7 text-xs gap-1.5">
                          <RotateCcw className="w-3 h-3" /> Retry
                        </Button>
                      </CardContent>
                    </Card>
                  </motion.div>
                )}
              </AnimatePresence>

              <Button
                onClick={handleSubmit}
                disabled={!files.length || loading}
                className="gap-2 btn-glow"
              >
                {loading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Upload className="w-4 h-4" />
                )}
                {loading ? `Analyzing ${files.length} images...` : `Analyze ${files.length} Image${files.length !== 1 ? "s" : ""}`}
              </Button>
            </motion.div>
          ) : (
            <motion.div
              key="results"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
              className="space-y-6"
            >
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.1 }}>
                  <Card className="md:row-span-1">
                    <CardContent className="p-4 flex items-center justify-center">
                      <div className="w-[140px] h-[140px] relative">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie data={donutData} cx="50%" cy="50%" innerRadius={40} outerRadius={60} paddingAngle={3} dataKey="value" strokeWidth={0}>
                              {donutData.map((entry, idx) => (
                                <Cell key={idx} fill={entry.color} />
                              ))}
                            </Pie>
                            <RechartsTooltip
                              contentStyle={{ background: "rgba(23,23,30,0.95)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", fontSize: "12px" }}
                              itemStyle={{ color: "#e5e5e5" }}
                            />
                          </PieChart>
                        </ResponsiveContainer>
                        <div className="absolute inset-0 flex items-center justify-center">
                          <div className="text-center">
                            <p className="text-xl font-bold">{result.total_images}</p>
                            <p className="text-[10px] text-muted-foreground">images</p>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
                {[
                  { label: "Passed", count: result.summary.passed, color: "text-green-400", bg: "bg-green-500/10", border: "border-green-500/20", icon: ShieldCheck },
                  { label: "Failed", count: result.summary.failed, color: "text-red-400", bg: "bg-red-500/10", border: "border-red-500/20", icon: ShieldAlert },
                  { label: "Warnings", count: result.summary.warnings, color: "text-amber-400", bg: "bg-amber-500/10", border: "border-amber-500/20", icon: ShieldQuestion },
                ].map(({ label, count, color, bg, border, icon: Icon }, idx) => (
                  <motion.div
                    key={label}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2 + idx * 0.1 }}
                  >
                    <Card className={`${border} ${bg} card-hover`}>
                      <CardContent className="p-5 text-center flex flex-col items-center justify-center h-full gap-1">
                        <Icon className={`w-5 h-5 ${color} mb-1`} />
                        <p className={`text-3xl font-bold tabular-nums ${color}`}>{count}</p>
                        <p className={`text-xs ${color}`}>{label}</p>
                      </CardContent>
                    </Card>
                  </motion.div>
                ))}
              </div>

              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5 }}
              >
                <Card>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm">Results</CardTitle>
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" onClick={exportCSV} className="gap-1.5 h-8 text-xs">
                          <Download className="w-3.5 h-3.5" /> CSV
                        </Button>
                        <Button variant="outline" size="sm" onClick={exportPDF} className="gap-1.5 h-8 text-xs">
                          <FileText className="w-3.5 h-3.5" /> PDF
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
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
                              <motion.tr
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: 0.6 + i * 0.05 }}
                                role={r.violations.length > 0 ? "button" : undefined}
                                tabIndex={r.violations.length > 0 ? 0 : undefined}
                                aria-expanded={r.violations.length > 0 ? expandedRows.has(i) : undefined}
                                onClick={() => r.violations.length > 0 && toggleRow(i)}
                                onKeyDown={(e: React.KeyboardEvent) => {
                                  if (r.violations.length > 0 && (e.key === "Enter" || e.key === " ")) {
                                    e.preventDefault();
                                    toggleRow(i);
                                  }
                                }}
                                className={`border-b border-border/50 transition-colors duration-200 ${
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
                                    <span className="text-xs text-green-400 flex items-center gap-1">
                                      <CheckCircle2 className="w-3 h-3" /> None
                                    </span>
                                  )}
                                </td>
                                <td className="px-4 py-3">
                                  <div className="flex items-center gap-2">
                                    <Progress value={r.confidence} className="w-16 h-1.5" />
                                    <span className="text-xs text-muted-foreground tabular-nums">{r.confidence}%</span>
                                    {r.violations.length > 0 && (
                                      <motion.div animate={{ rotate: expandedRows.has(i) ? 180 : 0 }} transition={{ duration: 0.2 }}>
                                        <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                                      </motion.div>
                                    )}
                                  </div>
                                </td>
                              </motion.tr>
                              {expandedRows.has(i) && r.violations.length > 0 && (
                                <tr>
                                  <td colSpan={5} className="p-4 bg-muted/10">
                                    <motion.div
                                      initial={{ opacity: 0, height: 0 }}
                                      animate={{ opacity: 1, height: "auto" }}
                                      transition={{ duration: 0.3 }}
                                      className="space-y-2"
                                    >
                                      {r.violations.map((v, j) => (
                                        <motion.div
                                          key={j}
                                          initial={{ opacity: 0, x: -10 }}
                                          animate={{ opacity: 1, x: 0 }}
                                          transition={{ delay: j * 0.05 }}
                                          className="rounded-lg px-4 py-3 bg-card border border-border/50"
                                        >
                                          <div className="flex items-center gap-2 mb-1">
                                            <code className="text-xs font-mono font-bold text-primary">{v.rule_id}</code>
                                            <Badge variant="outline" className={`text-[10px] px-1.5 ${
                                              v.severity === "critical" ? "text-red-400 border-red-500/30"
                                              : v.severity === "high" ? "text-orange-400 border-orange-500/30"
                                              : "text-yellow-400 border-yellow-500/30"
                                            }`}>
                                              {v.severity}
                                            </Badge>
                                          </div>
                                          <p className="text-sm mb-1">{v.issue}</p>
                                          {v.evidence && (
                                            <p className="text-xs text-muted-foreground mb-1">
                                              <span className="font-medium">Evidence:</span> {v.evidence}
                                            </p>
                                          )}
                                          {v.fix_suggestion && (
                                            <p className="text-xs text-green-400/80">Fix: {v.fix_suggestion}</p>
                                          )}
                                        </motion.div>
                                      ))}
                                    </motion.div>
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
              </motion.div>

              <Button variant="outline" onClick={handleReset} className="gap-2">
                <RotateCcw className="w-4 h-4" />
                New Batch
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
