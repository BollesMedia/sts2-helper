import { cn } from "@/lib/cn";

interface LoadingSkeletonProps {
  className?: string;
}

export function LoadingSkeleton({ className }: LoadingSkeletonProps) {
  return (
    <div
      className={cn(
        "animate-pulse rounded bg-zinc-800",
        className
      )}
    />
  );
}

export function CardSkeleton() {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
      <div className="flex items-start gap-3">
        <LoadingSkeleton className="h-7 w-7 shrink-0" />
        <div className="flex-1 space-y-2">
          <LoadingSkeleton className="h-5 w-32" />
          <LoadingSkeleton className="h-4 w-full" />
          <LoadingSkeleton className="h-4 w-3/4" />
          <LoadingSkeleton className="h-1.5 w-16" />
        </div>
      </div>
    </div>
  );
}
