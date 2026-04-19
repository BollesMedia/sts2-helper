interface SwapBadgeProps {
  reason: string | null;
}

export function SwapBadge({ reason }: SwapBadgeProps) {
  return (
    <span
      title={reason ?? "server-side swap"}
      className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border text-amber-400 bg-amber-500/10 border-amber-500/25"
    >
      ↻ Swapped
    </span>
  );
}
