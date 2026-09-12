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
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      bypass.current = event.altKey;
      if (event.key === 'Escape' && active.current) {
        active.current = false;
        onTransform?.('cancel', { x: 0, y: 0, rotation: 0 }, bypass.current);
        if (anchor.current) { target.current.position.set((width - anchor.current.x) / 1000, .04, anchor.current.y / 1000); target.current.rotation.set(0, 0, 0); }
      }
    };
    window.addEventListener('keydown', key); window.addEventListener('keyup', key);
    return () => { window.removeEventListener('keydown', key); window.removeEventListener('keyup', key); };
  }, [onTransform, pivot, width]);
  if (!pivot || !onTransform) return null;
  const start = anchor.current ?? pivot;
  const delta = () => ({ x: width - target.current.position.x * 1000 - start.x, y: target.current.position.z * 1000 - start.y, rotation: target.current.rotation.y * 180 / Math.PI });
  return <>
    <group ref={target} position={[(width - start.x) / 1000, .04, start.y / 1000]} />
    <TransformControls object={target} mode={mode} showX={mode === 'translate'} showY={mode === 'rotate'} showZ={mode === 'translate'} size={.85}
      onMouseDown={() => { active.current = true; target.current.rotation.set(0, 0, 0); onTransform('begin', { x: 0, y: 0, rotation: 0 }, bypass.current); }}
      onObjectChange={() => { if (active.current) onTransform('preview', delta(), !snapEnabled || bypass.current); }}
      onMouseUp={() => { if (active.current) { active.current = false; onTransform('commit', delta(), !snapEnabled || bypass.current); target.current.rotation.set(0, 0, 0); } }} />
  </>;
}
