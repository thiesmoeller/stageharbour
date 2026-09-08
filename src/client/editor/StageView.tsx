import { useLayoutEffect, useMemo, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera } from '@react-three/drei';
import { BoxGeometry, ExtrudeGeometry, Path, Shape } from 'three';
import type { Layout, VenueGeometry } from '../../shared/layout.js';
import { stageModel, type Vec3, type WallSolid } from '../../shared/transforms.js';
import { StageBraceList, StageBraces } from './StageBraces.js';
import { StageLevelList, StageLevels } from './StageLevels.js';
import { StageOverhead, StageOverheadList } from './StageOverhead.js';
import { StagePlaceholderList, StagePlaceholders } from './StagePlaceholders.js';

const plywood = '#315d49';
const timber = '#d9c6a1';
const edge = '#5a6e52';

function facing(normal: { x: number; z: number }) {
  if (Math.abs(normal.x) >= Math.abs(normal.z)) return normal.x >= 0 ? 'zeigt nach rechts' : 'zeigt nach links';
  return normal.z <= 0 ? 'zeigt zum Publikum' : 'zeigt von Publikum weg';
}

/** Keep the camera looking from the audience toward upstage (+Z). Scene is X-mirrored so plan-left stays screen-left. */
function LookFromAudience({ position, target }: { position: Vec3; target: Vec3 }) {
  const { camera } = useThree();
  useLayoutEffect(() => {
    camera.position.set(position.x, position.y, position.z);
    camera.up.set(0, 1, 0);
    camera.lookAt(target.x, target.y, target.z);
    camera.updateProjectionMatrix();
  }, [camera, position.x, position.y, position.z, target.x, target.y, target.z]);
  return null;
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

export function StageView({ layout, venue }: { layout: Layout; venue: VenueGeometry }) {
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
        {audience && <LookFromAudience position={camera} target={target} />}
        <group position={[venue.width / 2, 0, 0]} scale={[-1, 1, 1]}>
          <group position={[-venue.width / 2, 0, 0]}>
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[venue.width / 2, 0, venue.depth / 2]}>
              <planeGeometry args={[venue.width, venue.depth]} />
              <meshBasicMaterial color="#dce4d4" />
            </mesh>
            <StageLevels model={model} />
            <StageOverhead boxes={venue.overheadBoxes ?? []} />
            {model.walls.map(wall => <WallMesh key={wall.id} wall={wall} />)}
            <StageBraces braces={model.braces} />
            <StagePlaceholders placeholders={model.placeholders} />
          </group>
        </group>
        {!audience && <OrbitControls makeDefault enableDamping={false} target={[target.x, target.y, target.z]} />}
      </Canvas>
    </div>
    <p className="muted">{audience
      ? 'Publikumssicht · Blick von vorne auf die Bühne (wie der Pfeil im Grundriss) · links im Grundriss = links hier · Vorderseite dunkel'
      : 'Vorderseite (Sperrholz, dunkel) · Rückseite (Holzrahmen, hell) · Stützen als Dreieckskörper · Ziehen zum Drehen · links/rechts wie im Grundriss'}</p>
    <ul aria-label="Wände in der Raumsicht">{model.walls.map(wall => <li key={wall.id} data-testid={`stage-wall-${wall.id}`}
      data-x={wall.center.x} data-y={wall.center.y} data-z={wall.center.z}
      data-height={wall.size.y} data-width={wall.size.x} data-thickness={wall.size.z}
      data-opening-count={wall.openings.length} data-opening-width={wall.openings[0]?.width ?? ''} data-opening-height={wall.openings[0]?.height ?? ''}>
      {wall.label}: Vorderseite {facing(wall.frontNormal)}</li>)}</ul>
    <StageBraceList braces={model.braces} />
    <StagePlaceholderList placeholders={model.placeholders} />
    <StageLevelList model={model} />
    <StageOverheadList boxes={venue.overheadBoxes ?? []} />
  </div>;
}
