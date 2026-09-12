// A self-contained 1 m cube, without network resources or decoder dependencies.
export function cubeGlb(uri?: string): Buffer {
  const positions = new Float32Array([
    -0.5, 0, -0.5, 0.5, 0, -0.5, 0.5, 1, -0.5, -0.5, 1, -0.5,
    -0.5, 0, 0.5, 0.5, 0, 0.5, 0.5, 1, 0.5, -0.5, 1, 0.5,
  ]);
  const indices = new Uint16Array([0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 4, 7, 0, 7, 3, 1, 2, 6, 1, 6, 5, 3, 7, 6, 3, 6, 2, 0, 1, 5, 0, 5, 4]);
  const binary = Buffer.concat([Buffer.from(positions.buffer), Buffer.from(indices.buffer)]);
  const manifest = JSON.stringify({ asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] }],
    materials: [{ pbrMetallicRoughness: { baseColorFactor: [0.7, 0.3, 0.1, 1], metallicFactor: 0, roughnessFactor: 0.9 } }],
    buffers: [{ byteLength: binary.length, ...(uri ? { uri } : {}) }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: positions.byteLength }, { buffer: 0, byteOffset: positions.byteLength, byteLength: indices.byteLength }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 8, type: 'VEC3', min: [-0.5, 0, -0.5], max: [0.5, 1, 0.5] }, { bufferView: 1, componentType: 5123, count: 36, type: 'SCALAR' }],
  });
  const json = Buffer.from(manifest.padEnd(Math.ceil(manifest.length / 4) * 4, ' '));
  const header = Buffer.alloc(20), binaryHeader = Buffer.alloc(8);
  header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(28 + json.length + binary.length, 8);
  header.writeUInt32LE(json.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
  binaryHeader.writeUInt32LE(binary.length, 0); binaryHeader.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, json, binaryHeader, binary]);
}
