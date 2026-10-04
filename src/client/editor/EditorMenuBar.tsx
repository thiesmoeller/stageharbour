import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** Both document editors use the application menu slot, including in fullscreen. */
export function EditorMenuBar({ children }: { children: ReactNode }) {
  const [fullscreen, setFullscreen] = useState(!!document.fullscreenElement);
  useEffect(() => {
    const sync = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);
  const menu = <nav className="editor-menubar" aria-label="Editor-Menüs">{children}</nav>;
  const slot = !fullscreen && document.getElementById('editor-menu-slot');
  return slot ? createPortal(menu, slot) : <div className="editor-local-menubar">{menu}</div>;
}
