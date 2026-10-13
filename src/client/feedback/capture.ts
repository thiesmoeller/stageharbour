import { FEEDBACK_CAPTURE_MAX_EDGE, type StageCaptureHandle } from '../editor/StageCapture.js';
import { FEEDBACK_ATTACHMENT_BYTES, type FeedbackImage } from '../../shared/feedback.js';

/** Do not let a stuck software-WebGL read burn the whole feedback capture budget. */
const FEEDBACK_STAGE_BUDGET_MS = 6_000;

function withBudget<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(label)), ms);
    promise.then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
  });
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const timeout = setTimeout(() => reject(new Error('Bildaufnahme dauerte zu lange.')), 12_000);
    image.onload = () => { clearTimeout(timeout); resolve(image); };
    image.onerror = () => { clearTimeout(timeout); reject(new Error('Bild konnte nicht geladen werden.')); };
    image.src = url;
  });
}
function blobUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('Bild konnte nicht gelesen werden.')); reader.readAsDataURL(blob);
  });
}
export function feedbackImageFromUrl(url: string): FeedbackImage {
  const match = /^data:(image\/png|image\/jpeg);base64,(.+)$/.exec(url);
  if (!match || atob(match[2]!).length > FEEDBACK_ATTACHMENT_BYTES) throw new Error('Bild ist größer als 2 MiB.');
  return { type: match[1] as FeedbackImage['type'], base64: match[2]! };
}
export async function readFeedbackImage(file: File): Promise<FeedbackImage> {
  if (!['image/png', 'image/jpeg'].includes(file.type) || file.size > FEEDBACK_ATTACHMENT_BYTES) throw new Error('Bitte PNG oder JPEG bis 2 MiB wählen.');
  const url = await blobUrl(file);
  await loadImage(url);
  return feedbackImageFromUrl(url);
}

async function captureSvg(source: SVGSVGElement): Promise<string> {
  const clone = source.cloneNode(true) as SVGSVGElement;
  const originals = [source, ...source.querySelectorAll('*')];
  const copies = [clone, ...clone.querySelectorAll('*')];
  const properties = ['fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin', 'opacity', 'font-family', 'font-size', 'font-weight', 'text-anchor', 'dominant-baseline', 'vector-effect', 'visibility', 'display'];
  originals.forEach((original, index) => {
    const style = getComputedStyle(original);
    const copy = copies[index] as SVGElement;
    for (const property of properties) copy.style.setProperty(property, style.getPropertyValue(property).replace(/url\(["']?[^#)]*#([^"')]+)["']?\)/g, 'url(#$1)'));
  });
  const rect = source.getBoundingClientRect();
  clone.setAttribute('width', String(Math.max(1, rect.width))); clone.setAttribute('height', String(Math.max(1, rect.height)));
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  // SVG images cannot load external resources when rasterized; embed same-origin underlays.
  for (const element of clone.querySelectorAll('image')) {
    const href = element.getAttribute('href') ?? element.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
    if (!href || href.startsWith('data:')) continue;
    const url = new URL(href, location.origin);
    if (url.origin !== location.origin && url.protocol !== 'blob:') throw new Error('Bildquelle kann nicht aufgenommen werden.');
    const response = await fetch(url, { credentials: 'same-origin', signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error('Vorlage konnte nicht aufgenommen werden.');
    element.removeAttributeNS('http://www.w3.org/1999/xlink', 'href');
    element.setAttribute('href', await blobUrl(await response.blob()));
  }
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(clone))}`;
}

/** Captures just the work panes, without dialogs or account/admin UI. */
export async function captureWorkView(view: 'plan' | 'stage' | 'split', svg: SVGSVGElement | null, stage: StageCaptureHandle | null): Promise<FeedbackImage> {
  const captures: Promise<string>[] = [];
  if (view !== 'stage') {
    if (!svg) throw new Error('Grundriss ist nicht verfügbar.');
    captures.push(captureSvg(svg));
  }
  if (view !== 'plan') {
    if (!stage) {
      // Split can still ship the Grundriss when 3D is not ready yet.
      if (view === 'stage') throw new Error('Raumsicht ist noch nicht bereit.');
    } else {
      const stageCapture = stage.capturePng({ maxEdge: FEEDBACK_CAPTURE_MAX_EDGE, preferCanvas: true });
      captures.push(view === 'split'
        ? withBudget(stageCapture, FEEDBACK_STAGE_BUDGET_MS, 'Raumsicht-Aufnahme dauerte zu lange.')
        : stageCapture);
    }
  }
  const settled = await Promise.allSettled(captures);
  const available = settled.flatMap(result => result.status === 'fulfilled' ? [result.value] : []);
  if (!available.length) throw new Error('Keine sichtbare Ansicht konnte aufgenommen werden.');
  const decoded = await Promise.allSettled(available.map(loadImage));
  const images = decoded.flatMap(result => result.status === 'fulfilled' ? [result.value] : []);
  if (!images.length) throw new Error('Keine sichtbare Ansicht konnte dargestellt werden.');
  const height = Math.min(1200, Math.max(...images.map(image => image.height)));
  const widths = images.map(image => height * image.width / image.height);
  const total = widths.reduce((a, b) => a + b, 0);
  const scale = Math.min(1, 1800 / total);
  const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(total * scale)); canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Bildaufnahme ist nicht verfügbar.');
  context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
  let x = 0;
  images.forEach((image, index) => { const width = widths[index]! * scale; context.drawImage(image, x, 0, width, canvas.height); x += width; });
  return feedbackImageFromUrl(canvas.toDataURL('image/jpeg', 0.85));
}
