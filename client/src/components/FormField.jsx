export function FormField({ label, htmlFor, error, hint, required = false, children, className = '' }) {
  return (
    <div className={`space-y-1 ${className}`}>
      {label ? (
        <label htmlFor={htmlFor} className="block text-xs font-medium text-ink-secondary">
          {label}
          {required ? <span className="ml-0.5 text-accent">*</span> : null}
        </label>
      ) : null}
      {children}
      {error ? (
        <p className="text-xs" style={{ color: 'var(--st-danger-fg)' }}>
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-ink-muted">{hint}</p>
      ) : null}
    </div>
  );
}
