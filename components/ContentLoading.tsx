export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden="true" className={`rounded-md bg-muted motion-safe:animate-pulse ${className}`} />;
}

export function ContentLoading({ label, rows = 2, cards = false }: { label: string; rows?: number; cards?: boolean }) {
  return (
    <div role="status" className={cards ? "grid gap-3 lg:grid-cols-2" : "grid gap-3"}>
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="adt-panel grid gap-3" aria-hidden="true">
          <Skeleton className="h-4 w-2/5" />
          <Skeleton className="h-3 w-4/5" />
          <Skeleton className="h-3 w-3/5" />
        </div>
      ))}
    </div>
  );
}
