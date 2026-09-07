import { constructionSnapshotSchema } from '../../shared/export.js';
import { constructionPackageSchema } from '../../shared/package.js';
import { renderPackage } from './packagePdf.js';
import { renderConstructionPlan } from './pdf.js';

try {
  const raw = await new Promise(resolve => process.once('message', resolve));
  const pkg = constructionPackageSchema.safeParse(raw);
  process.send!(pkg.success ? await renderPackage(pkg.data) : await renderConstructionPlan(constructionSnapshotSchema.parse(raw)));
} catch (error) {
  process.send!({ error: error instanceof Error ? error.message : 'PDF-Erzeugung fehlgeschlagen.' });
}
