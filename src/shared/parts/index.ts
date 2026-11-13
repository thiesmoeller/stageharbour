/**
 * Parametric part kernel. Pure and server-safe: nothing exported here imports three.js.
 * Mesh generation lives in `./geometry.js` and is imported from there by code that draws.
 */
export * from './formula.js';
export * from './issues.js';
export * from './definition.js';
export * from './sites.js';
export * from './openingParams.js';
export * from './resolve.js';
export * from './place.js';
export * from './validate.js';
export * from './starter/index.js';
export * from './catalog.js';
export * from './catalogPlans.js';
export * from './libraryExchange.js';
export * from './stock.js';
export {
  FLUSH_EPS_MM, QUAT_IDENTITY, VEC3_ZERO,
  applyTransform, boundsOf, convexHull, polygonArea, polygonBounds, polygonPerimeter, pointInPolygon,
  quatAxes, quatFromAxisAngle, quatFromEulerDegrees, quatMultiply, rotate, signedArea,
  type Bounds3, type Quat, type RigidTransform, type Vec2, type Vec3,
} from './math.js';
