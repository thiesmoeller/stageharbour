import { constructionSnapshotSchema } from '../../shared/export.js';
import { renderConstructionPlan } from './pdf.js';

try {
  const snapshot = constructionSnapshotSchema.parse(await new Promise(resolve => process.once('message', resolve)));
  process.send!(await renderConstructionPlan(snapshot));
} catch (error) {
  process.send!({ error: error instanceof Error ? error.message : 'PDF-Erzeugung fehlgeschlagen.' });
}
