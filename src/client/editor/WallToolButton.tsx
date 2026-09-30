import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import {
  GROUP_WALL_TYPE_KINDS, GROUP_WALL_TYPE_NAMES, groupWallType, groupWallTypeSizeLabel, type GroupWallTypeKind,
} from '../../shared/inventory.js';
import type { WallElementType } from '../../shared/wall-types.js';
import { ToolIcon } from './ToolIcon.js';
import { useModalFocus } from './useModalFocus.js';

const LONG_PRESS_MS = 380;

export function WallToolButton({ disabled, sceneTypes, onAddPlain, onAddType }: {
  disabled: boolean;
  sceneTypes: WallElementType[];
  onAddPlain: () => void;
  onAddType: (type: WallElementType) => void;
}) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState({ top: 0, left: 0 });
  const root = useRef<HTMLDivElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const timer = useRef<number>(0);
  const longPress = useRef(false);
  const close = useCallback(() => setOpen(false), []);
  const dialog = useModalFocus<HTMLDivElement>(open, close);

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

  /** Primary click adds a plain wall; long-press still opens types as a convenience. */
  function onPrimaryClick() {
    if (disabled) return;
    if (longPress.current) {
      longPress.current = false;
      return;
    }
    setOpen(false);
    onAddPlain();
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
    <div ref={root} className="wall-tool">
      <button type="button" className="quiet wall-tool-primary" disabled={disabled}
        title="Wand hinzufügen" aria-label="Wand hinzufügen"
        onPointerDown={onPointerDown} onPointerUp={onPointerUp} onPointerCancel={onPointerCancel}
        onClick={onPrimaryClick}
        onContextMenu={event => { event.preventDefault(); if (!disabled) openTypes(); }}>
        <ToolIcon name="wall" /><span>Wand</span>
      </button>
      <button ref={menuButton} type="button" className="quiet wall-tool-menu" disabled={disabled}
        aria-haspopup="dialog" aria-expanded={open}
        title="Wandtypen wählen" aria-label="Wandtypen wählen"
        onClick={() => { if (disabled) return; if (open) setOpen(false); else openTypes(); }}>
        <span aria-hidden="true">▾</span>
      </button>
    </div>
    {open && createPortal(
      <div ref={dialog} className="wall-type-dialog" role="dialog" aria-modal="true"
        aria-label="Wandtypen" tabIndex={-1}
        style={{ top: anchor.top, left: Math.min(anchor.left, window.innerWidth - 320) }}>
        <header>
          <strong>Wandtypen</strong>
          <button type="button" className="quiet" aria-label="Schließen" onClick={close}>×</button>
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
            <span>Bühnenbild</span>
          </button>)}
        </div>
      </div>,
      document.body,
    )}
  </>;
}
