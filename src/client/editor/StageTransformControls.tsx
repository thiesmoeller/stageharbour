import { useEffect, useRef } from 'react';
import { TransformControls } from '@react-three/drei';
import { Group } from 'three';
import type { StageEditing } from './StageEditing.js';

export function StageTransformControls({ pivot, onTransform, mode, width, snapEnabled }: StageEditing & { mode: 'translate' | 'rotate'; width: number }) {
  const target = useRef<Group>(null!);
  const active = useRef(false);
  const anchor = useRef(pivot);
  if (!active.current) anchor.current = pivot;
  const bypass = useRef(false);
  const latest = useRef({ onTransform, width, mode });
  latest.current = { onTransform, width, mode };
  useEffect(() => {
    const cancel = () => {
      if (!active.current) return;
      active.current = false;
      latest.current.onTransform?.('cancel', { x: 0, y: 0, rotation: 0 }, bypass.current, latest.current.mode);
      if (anchor.current && target.current) { target.current.position.set((latest.current.width - anchor.current.x) / 1000, .04, anchor.current.y / 1000); target.current.rotation.set(0, 0, 0); }
    };
    const key = (event: KeyboardEvent) => {
      bypass.current = event.altKey;
      if (event.key === 'Escape' && active.current) {
        event.preventDefault(); event.stopImmediatePropagation(); cancel();
      }
    };
    window.addEventListener('keydown', key); window.addEventListener('keyup', key);
    window.addEventListener('pointercancel', cancel); window.addEventListener('blur', cancel);
    return () => { cancel(); window.removeEventListener('keydown', key); window.removeEventListener('keyup', key); window.removeEventListener('pointercancel', cancel); window.removeEventListener('blur', cancel); };
  }, []);
  if (!pivot || !onTransform) return null;
  const start = anchor.current ?? pivot;
  const delta = () => ({ x: width - target.current.position.x * 1000 - start.x, y: target.current.position.z * 1000 - start.y, rotation: target.current.rotation.y * 180 / Math.PI });
  return <>
    <group ref={target} position={[(width - start.x) / 1000, .04, start.y / 1000]} />
    <TransformControls object={target} mode={mode} showX={mode === 'translate'} showY={mode === 'rotate'} showZ={mode === 'translate'} size={.85}
      onMouseDown={() => { active.current = true; target.current.rotation.set(0, 0, 0); onTransform('begin', { x: 0, y: 0, rotation: 0 }, bypass.current, mode); }}
      onObjectChange={() => { if (active.current) onTransform('preview', delta(), !snapEnabled || bypass.current, mode); }}
      onMouseUp={() => { if (active.current) { active.current = false; onTransform('commit', delta(), !snapEnabled || bypass.current, mode); target.current.rotation.set(0, 0, 0); } }} />
  </>;
}
