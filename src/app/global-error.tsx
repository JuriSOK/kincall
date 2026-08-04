"use client";

import { useEffect } from "react";

/**
 * The last-resort boundary: it replaces the root layout entirely, so it must
 * render its own <html> and <body>.
 *
 * Styled with inline styles rather than the design system on purpose. This
 * boundary is reached when the root layout itself failed — which can mean the
 * stylesheet or the font never loaded. A recovery screen that depends on the
 * thing that just broke is not a recovery screen, so the colours are inlined
 * (matching ui/tokens.css) and no component is imported.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("KinCall global error", error.digest ?? error.message);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "1.5rem",
          background: "#f5f9fb",
          color: "#172a37",
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif",
        }}
      >
        <main
          style={{
            maxWidth: "32rem",
            width: "100%",
            background: "#ffffff",
            border: "1px solid #dbe7eb",
            borderRadius: "0.75rem",
            padding: "1.75rem",
            boxShadow: "0 1px 3px rgb(16 40 56 / 0.06), 0 6px 16px -6px rgb(16 40 56 / 0.10)",
          }}
        >
          <h1 style={{ fontSize: "1.25rem", margin: "0 0 0.75rem", letterSpacing: "-0.01em" }}>
            KinCall could not load
          </h1>
          <p style={{ margin: "0 0 0.75rem", fontSize: "0.875rem", lineHeight: 1.6 }}>
            The application failed to start in your browser. Nothing has been changed or deleted,
            and any check-in already recorded is unaffected.
          </p>
          <p style={{ margin: "0 0 1.25rem", fontSize: "0.875rem", lineHeight: 1.6, color: "#57707c" }}>
            If reloading does not help, KinCall may be temporarily unavailable. It does not place
            calls while it is unavailable, and it never contacts emergency services.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              font: "inherit",
              fontWeight: 500,
              fontSize: "0.875rem",
              cursor: "pointer",
              padding: "0.5rem 1rem",
              borderRadius: "0.375rem",
              border: "1px solid transparent",
              background: "#0f7a8c",
              color: "#ffffff",
            }}
          >
            Reload KinCall
          </button>
          {error.digest ? (
            <p style={{ marginTop: "1.25rem", fontSize: "0.75rem", color: "#7e929c" }}>
              Reference for the logs:{" "}
              <span style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
                {error.digest}
              </span>
            </p>
          ) : null}
        </main>
      </body>
    </html>
  );
}
