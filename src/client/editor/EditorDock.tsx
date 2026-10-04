import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode, type SetStateAction } from 'react';
import { createPortal } from 'react-dom';
import { ToolIcon } from './ToolIcon.js';

type Panel = 'properties' | 'library' | 'lighting' | 'display';
const labels = { properties: 'Eigenschaften', library: 'Bibliothek', lighting: 'Licht', display: 'Anzeige' };
const icons = { properties: 'tray', library: 'library', lighting: 'light', display: 'settings' } as const;

export function readWorkspacePreference(key: string): string | null {
  try { return localStorage.getItem(`stage-planner.editor.${key}`); } catch { return null; }
}
export function writeWorkspacePreference(key: string, value: string) {
  try { localStorage.setItem(`stage-planner.editor.${key}`, value); } catch { /* Private browsing may disable storage. */ }
}

/** One persistent dock per editor. Hidden panes stay mounted to retain unapplied inputs. */
export function useEditorDock(scope: 'scene' | 'venue') {
  const [active, setActive] = useState<Panel | null>(() => {
    const saved = readWorkspacePreference(`${scope}.panel`);
    return saved && Object.hasOwn(labels, saved) ? saved as Panel : null;
  });
  const [pinned, setPinned] = useState(() => readWorkspacePreference(`${scope}.pinned`) === 'true');
  const [libraryVisited, setLibraryVisited] = useState(active === 'library');
  const [lightingHost, setLightingHost] = useState<HTMLDivElement | null>(null);
  const [propertiesHost, setPropertiesHost] = useState<HTMLDivElement | null>(null);
  const [displayHost, setDisplayHost] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    writeWorkspacePreference(`${scope}.panel`, active ?? 'closed');
    if (active === 'library') setLibraryVisited(true);
  }, [scope, active]);
  useEffect(() => { writeWorkspacePreference(`${scope}.pinned`, String(pinned)); }, [scope, pinned]);
  function setOpen(panel: Panel, value: SetStateAction<boolean>) {
    setActive(current => {
      const next = typeof value === 'function' ? value(current === panel) : value;
      return next ? panel : current === panel ? null : current;
    });
  }
  return { active, setActive, pinned, setPinned, libraryVisited, setOpen,
    lightingHost, setLightingHost, propertiesHost, setPropertiesHost, displayHost, setDisplayHost,
    closeAfterPlacement() { if (!pinned) setActive(null); },
  };
}

type Dock = ReturnType<typeof useEditorDock>;
export const EditorDockContext = createContext<Dock | null>(null);

/** Also works for standalone report previews, which have no editor dock. */
export function DockPortal({ panel, children }: { panel: 'lighting' | 'properties' | 'display'; children: ReactNode }) {
  const dock = useContext(EditorDockContext);
  if (!dock) return <>{children}</>;
  const host = panel === 'lighting' ? dock.lightingHost : panel === 'display' ? dock.displayHost : dock.propertiesHost;
  return host ? createPortal(children, host) : null;
}

export function EditorDock({ dock, properties, library, display, stageVisible, onShowStage }: {
  dock: Dock; properties: ReactNode; library: ReactNode; display: ReactNode;
  stageVisible: boolean; onShowStage: () => void;
}) {
  const id = useId();
  const rail = useRef<HTMLElement>(null);
  function close() {
    const active = dock.active;
    dock.setActive(null);
    rail.current?.querySelector<HTMLButtonElement>(`[data-panel="${active}"]`)?.focus();
  }
  return <>
    <div className="editor-dock" hidden={!dock.active} onKeyDown={event => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        event.preventDefault(); event.stopPropagation(); close();
      }
    }}>
      <div className="dock-heading">
        <h3>{dock.active ? labels[dock.active] : 'Seitenleiste'}</h3>
        <button type="button" className="quiet" aria-label="Seitenleiste anheften" title="Nach dem Platzieren geöffnet lassen"
          aria-pressed={dock.pinned} onClick={() => dock.setPinned(value => !value)}>Anheften</button>
        <button type="button" className="quiet" aria-label="Seitenleiste schließen" onClick={close}>×</button>
      </div>
      <div id={`${id}-properties`} className="dock-pane" role="region" aria-label="Eigenschaften" hidden={dock.active !== 'properties'}>
        {properties}<div ref={dock.setPropertiesHost} />
      </div>
      <div id={`${id}-library`} className="dock-pane" role="region" aria-label="Bibliothek" hidden={dock.active !== 'library'}>
        {(dock.libraryVisited || dock.active === 'library') && library}
      </div>
      <div id={`${id}-lighting`} className="dock-pane" role="region" aria-label="Licht" hidden={dock.active !== 'lighting'}>
        {!stageVisible && <div className="dock-empty"><p>Licht in der Raumansicht einstellen und direkt auf der Bühne prüfen.</p><button type="button" onClick={onShowStage}>Raumansicht öffnen</button></div>}
        <div ref={dock.setLightingHost} />
      </div>
      <div id={`${id}-display`} className="dock-pane" role="region" aria-label="Anzeige" hidden={dock.active !== 'display'}>
        {display}<div ref={dock.setDisplayHost} />
      </div>
    </div>
    <nav ref={rail} className="panel-rail" aria-label="Seitenleisten">
      {(Object.keys(labels) as Panel[]).map(panel => <button key={panel} type="button" className="quiet" data-panel={panel}
        aria-label={labels[panel]} title={labels[panel]} aria-expanded={dock.active === panel} aria-controls={`${id}-${panel}`}
        onClick={() => dock.setOpen(panel, open => !open)}>
        <ToolIcon name={icons[panel]} /><span>{panel === 'properties' ? 'Details' : labels[panel]}</span>
      </button>)}
    </nav>
  </>;
}
