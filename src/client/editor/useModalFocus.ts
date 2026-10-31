import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(el => el.tabIndex !== -1);
}

/** Focus entry, Tab trap, Escape, and focus return for elements marked aria-modal. */
export function useModalFocus<T extends HTMLElement = HTMLElement>(open: boolean, onClose: () => void): RefObject<T | null> {
  const container = useRef<T | null>(null);
  const previous = useRef<HTMLElement | null>(null);
  // Keep latest onClose without re-running the open effect (parent callbacks often change identity).
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    previous.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const root = container.current;
    if (!root) return;
    // Inert siblings at every ancestor level, including portals outside the app root.
    const siblings: { element: HTMLElement; inert: boolean }[] = [];
    let branch: HTMLElement = root;
    while (branch.parentElement) {
      for (const sibling of branch.parentElement.children) {
        if (sibling !== branch && sibling instanceof HTMLElement) {
          siblings.push({ element: sibling, inert: sibling.inert });
          sibling.inert = true;
        }
      }
      branch = branch.parentElement;
      if (branch === document.body) break;
    }
    const initial = focusables(root)[0] ?? root;
    initial.focus();

    function onKeyDown(event: KeyboardEvent) {
      // Only the topmost dialog handles keys when a workspace opens a confirmation.
      if (root?.getAttribute('aria-modal') === 'true' && [...document.querySelectorAll('[aria-modal="true"]')].at(-1) !== root) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !root) return;
      const items = focusables(root);
      if (!items.length) {
        event.preventDefault();
        root.focus();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !root.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !root.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      for (const { element, inert } of siblings) element.inert = inert;
      previous.current?.focus?.();
    };
  }, [open]);

  return container;
}
