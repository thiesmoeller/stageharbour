import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import {
  GROUP_WALL_TYPE_KINDS, GROUP_WALL_TYPE_NAMES, groupWallType, groupWallTypeSizeLabel, type GroupWallTypeKind,
} from '../../shared/inventory.js';
import type { WallElementType } from '../../shared/wall-types.js';
import { ToolIcon } from './ToolIcon.js';

const LONG_PRESS_MS = 380;

export function WallToolButton({ disabled, sceneTypes, onAddPlain, onAddType }: {
  disabled: boolean;
  sceneTypes: WallElementType[];
  onAddPlain: () => void;
  onAddType: (type: WallElementType) => void;
}) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState({ top: 0, left: 0 });
  const button = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const timer = useRef<number>(0);
  const longPress = useRef(false);

  function measure() {
    const box = button.current?.getBoundingClientRect();
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
    function close(event: Event) {
      const target = event.target as Node;
      if (button.current?.contains(target) || dialog.current?.contains(target)) return;
      setOpen(false);
    }
    function onKey(event: KeyboardEvent) { if (event.key === 'Escape') setOpen(false); }
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', onKey); };
  }, [open]);

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
    if (disabled || event.button !== 0) return;
    if (longPress.current) return;
    setOpen(false);
    onAddPlain();
  }

  function onPointerCancel(event: ReactPointerEvent<HTMLButtonElement>) {
    clearTimer();
    longPress.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function chooseTemplate(kind: GroupWallTypeKind) {
    setOpen(false);
    onAddType(groupWallType(kind, crypto.randomUUID(), crypto.randomUUID()));
  }

  function chooseSceneType(type: WallElementType) {
    setOpen(false);
    onAddType(type);
  }

  const custom = sceneTypes.filter(type => !(GROUP_WALL_TYPE_KINDS as readonly string[]).some(kind => GROUP_WALL_TYPE_NAMES[kind as GroupWallTypeKind] === type.name));

  return <>
    <div className="wall-tool">
      <button ref={button} type="button" className="quiet" disabled={disabled} aria-haspopup="dialog" aria-expanded={open}
        title="Wand hinzufügen · Lang drücken für Wandtypen" aria-label="Wand hinzufügen"
        onPointerDown={onPointerDown} onPointerUp={onPointerUp} onPointerCancel={onPointerCancel}
        onContextMenu={event => { event.preventDefault(); if (!disabled) openTypes(); }}>
        <ToolIcon name="wall" /><span>Wand</span>
      </button>
    </div>
    {open && createPortal(
      <div ref={dialog} className="wall-type-dialog" role="dialog" aria-label="Wandtypen"
        style={{ top: anchor.top, left: Math.min(anchor.left, window.innerWidth - 320) }}>
        <header>
          <strong>Wandtypen</strong>
          <button type="button" className="quiet" aria-label="Schließen" onClick={() => setOpen(false)}>×</button>
        </header>
        <div className="wall-type-choices" role="menu">
          {GROUP_WALL_TYPE_KINDS.map(kind => <button key={kind} type="button" role="menuitem" className="quiet" disabled={disabled}
            title={groupWallTypeSizeLabel(kind)} onClick={() => chooseTemplate(kind)}>
            <strong>{GROUP_WALL_TYPE_NAMES[kind]}</strong>
            <span>{kind === 'half' ? '600×2400' : kind === 'arch' ? 'Bogen' : kind === 'doorLeft' ? 'Tür L' : kind === 'doorRight' ? 'Tür R' : kind === 'window' ? 'Fenster' : 'Glatt'}</span>
          </button>)}
          {custom.map(type => <button key={type.id} type="button" role="menuitem" className="quiet" disabled={disabled}
            title={`${type.width}×${type.height}×${type.thickness} mm`} onClick={() => chooseSceneType(type)}>
            <strong>{type.name}</strong>
            <span>Szene</span>
          </button>)}
        </div>
      </div>,
      document.body,
    )}
  </>;
}
