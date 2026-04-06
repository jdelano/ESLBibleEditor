import React from "react";

export function Panel(props: React.HTMLAttributes<HTMLDivElement>) {
  return <div {...props} />;
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 style={{ margin: "0 0 0.75rem", fontSize: "0.95rem", textTransform: "uppercase", letterSpacing: "0.08em" }}>{children}</h3>;
}

export function Field(props: React.HTMLAttributes<HTMLLabelElement>) {
  return <label style={{ display: "grid", gap: "0.35rem", marginBottom: "0.75rem" }} {...props} />;
}

export function Button(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...props} />;
}
