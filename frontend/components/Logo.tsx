/**
 * Tote Logo Component
 *
 * The vesica mark paired with the wordmark. See VesicaGlyph.tsx for the
 * mark itself.
 */

import React from "react";
import { VesicaGlyph } from "./VesicaGlyph";

export type LogoVariant = "full" | "mark" | "wordmark";
export type LogoSize = "sm" | "md" | "lg";

interface LogoProps {
  variant?: LogoVariant;
  size?: LogoSize;
  className?: string;
}

const sizeMap = {
  sm: 32,
  md: 40,
  lg: 52,
};

export function Logo({ variant = "full", size = "md", className = "" }: LogoProps) {
  const markSize = sizeMap[size];

  const Wordmark = () => (
    <div className="leading-none">
      <span className="font-display font-semibold text-foreground" style={{ fontSize: "1.5rem", letterSpacing: "0.005em" }}>
        Tote
      </span>
      <div className="mt-1 font-mono text-[0.62rem] text-ink-faint" style={{ letterSpacing: "0.09em" }}>
        VERIFIABLE PARI-MUTUEL MARKETS
      </div>
    </div>
  );

  if (variant === "mark") {
    return <div className={`inline-flex items-center ${className}`}><VesicaGlyph size={markSize} /></div>;
  }
  if (variant === "wordmark") {
    return <div className={`inline-flex items-center ${className}`}><Wordmark /></div>;
  }
  return (
    <div className={`inline-flex items-center gap-3 ${className}`}>
      <VesicaGlyph size={markSize} />
      <Wordmark />
    </div>
  );
}

export function LogoFull(props: Omit<LogoProps, "variant">) {
  return <Logo {...props} variant="full" />;
}

export function LogoMark(props: Omit<LogoProps, "variant">) {
  return <Logo {...props} variant="mark" />;
}

export function LogoWordmark(props: Omit<LogoProps, "variant">) {
  return <Logo {...props} variant="wordmark" />;
}
