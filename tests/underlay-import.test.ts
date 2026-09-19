import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeUnderlayMediaType, underlayFileName, underlayNeedsRasterConversion, underlayUploadsDirectly,
} from '../src/shared/underlayImport.js';

test('PNG JPEG and PDF upload without conversion', () => {
  assert.equal(underlayUploadsDirectly('image/png'), true);
  assert.equal(underlayUploadsDirectly('image/jpeg'), true);
  assert.equal(underlayUploadsDirectly('image/jpg'), true);
  assert.equal(underlayUploadsDirectly('application/pdf'), true);
  assert.equal(underlayNeedsRasterConversion('image/png'), false);
  assert.equal(underlayNeedsRasterConversion('application/pdf'), false);
});

test('clipboard and browser rasters need PNG conversion', () => {
  assert.equal(underlayNeedsRasterConversion('image/webp'), true);
  assert.equal(underlayNeedsRasterConversion('image/gif'), true);
  assert.equal(underlayNeedsRasterConversion('image/bmp'), true);
  assert.equal(underlayNeedsRasterConversion('application/x-qt-image'), true);
  assert.equal(underlayNeedsRasterConversion(''), true);
  assert.equal(underlayUploadsDirectly('image/webp'), false);
  assert.equal(underlayNeedsRasterConversion('text/plain'), false);
});

test('normalizes jpeg alias and builds upload names', () => {
  assert.equal(normalizeUnderlayMediaType('image/jpg;charset=utf-8'), 'image/jpeg');
  assert.equal(underlayFileName('image/png'), 'screenshot.png');
  assert.equal(underlayFileName('image/jpeg', 'plan.JPG'), 'plan.JPG');
  assert.equal(underlayFileName('application/pdf', 'grundriss.pdf'), 'grundriss.pdf');
  assert.equal(underlayFileName('image/webp', 'clip.webp'), 'clip.png');
});
