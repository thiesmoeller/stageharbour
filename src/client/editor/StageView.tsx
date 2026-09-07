import { useLayoutEffect, useMemo, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera } from '@react-three/drei';
import { BoxGeometry, ExtrudeGeometry, Path, Shape } from 'three';
import type { Layout } from '../../shared/layout.js';
import { stageModel, type WallSolid } from '../../shared/transforms.js';
import { StageBraceList, StageBraces } from './StageBraces.js';

const plywood = '#315d49';
const timber = '#d9c6a1';
const edge = '#5a6e52';

function facing(normal: { x: number; z: number }) {
  if (Math.abs(normal.x) >= Math.abs(normal.z)) return normal.x >= 0 ? 'zeigt nach rechts' : 'zeigt nach links';
  return normal.z <= 0 ? 'zeigt zum Publikum' : 'zeigt von Publikum weg';
}

function wallGeometry(wall: WallSolid) {
  if (!wall.openings.length) return new BoxGeometry(wall.size.x, wall.size.y, wall.size.z);
  const shape = new Shape();
  const hw = wall.size.x / 2, hh = wall.size.y / 2;
  shape.moveTo(-hw, -hh); shape.lineTo(hw, -hh); shape.lineTo(hw, hh); shape.lineTo(-hw, hh); shape.closePath();
  for (const opening of wall.openings) {
    const hole = new Path();
    const x0 = -hw + opening.left, y0 = -hh + opening.sill;
    hole.moveTo(x0, y0); hole.lineTo(x0, y0 + opening.height); hole.lineTo(x0 + opening.width, y0 + opening.height); hole.lineTo(x0 + opening.width, y0); hole.closePath();
    shape.holes.push(hole);
  }
  const geometry = new ExtrudeGeometry(shape, { depth: wall.size.z, bevelEnabled: false, steps: 1 });
  geometry.translate(0, 0, -wall.size.z / 2);
  return geometry;
}

function WallMesh({ wall }: { wall: WallSolid }) {
  const geometry = useMemo(() => wall.openings.length ? wallGeometry(wall) : null, [wall]);
  useLayoutEffect(() => () => { geometry?.dispose(); }, [geometry]);
  if (!geometry) {
    return <mesh position={[wall.center.x, wall.center.y, wall.center.z]} rotation={[0, wall.rotationY, 0]}>
      <boxGeometry args={[wall.size.x, wall.size.y, wall.size.z]} />
      <meshBasicMaterial attach="material-0" color={edge} />
      <meshBasicMaterial attach="material-1" color={edge} />
      <meshBasicMaterial attach="material-2" color={edge} />
      <meshBasicMaterial attach="material-3" color={edge} />
      <meshBasicMaterial attach="material-4" color={timber} />
      <meshBasicMaterial attach="material-5" color={plywood} />
    </mesh>;
  }
  return <mesh geometry={geometry} position={[wall.center.x, wall.center.y, wall.center.z]} rotation={[0, wall.rotationY, 0]}>
    <meshBasicMaterial attach="material-0" color={edge} />
    <meshBasicMaterial attach="material-1" color={plywood} />
    <meshBasicMaterial attach="material-2" color={timber} />
  </mesh>;
}

export function StageView({ layout, venue }: { layout: Layout; venue: { width: number; depth: number } }) {
  const model = stageModel(layout, venue);
  const [audience, setAudience] = useState(false);
  const camera = audience ? model.audience.position : { x: model.orbitTarget.x, y: 5500, z: -venue.depth * 0.35 };
  const target = audience ? model.audience.target : model.orbitTarget;
  return <div className="stage-view" data-testid="stage-view" data-view={audience ? 'audience' : 'orbit'}>
    <div className="stage-toolbar"><h3>Raumsicht</h3>
      <button type="button" className="quiet" onClick={() => setAudience(true)}>Publikumssicht</button>
      <button type="button" className="quiet" onClick={() => setAudience(false)}>Umlaufansicht</button></div>
    <div className="stage-canvas" role="img" aria-label="Raumsicht der Spielstätte">
      <Canvas key={audience ? 'audience' : 'orbit'} gl={{ antialias: true, alpha: false }} dpr={[1, 2]}>
        <color attach="background" args={['#eef2e8']} />
        <PerspectiveCamera makeDefault fov={40} near={10} far={250000} position={[camera.x, camera.y, camera.z]} />
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[venue.width / 2, 0, venue.depth / 2]}>
          <planeGeometry args={[venue.width, venue.depth]} />
          <meshBasicMaterial color="#dce4d4" />
        </mesh>
        {model.walls.map(wall => <WallMesh key={wall.id} wall={wall} />)}
        <StageBraces braces={model.braces} />
        <OrbitControls makeDefault enableDamping={false} target={[target.x, target.y, target.z]} />
      </Canvas>
    </div>
    <p className="muted">Vorderseite (Sperrholz, dunkel) · Rückseite (Holzrahmen, hell) · Stützen als Dreieckskörper · Ziehen zum Drehen</p>
    <ul aria-label="Wände in der Raumsicht">{model.walls.map(wall => <li key={wall.id} data-testid={`stage-wall-${wall.id}`}
      data-x={wall.center.x} data-y={wall.center.y} data-z={wall.center.z}
      data-height={wall.size.y} data-width={wall.size.x} data-thickness={wall.size.z}
      data-opening-count={wall.openings.length} data-opening-width={wall.openings[0]?.width ?? ''} data-opening-height={wall.openings[0]?.height ?? ''}>
      {wall.label}: Vorderseite {facing(wall.frontNormal)}</li>)}</ul>
    <StageBraceList braces={model.braces} />
  </div>;
}
