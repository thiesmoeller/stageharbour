import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { builtInFixtureTypes, type BuiltInFixtureTypeId } from '../../shared/hangPlan.js';
import { ToolIcon } from './ToolIcon.js';
import { useModalFocus } from './useModalFocus.js';

const LONG_PRESS_MS = 380;
const FIXTURE_TYPE_IDS = Object.keys(builtInFixtureTypes) as BuiltInFixtureTypeId[];

const TYPE_HINT: Record<BuiltInFixtureTypeId, string> = {
  fresnel: 'Linsen · Flügelblenden',
  flood: 'Fluter · Flügelblenden',
  wash: 'Wash · ohne Flügel',
};

export function HangToolButton({ disabled, active = false, typeId, onPlace, onChooseType }: {
  disabled: boolean;
  active?: boolean;
  typeId: BuiltInFixtureTypeId;
  /** Short click: start placing with the current Gerätetyp. */
  onPlace: () => void;
  /** Long-press / menu: pick a Gerätetyp and start placing. */
  onChooseType: (typeId: BuiltInFixtureTypeId) => void;
}) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState({ top: 0, left: 0 });
  const root = useRef<HTMLDivElement>(null);
  const timer = useRef<number>(0);
  const longPress = useRef(false);
  const close = useCallback(() => setOpen(false), []);
  const dialog = useModalFocus<HTMLDivElement>(open, close);
  const label = builtInFixtureTypes[typeId].label;

  function measure() {
    const box = root.current?.getBoundingClientRect();
    if (!box) return;
    setAnchor({ top: box.top, left: box.right + 10 });
  }

  useLayoutEffect(() => {
    if (!open) return;
    measure();
    function onResize() { measure(); }
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onResize, true);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onResize, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onPointer(event: Event) {
      const target = event.target as Node;
      if (root.current?.contains(target) || dialog.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [open, dialog]);

  function clearTimer() {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = 0;
  }

  function openTypes() {
    longPress.current = true;
    measure();
    setOpen(true);
  }

  function onPointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    if (disabled || event.button !== 0) return;
    longPress.current = false;
    clearTimer();
    event.currentTarget.setPointerCapture(event.pointerId);
    timer.current = window.setTimeout(openTypes, LONG_PRESS_MS);
  }

  function onPointerUp(event: ReactPointerEvent<HTMLButtonElement>) {
    clearTimer();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function onPointerCancel(event: ReactPointerEvent<HTMLButtonElement>) {
    clearTimer();
    longPress.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function onPrimaryClick() {
    if (disabled) return;
    if (longPress.current) {
      longPress.current = false;
      return;
    }
    setOpen(false);
    onPlace();
  }

  function choose(next: BuiltInFixtureTypeId) {
    setOpen(false);
    onChooseType(next);
  }

  return <>
    <div ref={root} className="wall-tool">
      <button type="button" className="quiet wall-tool-primary" disabled={disabled}
        title={`Scheinwerfer setzen · ${label} (lang drücken für Gerätetyp)`}
        aria-label="Scheinwerfer setzen" aria-pressed={active}
        onPointerDown={onPointerDown} onPointerUp={onPointerUp} onPointerCancel={onPointerCancel}
        onClick={onPrimaryClick}
        onContextMenu={event => { event.preventDefault(); if (!disabled) openTypes(); }}>
        <ToolIcon name="plus" /><span>Scheinwerfer</span>
      </button>
      <button type="button" className="quiet wall-tool-menu" disabled={disabled}
        aria-haspopup="dialog" aria-expanded={open}
        title="Gerätetyp wählen" aria-label="Scheinwerfer Gerätetyp wählen"
        onClick={() => { if (disabled) return; if (open) setOpen(false); else openTypes(); }}>
        <span aria-hidden="true">▾</span>
      </button>
    </div>
    {open && createPortal(
      <div ref={dialog} className="wall-type-dialog" role="dialog" aria-modal="true"
        aria-label="Scheinwerfer Gerätetypen" tabIndex={-1}
        style={{ top: anchor.top, left: Math.min(anchor.left, window.innerWidth - 320) }}>
        <header>
          <strong>Gerätetypen</strong>
          <button type="button" className="quiet" aria-label="Schließen" onClick={close}>×</button>
        </header>
        <div className="wall-type-choices" role="menu">
          {FIXTURE_TYPE_IDS.map(id => <button key={id} type="button" role="menuitem" className="quiet" disabled={disabled}
            aria-current={id === typeId ? 'true' : undefined}
            onClick={() => choose(id)}>
            <strong>{builtInFixtureTypes[id].label}</strong>
            <span>{TYPE_HINT[id]}</span>
          </button>)}
        </div>
      </div>,
      document.body,
    )}
  </>;
}
