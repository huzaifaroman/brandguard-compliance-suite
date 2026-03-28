"use client";

import { useState, useCallback } from "react";
import { useDropzone } from "react-dropzone";
import { Upload, Loader2, Layers, ChevronDown, ChevronUp } from "lucide-react";
import { batchAnalyze } from "@/lib/api";
import type { BatchResult, BatchImageResult } from "@/lib/types";

const MAX_FILES = 10;

export default function BatchPage() {
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<BatchResult | null>(null);
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const onDrop = useCallback((accepted: File[]) => {
    const combined = [...files, ...accepted].slice(0, MAX_FILES);
    setFiles(combined);
    setPreviews(combined.map((f) => URL.createObjectURL(f)));
    setResult(null);
    setError(null);
  }, [files]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "image/*": [] },
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

  const verdictIcon = (v: string) =>
    v === "PASS" ? "✅" : v === "FAIL" ? "❌" : "⚠️";
  const verdictColor = (v: string) =>
    v === "PASS" ? "#22c55e" : v === "FAIL" ? "#ef4444" : "#f59e0b";

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold" style={{ color: "var(--foreground)" }}>
          Batch Analysis
        </h1>
        <p className="mt-1 text-sm" style={{ color: "var(--muted-foreground)" }}>
          Upload up to {MAX_FILES} images for parallel compliance analysis.
        </p>
      </div>

      {!result && (
        <div className="space-y-5">
          <div
            {...getRootProps()}
            className="rounded-xl p-8 text-center cursor-pointer transition-all duration-200"
            style={{
              border: isDragActive ? "2px solid #3b82f6" : "2px dashed var(--border)",
              background: isDragActive ? "rgba(59, 130, 246, 0.06)" : "var(--card)",
            }}
          >
            <input {...getInputProps()} />
            <div className="space-y-3">
              <div
                className="mx-auto w-12 h-12 rounded-full flex items-center justify-center"
                style={{ background: "rgba(59, 130, 246, 0.1)" }}
              >
                <Layers size={20} style={{ color: "#3b82f6" }} />
              </div>
              <div>
                <p className="text-sm font-medium" style={{ color: "var(--foreground)" }}>
                  Drop images here or click to browse
                </p>
                <p className="text-xs mt-1" style={{ color: "var(--muted-foreground)" }}>
                  Up to {MAX_FILES} images · {files.length}/{MAX_FILES} selected
                </p>
              </div>
            </div>
          </div>

          {previews.length > 0 && (
            <div className="grid grid-cols-5 gap-3">
              {previews.map((src, i) => (
                <div key={i} className="relative group rounded-lg overflow-hidden" style={{ background: "var(--card)", border: "1px solid var(--border)", aspectRatio: "1" }}>
                  <img src={src} alt={files[i]?.name} className="w-full h-full object-cover" />
                  <button
                    onClick={() => removeFile(i)}
                    className="absolute top-1 right-1 rounded-full w-5 h-5 flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                    style={{ background: "rgba(239, 68, 68, 0.9)", color: "#fff" }}
                  >
                    ×
                  </button>
                  <div className="absolute bottom-0 left-0 right-0 px-1.5 py-1 text-xs truncate"
                    style={{ background: "rgba(0,0,0,0.6)", color: "#fff" }}>
                    {files[i]?.name}
                  </div>
                </div>
              ))}
            </div>
          )}

          {error && (
            <div className="rounded-xl px-4 py-3 text-sm" style={{ background: "rgba(239,68,68,0.08)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.2)" }}>
              {error}
            </div>
          )}

          <button
            onClick={handleSubmit}
            disabled={!files.length || loading}
            className="py-3 px-6 rounded-xl text-sm font-medium flex items-center gap-2 transition-all"
            style={{
              background: !files.length || loading ? "var(--muted)" : "#3b82f6",
              color: !files.length || loading ? "var(--muted-foreground)" : "#ffffff",
              cursor: !files.length || loading ? "not-allowed" : "pointer",
            }}
          >
            {loading ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Analyzing {files.length} images in parallel...
              </>
            ) : (
              <>
                <Upload size={16} />
                Analyze {files.length} Image{files.length !== 1 ? "s" : ""}
              </>
            )}
          </button>
        </div>
      )}

      {result && (
        <div className="space-y-6">
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: "Passed", count: result.summary.passed, color: "#22c55e", bg: "rgba(34,197,94,0.1)" },
              { label: "Failed", count: result.summary.failed, color: "#ef4444", bg: "rgba(239,68,68,0.1)" },
              { label: "Warnings", count: result.summary.warnings, color: "#f59e0b", bg: "rgba(245,158,11,0.1)" },
            ].map(({ label, count, color, bg }) => (
              <div
                key={label}
                className="rounded-xl p-5 text-center"
                style={{ background: bg, border: `1px solid ${color}30` }}
              >
                <div className="text-3xl font-bold" style={{ color }}>{count}</div>
                <div className="text-xs mt-1" style={{ color }}>{label}</div>
              </div>
            ))}
          </div>

          <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: "var(--muted)", borderBottom: "1px solid var(--border)" }}>
                  <th className="text-left px-4 py-3 font-medium text-xs uppercase tracking-wide" style={{ color: "var(--muted-foreground)" }}>#</th>
                  <th className="text-left px-4 py-3 font-medium text-xs uppercase tracking-wide" style={{ color: "var(--muted-foreground)" }}>Image</th>
                  <th className="text-left px-4 py-3 font-medium text-xs uppercase tracking-wide" style={{ color: "var(--muted-foreground)" }}>Verdict</th>
                  <th className="text-left px-4 py-3 font-medium text-xs uppercase tracking-wide" style={{ color: "var(--muted-foreground)" }}>Issues</th>
                  <th className="text-left px-4 py-3 font-medium text-xs uppercase tracking-wide" style={{ color: "var(--muted-foreground)" }}>Confidence</th>
                </tr>
              </thead>
              <tbody>
                {result.results.map((r, i) => (
                  <>
                    <tr
                      key={i}
                      onClick={() => toggleRow(i)}
                      className="cursor-pointer transition-colors"
                      style={{ borderBottom: "1px solid var(--border)", background: expandedRows.has(i) ? "rgba(59,130,246,0.05)" : "var(--card)" }}
                    >
                      <td className="px-4 py-3" style={{ color: "var(--muted-foreground)" }}>{i + 1}</td>
                      <td className="px-4 py-3 font-medium" style={{ color: "var(--foreground)" }}>{r.image_name}</td>
                      <td className="px-4 py-3">
                        <span className="font-semibold" style={{ color: verdictColor(r.verdict) }}>
                          {verdictIcon(r.verdict)} {r.verdict}
                        </span>
                      </td>
                      <td className="px-4 py-3" style={{ color: "var(--foreground)" }}>{r.violations.length}</td>
                      <td className="px-4 py-3 flex items-center gap-2">
                        <span style={{ color: "var(--foreground)" }}>{r.confidence.toFixed(0)}%</span>
                        {expandedRows.has(i) ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      </td>
                    </tr>
                    {expandedRows.has(i) && r.violations.length > 0 && (
                      <tr key={`${i}-detail`}>
                        <td colSpan={5} className="px-4 py-4" style={{ background: "rgba(59,130,246,0.03)" }}>
                          <div className="space-y-2">
                            {r.violations.map((v, j) => (
                              <div key={j} className="rounded-lg px-4 py-3" style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.15)" }}>
                                <div className="text-xs font-mono font-bold" style={{ color: "#ef4444" }}>{v.rule_id}</div>
                                <div className="text-sm mt-1" style={{ color: "var(--foreground)" }}>{v.issue}</div>
                                <div className="text-xs mt-1" style={{ color: "#22c55e" }}>Fix: {v.suggestion}</div>
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>

          <button
            onClick={() => { setResult(null); setFiles([]); setPreviews([]); }}
            className="text-sm px-4 py-2 rounded-lg transition-colors"
            style={{ background: "var(--muted)", color: "var(--foreground)" }}
          >
            ← New Batch
          </button>
        </div>
      )}
    </div>
  );
}
