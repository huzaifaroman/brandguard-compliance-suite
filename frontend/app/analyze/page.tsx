"use client";

import { useState, useCallback } from "react";
import { useDropzone } from "react-dropzone";
import { Upload, Loader2, ImageIcon } from "lucide-react";
import { analyzeImage } from "@/lib/api";
import type { ComplianceResult } from "@/lib/types";

export default function AnalyzePage() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ComplianceResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onDrop = useCallback((accepted: File[]) => {
    const f = accepted[0];
    if (!f) return;
    setFile(f);
    setPreview(URL.createObjectURL(f));
    setResult(null);
    setError(null);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "image/*": [] },
    maxFiles: 1,
  });

  const handleSubmit = async () => {
    if (!file) return;
    setLoading(true);
    setError(null);
    try {
      const res = await analyzeImage(file, prompt || undefined);
      setResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Analysis failed");
    } finally {
      setLoading(false);
    }
  };

  const verdictColors = {
    PASS: { bg: "rgba(34, 197, 94, 0.12)", border: "rgba(34, 197, 94, 0.3)", text: "#22c55e" },
    FAIL: { bg: "rgba(239, 68, 68, 0.12)", border: "rgba(239, 68, 68, 0.3)", text: "#ef4444" },
    WARNING: { bg: "rgba(245, 158, 11, 0.12)", border: "rgba(245, 158, 11, 0.3)", text: "#f59e0b" },
  };

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold" style={{ color: "var(--foreground)" }}>
          Analyze Image
        </h1>
        <p className="mt-1 text-sm" style={{ color: "var(--muted-foreground)" }}>
          Upload a marketing image to check it against brand compliance rules.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-4">
          <div
            {...getRootProps()}
            className="rounded-xl p-8 text-center cursor-pointer transition-all duration-200"
            style={{
              border: isDragActive
                ? "2px solid #3b82f6"
                : "2px dashed var(--border)",
              background: isDragActive ? "rgba(59, 130, 246, 0.06)" : "var(--card)",
              boxShadow: isDragActive ? "0 0 20px rgba(59, 130, 246, 0.15)" : "none",
            }}
          >
            <input {...getInputProps()} />
            {preview ? (
              <div className="space-y-3">
                <img
                  src={preview}
                  alt="Preview"
                  className="max-h-48 mx-auto rounded-lg object-contain"
                />
                <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>
                  {file?.name}
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                <div
                  className="mx-auto w-12 h-12 rounded-full flex items-center justify-center"
                  style={{ background: "rgba(59, 130, 246, 0.1)" }}
                >
                  <Upload size={20} style={{ color: "#3b82f6" }} />
                </div>
                <div>
                  <p className="text-sm font-medium" style={{ color: "var(--foreground)" }}>
                    Drop image here or click to browse
                  </p>
                  <p className="text-xs mt-1" style={{ color: "var(--muted-foreground)" }}>
                    PNG, JPG, WEBP supported
                  </p>
                </div>
              </div>
            )}
          </div>

          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Optional: Add context or specific questions about this image..."
            className="w-full rounded-xl px-4 py-3 text-sm resize-none outline-none transition-all"
            rows={3}
            style={{
              background: "var(--card)",
              border: "1px solid var(--border)",
              color: "var(--foreground)",
            }}
          />

          <button
            onClick={handleSubmit}
            disabled={!file || loading}
            className="w-full py-3 px-6 rounded-xl text-sm font-medium flex items-center justify-center gap-2 transition-all duration-200"
            style={{
              background: !file || loading ? "var(--muted)" : "#3b82f6",
              color: !file || loading ? "var(--muted-foreground)" : "#ffffff",
              cursor: !file || loading ? "not-allowed" : "pointer",
            }}
          >
            {loading ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Analyzing...
              </>
            ) : (
              <>
                <ImageIcon size={16} />
                Run Compliance Check
              </>
            )}
          </button>

          {error && (
            <div
              className="rounded-xl px-4 py-3 text-sm"
              style={{ background: "rgba(239, 68, 68, 0.08)", color: "#ef4444", border: "1px solid rgba(239, 68, 68, 0.2)" }}
            >
              {error}
            </div>
          )}
        </div>

        <div>
          {result ? (
            <div
              className="rounded-xl p-6 space-y-5"
              style={{ background: "var(--card)", border: "1px solid var(--border)" }}
            >
              <div
                className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-bold"
                style={verdictColors[result.verdict]}
              >
                <span>
                  {result.verdict === "PASS" ? "✓" : result.verdict === "FAIL" ? "✗" : "⚠"}
                </span>
                {result.verdict}
                <span className="font-normal opacity-80">
                  · {result.confidence.toFixed(0)}% confidence
                </span>
              </div>

              {result.summary && (
                <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>
                  {result.summary}
                </p>
              )}

              <div className="text-xs font-medium" style={{ color: "var(--muted-foreground)" }}>
                {result.checks_passed} checks passed · {result.violations.length} violation{result.violations.length !== 1 ? "s" : ""}
              </div>

              {result.violations.length > 0 && (
                <div className="space-y-3">
                  <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--muted-foreground)" }}>
                    Violations
                  </div>
                  {result.violations.map((v, i) => (
                    <div
                      key={i}
                      className="rounded-lg p-4 space-y-2"
                      style={{
                        background: "rgba(239, 68, 68, 0.06)",
                        border: "1px solid rgba(239, 68, 68, 0.15)",
                      }}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono font-bold" style={{ color: "#ef4444" }}>
                          {v.rule_id}
                        </span>
                        <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: "rgba(239, 68, 68, 0.1)", color: "#ef4444" }}>
                          {v.severity}
                        </span>
                      </div>
                      <p className="text-sm" style={{ color: "var(--foreground)" }}>{v.issue}</p>
                      <p className="text-xs" style={{ color: "#22c55e" }}>
                        Fix: {v.suggestion}
                      </p>
                    </div>
                  ))}
                </div>
              )}

              {result.cached && (
                <div className="text-xs" style={{ color: "var(--muted-foreground)" }}>
                  ⚡ Returned from cache — result is consistent
                </div>
              )}
            </div>
          ) : (
            <div
              className="rounded-xl p-8 text-center h-full flex flex-col items-center justify-center"
              style={{ background: "var(--card)", border: "1px solid var(--border)", minHeight: 300 }}
            >
              <div
                className="w-12 h-12 rounded-full flex items-center justify-center mb-3"
                style={{ background: "var(--muted)" }}
              >
                <ImageIcon size={20} style={{ color: "var(--muted-foreground)" }} />
              </div>
              <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>
                Upload an image and run a compliance check to see results here.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
