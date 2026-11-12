import { fileURLToPath } from 'node:url';
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { freezePackage } from '../../src/shared/package.js';
import { renderConstructionPlan } from '../../src/server/exports/pdf.js';
import { renderDocument } from '../../src/server/exports/documentPdf.js';
import { renderPackage } from '../../src/server/exports/packagePdf.js';
import type { Json } from './format.js';
import { composeFixtureDocument, freezeFixtureSnapshot, revisionOf, type LoadedFixture } from './capture.js';

const STANDARD_FONTS = `${fileURLToPath(new URL('../../node_modules/pdfjs-dist/standard_fonts/', import.meta.url))}`;

export type PdfFingerprint = {
  pageCount: number;
  pages: { widthPt: number; heightPt: number; text: string; operators: number; paths: number; images: number }[];
};

/** Page count, page sizes, extracted text and drawing-operator counts. Byte-level output is deliberately not compared. */
export async function pdfFingerprint(pdf: Buffer): Promise<PdfFingerprint> {
  const params = { data: new Uint8Array(pdf), disableWorker: true, isEvalSupported: false, useSystemFonts: false, standardFontDataUrl: STANDARD_FONTS };
  const task = getDocument(params as never);
  const document = await task.promise;
  const pages: PdfFingerprint['pages'] = [];
  try {
    for (let number = 1; number <= document.numPages; number++) {
      const page = await document.getPage(number);
      const [x0 = 0, y0 = 0, x1 = 0, y1 = 0] = page.view;
      const content = await page.getTextContent();
      const text = content.items.map(item => ('str' in item ? item.str : '')).join('\n');
      const operators = await page.getOperatorList();
      const count = (op: number) => operators.fnArray.filter(fn => fn === op).length;
      pages.push({
        widthPt: x1 - x0, heightPt: y1 - y0, text, operators: operators.fnArray.length,
        paths: count(OPS.constructPath), images: count(OPS.paintImageXObject) + count(OPS.paintInlineImageXObject),
      });
      page.cleanup();
    }
  } finally {
    await task.destroy();
  }
  return { pageCount: document.numPages, pages };
}

export async function capturePdf(fixture: LoadedFixture): Promise<Json> {
  const snapshot = freezeFixtureSnapshot(fixture);
  const plan = await renderConstructionPlan(snapshot);
  const document = await renderDocument(composeFixtureDocument(fixture));
  const pkg = await renderPackage(freezePackage([fixture.scene], revisionOf(fixture), fixture.panels, fixture.ballastStock));
  return JSON.parse(JSON.stringify({
    plan: await pdfFingerprint(plan),
    document: await pdfFingerprint(document),
    package: await pdfFingerprint(pkg),
  })) as Json;
}
