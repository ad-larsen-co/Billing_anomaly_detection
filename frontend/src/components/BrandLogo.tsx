import { useId } from "react";

/** Square mark: gradient + anomaly spike line — use one instance per gradient id via useId. */
export function BrandLogoMark({
  size = 40,
  className,
}: {
  size?: number;
  className?: string;
}) {
  const uid = useId().replace(/:/g, "");
  const gradId = `logo-grad-${uid}`;

  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <defs>
        <linearGradient id={gradId} x1="8" y1="4" x2="36" y2="36" gradientUnits="userSpaceOnUse">
          <stop stopColor="#2563eb" />
          <stop offset="1" stopColor="#1d4ed8" />
        </linearGradient>
      </defs>
      <rect width="40" height="40" rx="11" fill={`url(#${gradId})`} />
      <path
        d="M9 27.5 14 16l5.5 7.5L26 11l5 16.5"
        stroke="white"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={0.95}
      />
      <circle cx="26" cy="11" r="3.2" fill="#fbbf24" stroke="white" strokeWidth="1.2" />
    </svg>
  );
}

export function BrandLogoFull({
  className,
  compact,
}: {
  className?: string;
  /** Tighter spacing for header strip */
  compact?: boolean;
}) {
  return (
    <div className={`flex items-center gap-3 ${className ?? ""}`}>
      <BrandLogoMark size={compact ? 36 : 42} className="shrink-0 shadow-md shadow-blue-500/25" />
      <div className="min-w-0">
        <div className={`font-semibold tracking-tight text-slate-900 ${compact ? "text-[0.95rem] leading-tight" : "text-base leading-tight"}`}>
          Billing Console
        </div>
        {!compact && (
          <p className="mt-0.5 text-sm leading-snug text-slate-500">Anomaly detection &amp; RAG</p>
        )}
      </div>
    </div>
  );
}

const navIconClass = "h-5 w-5 shrink-0 opacity-90";

/** Small icons for primary navigation (sidebar + optional pills). */
export function NavSectionIcon({
  id,
  className,
}: {
  id: "overview" | "anomalies" | "evidence" | "assistant";
  className?: string;
}) {
  const c = className ?? navIconClass;
  switch (id) {
    case "overview":
      return (
        <svg className={c} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} aria-hidden>
          <rect x="3" y="3" width="7" height="9" rx="1.5" />
          <rect x="14" y="3" width="7" height="5" rx="1.5" />
          <rect x="14" y="12" width="7" height="9" rx="1.5" />
          <rect x="3" y="16" width="7" height="5" rx="1.5" />
        </svg>
      );
    case "anomalies":
      return (
        <svg className={c} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} aria-hidden>
          <path d="M12 9v4M12 17h.01" strokeLinecap="round" />
          <path d="M10.3 3.3h3.4l8.4 14.5a1 1 0 0 1-.86 1.5H2.76a1 1 0 0 1-.86-1.5L10.3 3.3Z" strokeLinejoin="round" />
        </svg>
      );
    case "evidence":
      return (
        <svg className={c} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} aria-hidden>
          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" strokeLinecap="round" />
          <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" strokeLinejoin="round" />
          <path d="M8 7h8M8 11h8" strokeLinecap="round" />
        </svg>
      );
    case "assistant":
      return (
        <svg className={c} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} aria-hidden>
          <path d="M21 15a4 4 0 0 1-4 4H8l-4 3v-3.5A4 4 0 0 1 4 7h13a4 4 0 0 1 4 4v4Z" strokeLinejoin="round" />
        </svg>
      );
    default:
      return null;
  }
}
