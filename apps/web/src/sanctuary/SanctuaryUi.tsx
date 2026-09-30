import { ArrowLeftIcon } from "lucide-react";
import type { ReactNode } from "react";

import { readLocalApi } from "../localApi";
import { cn } from "../lib/utils";

export const glassTile =
  "rounded-2xl border border-white/10 bg-white/[0.045] shadow-[inset_0_1px_0_rgb(255_255_255/0.05)]";

export const fieldClass =
  "rounded-lg border border-white/12 bg-black/20 px-3 py-2 text-sm text-white placeholder:text-white/35 outline-none transition-colors focus:border-white/35";

export function SanctuaryButton({
  children,
  onClick,
  tone = "quiet",
  disabled,
  type = "button",
  className,
  label,
}: {
  children: ReactNode;
  onClick?: () => void;
  tone?: "quiet" | "solid" | "danger";
  disabled?: boolean;
  type?: "button" | "submit";
  className?: string;
  /** Accessible name for icon-only buttons. */
  label?: string;
}) {
  return (
    <button
      type={type}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex h-8 items-center justify-center gap-1.5 rounded-lg px-3 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40",
        tone === "solid" && "bg-white text-[#2b2450] hover:bg-white/90",
        tone === "quiet" && "border border-white/12 text-white/85 hover:bg-white/10",
        tone === "danger" && "text-white/50 hover:bg-white/10 hover:text-white",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 mt-8 flex items-center justify-between first:mt-0">
      <h3 className="text-xs font-medium uppercase tracking-[0.18em] text-white/55">{children}</h3>
      {action}
    </div>
  );
}

export function EmptyNote({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-sm text-white/50">{children}</p>;
}

/** A card opened into the glass: back to the cards, a title, then the view. */
export function SanctuaryDetail({
  title,
  onBack,
  actions,
  children,
}: {
  title: string;
  onBack: () => void;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-3 px-8 pt-6 pb-4">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-sm text-white/70 transition-colors hover:bg-white/10 hover:text-white"
        >
          <ArrowLeftIcon className="size-4" />
          Sanctuary
        </button>
        <h2 className="text-lg font-medium text-white">{title}</h2>
        <div className="ml-auto flex items-center gap-2">{actions}</div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-8">{children}</div>
    </div>
  );
}

export function openExternal(url: string) {
  const api = readLocalApi();
  if (api) {
    void api.shell.openExternal(url);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

const currency = new Intl.NumberFormat(undefined, {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export const formatMoney = (value: number) => currency.format(value);

export function friendlyDay(date: string, today: string): string {
  if (date === today) return "Today";
  const [year, month, day] = date.split("-").map(Number);
  const value = new Date(year!, month! - 1, day!);
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (
    value.getFullYear() === yesterday.getFullYear() &&
    value.getMonth() === yesterday.getMonth() &&
    value.getDate() === yesterday.getDate()
  ) {
    return "Yesterday";
  }
  return value.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
}
