"use client";

import { useEffect } from "react";

export default function ExtErrorFilter() {
  useEffect(() => {
    const handleError = (e: ErrorEvent) => {
      const src = e.filename || "";
      const msg = e.message || "";
      if (
        src.includes("webkit-masked-url") ||
        src.includes("extension") ||
        msg.includes("fixinatorInputs") ||
        msg.includes("webkit-masked-url")
      ) {
        e.stopImmediatePropagation();
        e.preventDefault();
      }
    };

    const handleRejection = (e: PromiseRejectionEvent) => {
      const r = e.reason;
      if (r && typeof r === "object" && r.stack && r.stack.includes("webkit-masked-url")) {
        e.stopImmediatePropagation();
        e.preventDefault();
      }
    };

    window.addEventListener("error", handleError, true);
    window.addEventListener("unhandledrejection", handleRejection, true);

    return () => {
      window.removeEventListener("error", handleError, true);
      window.removeEventListener("unhandledrejection", handleRejection, true);
    };
  }, []);

  return null;
}
