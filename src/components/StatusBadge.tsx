interface StatusBadgeProps {
  label: string;
  state: 'healthy' | 'pending' | 'degraded' | 'failed' | 'neutral';
  live?: boolean;
}

export function StatusBadge({ label, state, live = false }: StatusBadgeProps) {
  return (
    <span className={`health-pill ${state}`} role="status" aria-live={live ? 'polite' : undefined}>
      {label}
    </span>
  );
}
