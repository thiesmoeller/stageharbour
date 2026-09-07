import { useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera } from '@react-three/drei';
import type { Layout } from '../../shared/layout.js';
import { stageModel, type WallSolid } from '../../shared/transforms.js';

const plywood = '#315d49';
const timber = '#d9c6a1';
const edge = '#5a6e52';

function facing(normal: { x: number; z: number }) {
  if (Math.abs(normal.x) >= Math.abs(normal.z)) return normal.x >= 0 ? 'zeigt nach rechts' : 'zeigt nach links';
  return normal.z <= 0 ? 'zeigt zum Publikum' : 'zeigt von Publikum weg';
}

function WallMesh({ wall }: { wall: WallSolid }) {
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
        <OrbitControls makeDefault enableDamping={false} target={[target.x, target.y, target.z]} />
      </Canvas>
    </div>
    <p className="muted">Vorderseite (Sperrholz, dunkel) · Rückseite (Holzrahmen, hell) · Ziehen zum Drehen</p>
    <ul aria-label="Wände in der Raumsicht">{model.walls.map(wall => <li key={wall.id} data-testid={`stage-wall-${wall.id}`}
      data-x={wall.center.x} data-y={wall.center.y} data-z={wall.center.z}
      data-height={wall.size.y} data-width={wall.size.x} data-thickness={wall.size.z}>
      {wall.label}: Vorderseite {facing(wall.frontNormal)}</li>)}</ul>
  </div>;
}
