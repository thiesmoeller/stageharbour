import { useLayoutEffect, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import { OrthographicCamera, PerspectiveCamera } from '@react-three/drei';
import type { Camera } from 'three';

export type StageCameraView = 'orbit' | 'audience' | 'top' | 'front' | 'side';
export function StageCamera({ view, position, target, span }: { view: StageCameraView; position: [number, number, number]; target: [number, number, number]; span: number }) {
  const ref = useRef<Camera>(null!);
  const { width, height } = useThree(state => state.size);
  useLayoutEffect(() => {
    const camera = ref.current;
    if (!camera) return;
    if (view === 'orbit') {
      const distance = span * .7 / (Math.tan(20 * Math.PI / 180) * Math.min(1, width / Math.max(1, height)));
      camera.position.set(position[0] - target[0], position[1] - target[1], position[2] - target[2]).normalize().multiplyScalar(distance);
      camera.position.x += target[0]; camera.position.y += target[1]; camera.position.z += target[2];
    }
    camera.up.set(0, view === 'top' ? 0 : 1, view === 'top' ? 1 : 0);
    camera.lookAt(...target);
  }, [view, span, width, height, ...position, ...target]);
  const common = { makeDefault: true, near: .01, far: 1000, position };
  return view === 'orbit' || view === 'audience'
    ? <PerspectiveCamera {...common} ref={ref as React.RefObject<import('three').PerspectiveCamera>} fov={40} />
    : <OrthographicCamera {...common} ref={ref as React.RefObject<import('three').OrthographicCamera>} zoom={Math.min(width, height) / Math.max(1, span * 1.3)} />;
}
