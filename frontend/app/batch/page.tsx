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
  Cloud,
  ScanEye,
  Brain,
  Scan,
  FileCheck,
  ScanLine,
  ImagePlus,
  CircleSlash,
  ExternalLink,
  AlertTriangle,
} from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip } from "recharts";
import { batchAnalyze } from "@/lib/api";
import type { BatchResult } from "@/lib/types";
import { getFriendlyName } from "@/lib/rule-names";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";

const MAX_FILES = 10;
const DONUT_COLORS = { passed: "#22c55e", failed: "#ef4444", warnings: "#f59e0b" };

const batchPipelineSteps = [
  { icon: Cloud, label: "Uploading", sublabel: "Cloud storage" },
  { icon: ScanEye, label: "Vision Analysis", sublabel: "Reading elements" },
  { icon: Brain, label: "Rule Evaluation", sublabel: "Checking compliance" },
  { icon: Scan, label: "Cross-Validation", sublabel: "Verifying results" },
  { icon: FileCheck, label: "Building Report", sublabel: "Final results" },
];

export default function BatchPage() {
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<BatchResult | null>(null);
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [batchProgress, setBatchProgress] = useState(0);
  const [activeStep, setActiveStep] = useState(0);

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
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const imageFiles: File[] = [];
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith("image/")) {
          const blob = items[i].getAsFile();
          if (blob) {
            const ext = blob.type.split("/")[1] || "png";
            imageFiles.push(new File([blob], `pasted-image-${Date.now()}-${i}.${ext}`, { type: blob.type }));
          }
        }
      }
      if (imageFiles.length > 0) {
        e.preventDefault();
        onDrop(imageFiles);
      }
    };
    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [onDrop]);

  const stepMap: Record<string, number> = {
    uploading: 0, vision: 1, evaluating: 2, cross_validation: 3, building_report: 4, done: 4,
  };

  const handleSubmit = async () => {
    if (!files.length) return;
    setLoading(true);
    setError(null);
    setBatchProgress(5);
    setActiveStep(0);
    try {
      const res = await batchAnalyze(files, (completed, total, step) => {
        const pct = Math.max(5, Math.min(95, (completed / total) * 90 + 5));
        setBatchProgress(pct);
        setActiveStep(stepMap[step] ?? 1);
      });
      setBatchProgress(100);
      setActiveStep(batchPipelineSteps.length - 1);
      await new Promise((r) => setTimeout(r, 400));
      setResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Batch analysis failed");
    } finally {
      setLoading(false);
      setBatchProgress(0);
      setActiveStep(0);
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
    const headers = ["Image", "Verdict", "Confidence", "Violations", "Checks", "Issues"];
    const rows = result.results.map((r) => [
      r.image_name,
      r.verdict,
      String(r.confidence),
      String(r.violations.length),
      r.violations.map((v) => getFriendlyName(v.rule_id)).join("; "),
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
          doc.text(`  ${getFriendlyName(v.rule_id)} (${v.severity}): ${v.issue}`, 18, y);
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
              <Card className="overflow-hidden card-hover border-dashed border-2 border-border/50 hover:border-primary/30 transition-colors duration-300">
                <CardContent className="p-0">
                  <div
                    {...getRootProps()}
                    className={`p-12 text-center cursor-pointer transition-all duration-300 ${
                      isDragActive ? "bg-primary/5 ring-2 ring-primary/30 border-primary/50" : ""
                    }`}
                  >
                    <input {...getInputProps()} />
                    <motion.div
                      animate={isDragActive ? { scale: 1.15, y: -8 } : { scale: 1, y: 0 }}
                      transition={{ type: "spring", stiffness: 400, damping: 20 }}
                      className="inline-flex p-5 rounded-2xl bg-primary/5 mb-5"
                    >
                      <ImagePlus className="w-9 h-9 text-primary/50" />
                    </motion.div>
                    <p className="text-sm font-medium mb-1.5">
                      {isDragActive ? "Release to add images" : "Drop images, click to browse, or paste"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      PNG, JPG, WEBP up to 20MB — Ctrl+V / ⌘V to paste from clipboard
                    </p>
                    <div className="mt-3 inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-muted/30 border border-border/30">
                      <span className="text-[11px] font-medium text-muted-foreground tabular-nums">{files.length}/{MAX_FILES}</span>
                      <span className="text-[11px] text-muted-foreground/60">selected</span>
                    </div>
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
                        <Card className="overflow-hidden aspect-square card-hover border-border/50">
                          <img
                            src={src}
                            alt={files[i]?.name}
                            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                          />
                          {!loading && (
                            <button
                              onClick={(e) => { e.stopPropagation(); removeFile(i); }}
                              className="absolute top-1.5 right-1.5 rounded-full w-6 h-6 flex items-center justify-center bg-black/70 backdrop-blur-sm text-white opacity-0 group-hover:opacity-100 transition-all duration-200 hover:bg-red-500/90 hover:scale-110"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          )}
                          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent px-2.5 py-2">
                            <p className="text-[10px] text-white/90 truncate font-medium">{files[i]?.name}</p>
                          </div>
                          {loading && (
                            <div className="absolute inset-0 bg-black/50 backdrop-blur-[1px] flex flex-col items-center justify-center gap-2">
                              <div className="relative w-8 h-8">
                                <motion.div
                                  className="absolute inset-0 rounded-full border-2 border-transparent border-t-primary"
                                  animate={{ rotate: 360 }}
                                  transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
                                />
                                <ScanLine className="w-4 h-4 text-primary absolute inset-0 m-auto" />
                              </div>
                              <span className="text-[10px] text-white/70 font-medium tracking-wider uppercase">Scanning</span>
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
                    <Card className="border-primary/20 overflow-hidden">
                      <CardContent className="p-5 space-y-4">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2.5">
                            <div className="relative w-5 h-5">
                              <motion.div
                                className="absolute inset-0 rounded-full border-2 border-transparent border-t-primary"
                                animate={{ rotate: 360 }}
                                transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
                              />
                              <ScanLine className="w-3.5 h-3.5 text-primary absolute inset-0 m-auto" />
                            </div>
                            <p className="text-sm font-medium">
                              Analyzing {files.length} image{files.length !== 1 ? "s" : ""}
                            </p>
                          </div>
                          <span className="text-xs font-mono text-primary tabular-nums">{Math.round(batchProgress)}%</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-muted/50 overflow-hidden">
                          <motion.div
                            className="h-full bg-primary rounded-full"
                            initial={{ width: 0 }}
                            animate={{ width: `${batchProgress}%` }}
                            transition={{ duration: 0.5, ease: "easeOut" }}
                          />
                        </div>
                        <div className="grid grid-cols-5 gap-1.5">
                          {batchPipelineSteps.map((step, i) => {
                            const Icon = step.icon;
                            const isActive = i === activeStep;
                            const isDone = i < activeStep || batchProgress === 100;
                            return (
                              <motion.div
                                key={i}
                                initial={{ opacity: 0, y: 8 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: i * 0.08, duration: 0.3 }}
                                className={`flex flex-col items-center gap-1.5 rounded-xl p-2.5 transition-all duration-500 ${
                                  isActive
                                    ? "bg-primary/10 ring-1 ring-primary/30 shadow-lg shadow-primary/10"
                                    : isDone
                                    ? "bg-green-500/5 ring-1 ring-green-500/20"
                                    : "bg-muted/30 opacity-40"
                                }`}
                              >
                                <div className="relative flex items-center justify-center w-8 h-8">
                                  {isActive && (
                                    <motion.div
                                      className="absolute inset-0 rounded-full border-2 border-transparent border-t-primary"
                                      animate={{ rotate: 360 }}
                                      transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
                                    />
                                  )}
                                  {isDone && (
                                    <motion.div
                                      className="absolute inset-0 rounded-full bg-green-500/10"
                                      initial={{ scale: 0 }}
                                      animate={{ scale: 1 }}
                                      transition={{ type: "spring", stiffness: 500, damping: 25 }}
                                    />
                                  )}
                                  <motion.div
                                    animate={isActive ? { scale: [1, 1.1, 1] } : { scale: 1 }}
                                    transition={isActive ? { repeat: Infinity, duration: 2, ease: "easeInOut" } : {}}
                                  >
                                    <Icon className={`w-4 h-4 relative z-10 ${
                                      isActive ? "text-primary" : isDone ? "text-green-500" : "text-muted-foreground"
                                    }`} />
                                  </motion.div>
                                  {isDone && (
                                    <motion.div
                                      initial={{ scale: 0 }}
                                      animate={{ scale: 1 }}
                                      className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-green-500 flex items-center justify-center z-20"
                                    >
                                      <CheckCircle2 className="w-2.5 h-2.5 text-white" />
                                    </motion.div>
                                  )}
                                </div>
                                <div className="text-center">
                                  <p className={`text-[11px] font-medium leading-tight ${
                                    isActive ? "text-primary" : isDone ? "text-green-500" : "text-muted-foreground"
                                  }`}>{step.label}</p>
                                  <p className="text-[9px] text-muted-foreground mt-0.5">{step.sublabel}</p>
                                </div>
                              </motion.div>
                            );
                          })}
                        </div>
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

              <div className="flex justify-end">
                <Button
                  onClick={handleSubmit}
                  disabled={!files.length || loading}
                  size="lg"
                  className="gap-2.5 btn-glow px-6 h-11 text-sm font-semibold"
                >
                  {loading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <ScanLine className="w-4 h-4" />
                  )}
                  {loading ? `Analyzing ${files.length} image${files.length !== 1 ? "s" : ""}...` : `Review ${files.length} Image${files.length !== 1 ? "s" : ""}`}
                </Button>
              </div>
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
                className="space-y-4"
              >
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-foreground/80">Detailed Results</h2>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={exportCSV} className="gap-1.5 h-8 text-xs">
                      <Download className="w-3.5 h-3.5" /> CSV
                    </Button>
                    <Button variant="outline" size="sm" onClick={exportPDF} className="gap-1.5 h-8 text-xs">
                      <FileText className="w-3.5 h-3.5" /> PDF
                    </Button>
                  </div>
                </div>

                {result.results.map((r, i) => {
                  const isExpanded = expandedRows.has(i);
                  const VerdictIcon = r.verdict === "PASS" ? ShieldCheck : r.verdict === "FAIL" ? ShieldAlert : ShieldQuestion;
                  const borderColor = r.verdict === "PASS" ? "border-green-500/20" : r.verdict === "FAIL" ? "border-red-500/20" : "border-amber-500/20";
                  const iconColor = r.verdict === "PASS" ? "text-green-400" : r.verdict === "FAIL" ? "text-red-400" : "text-amber-400";
                  const passedCount = r.passed_details?.filter((p) => p.status === "passed").length || 0;
                  const naCount = r.passed_details?.filter((p) => p.status === "not_applicable").length || 0;

                  return (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, y: 15 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.5 + i * 0.08 }}
                    >
                      <Card className={`overflow-hidden card-hover ${borderColor}`}>
                        <div
                          className="flex items-stretch cursor-pointer hover:bg-accent/20 transition-colors"
                          onClick={() => toggleRow(i)}
                        >
                          {r.image_url && (
                            <div className="w-[140px] min-h-[100px] shrink-0 relative bg-muted/30 border-r border-border/30">
                              <img
                                src={r.image_url}
                                alt={r.image_name}
                                className="w-full h-full object-cover"
                              />
                            </div>
                          )}
                          <div className="flex-1 p-4 flex items-center">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2.5 mb-1.5">
                                <VerdictIcon className={`w-5 h-5 ${iconColor} shrink-0`} />
                                <h3 className="text-sm font-semibold truncate">{r.image_name}</h3>
                              </div>
                              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                                <span className={`font-semibold ${iconColor}`}>
                                  {r.verdict === "PASS" ? "Compliant" : r.verdict === "FAIL" ? "Non-Compliant" : "Needs Review"}
                                </span>
                                <span className="flex items-center gap-1">
                                  <AlertTriangle className="w-3 h-3 text-red-400" />
                                  {r.violations.length} violation{r.violations.length !== 1 ? "s" : ""}
                                </span>
                                <span className="flex items-center gap-1">
                                  <CheckCircle2 className="w-3 h-3 text-green-400" />
                                  {passedCount} passed
                                </span>
                                {naCount > 0 && (
                                  <span className="flex items-center gap-1">
                                    <CircleSlash className="w-3 h-3 text-muted-foreground" />
                                    {naCount} N/A
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-3 shrink-0 ml-4">
                              <div className="text-right">
                                <p className="text-lg font-bold tabular-nums text-foreground">{r.confidence}%</p>
                                <p className="text-[10px] text-muted-foreground">confidence</p>
                              </div>
                              {r.session_id && (
                                <a
                                  href={`/report/${r.session_id}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  className="p-1.5 rounded-lg hover:bg-primary/10 transition-colors"
                                  title="Open full report"
                                >
                                  <ExternalLink className="w-4 h-4 text-primary" />
                                </a>
                              )}
                              <motion.div
                                animate={{ rotate: isExpanded ? 180 : 0 }}
                                transition={{ duration: 0.2 }}
                              >
                                <ChevronDown className="w-4 h-4 text-muted-foreground" />
                              </motion.div>
                            </div>
                          </div>
                        </div>

                        <AnimatePresence>
                          {isExpanded && (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: "auto", opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              transition={{ duration: 0.3 }}
                              className="overflow-hidden"
                            >
                              <div className="border-t border-border/30 p-4 space-y-4">
                                <div className="grid grid-cols-1 lg:grid-cols-[200px,1fr] gap-4">
                                  {r.image_url && (
                                    <div className="rounded-xl overflow-hidden border border-border/30 bg-muted/20">
                                      <img
                                        src={r.image_url}
                                        alt={r.image_name}
                                        className="w-full h-auto object-contain max-h-[300px]"
                                      />
                                    </div>
                                  )}

                                  <div className="space-y-3">
                                    {r.violations.length > 0 && (
                                      <div>
                                        <h4 className="text-xs font-semibold text-red-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                                          <ShieldAlert className="w-3.5 h-3.5" />
                                          Violations ({r.violations.length})
                                        </h4>
                                        <div className="space-y-2">
                                          {r.violations.map((v, j) => (
                                            <motion.div
                                              key={j}
                                              initial={{ opacity: 0, x: -10 }}
                                              animate={{ opacity: 1, x: 0 }}
                                              transition={{ delay: j * 0.04 }}
                                              className="rounded-lg px-3.5 py-2.5 bg-red-500/5 border border-red-500/15"
                                            >
                                              <div className="flex items-center gap-2 mb-1">
                                                <span className="text-[13px] font-semibold text-foreground">{getFriendlyName(v.rule_id)}</span>
                                                <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${
                                                  v.severity === "critical" ? "text-red-400 border-red-500/30"
                                                  : v.severity === "high" ? "text-orange-400 border-orange-500/30"
                                                  : "text-yellow-400 border-yellow-500/30"
                                                }`}>
                                                  {v.severity}
                                                </Badge>
                                              </div>
                                              <p className="text-[13px] text-foreground/80 mb-1">{v.issue}</p>
                                              {v.evidence && (
                                                <p className="text-xs text-muted-foreground mb-1">
                                                  <span className="font-medium">Evidence:</span> {v.evidence}
                                                </p>
                                              )}
                                              {v.fix_suggestion && (
                                                <p className="text-xs text-green-400/80 flex items-center gap-1">
                                                  <CheckCircle2 className="w-3 h-3 shrink-0" />
                                                  {v.fix_suggestion}
                                                </p>
                                              )}
                                            </motion.div>
                                          ))}
                                        </div>
                                      </div>
                                    )}

                                    {passedCount > 0 && (
                                      <details className="group">
                                        <summary className="text-xs font-semibold text-green-400 uppercase tracking-wider cursor-pointer flex items-center gap-1.5 mb-1">
                                          <ShieldCheck className="w-3.5 h-3.5" />
                                          Passed ({passedCount})
                                          <ChevronDown className="w-3 h-3 ml-auto transition-transform group-open:rotate-180" />
                                        </summary>
                                        <div className="mt-2 space-y-1">
                                          {r.passed_details?.filter((p) => p.status === "passed").map((p, j) => (
                                            <div key={j} className="flex items-start gap-2 px-3 py-1.5 rounded-md bg-green-500/5 border border-green-500/10">
                                              <CheckCircle2 className="w-3 h-3 text-green-500 mt-0.5 shrink-0" />
                                              <div>
                                                <span className="text-[12px] font-medium text-foreground/80">{getFriendlyName(p.rule_id)}</span>
                                                {p.detail && <p className="text-[11px] text-muted-foreground">{p.detail}</p>}
                                              </div>
                                            </div>
                                          ))}
                                        </div>
                                      </details>
                                    )}

                                    {naCount > 0 && (
                                      <details className="group">
                                        <summary className="text-xs font-semibold text-muted-foreground uppercase tracking-wider cursor-pointer flex items-center gap-1.5 mb-1">
                                          <CircleSlash className="w-3.5 h-3.5" />
                                          Not Applicable ({naCount})
                                          <ChevronDown className="w-3 h-3 ml-auto transition-transform group-open:rotate-180" />
                                        </summary>
                                        <div className="mt-2 space-y-1">
                                          {r.passed_details?.filter((p) => p.status === "not_applicable").map((p, j) => (
                                            <div key={j} className="flex items-start gap-2 px-3 py-1.5 rounded-md bg-muted/20 border border-border/20">
                                              <CircleSlash className="w-3 h-3 text-muted-foreground mt-0.5 shrink-0" />
                                              <div>
                                                <span className="text-[12px] font-medium text-foreground/60">{getFriendlyName(p.rule_id)}</span>
                                                {p.detail && <p className="text-[11px] text-muted-foreground">{p.detail}</p>}
                                              </div>
                                            </div>
                                          ))}
                                        </div>
                                      </details>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </Card>
                    </motion.div>
                  );
                })}
              </motion.div>

              <div className="flex justify-between">
                <Button variant="outline" onClick={handleReset} className="gap-2">
                  <RotateCcw className="w-4 h-4" />
                  New Batch
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
