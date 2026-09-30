import { useEffect, useRef, type ReactNode } from 'react';

/** A disclosure of ordinary buttons: Tab navigation, Escape and outside dismissal. */
export function EditorMenu({ label, children, className = '' }: { label: ReactNode; children: ReactNode; className?: string }) {
  const root = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    function outside(event: PointerEvent) {
      if (root.current && !root.current.contains(event.target as Node)) root.current.open = false;
    }
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, []);
  return <details ref={root} className={`editor-menu ${className}`} onKeyDown={event => {
    if (event.key === 'Escape' && root.current?.open) {
      event.preventDefault(); event.stopPropagation();
      root.current.open = false;
      root.current.querySelector('summary')?.focus();
    }
  }} onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false;
  }}>
    <summary>{label}</summary>
    <div className="editor-menu-panel" onClick={event => {
      if ((event.target as HTMLElement).closest('button:not([data-keep-open])') && root.current) {
        root.current.open = false;
        root.current.querySelector('summary')?.focus();
      }
    }}>{children}</div>
  </details>;
}
