import { constructionSnapshotSchema } from '../../shared/export.js';
import { constructionPackageSchema } from '../../shared/package.js';
import { renderPackage } from './packagePdf.js';
import { renderConstructionPlan } from './pdf.js';

function send(result: { pdf: string } | { error: string }) {
  return new Promise<void>((resolve, reject) => {
    process.send!(result, (error: Error | null) => error ? reject(error) : resolve());
  });
}

try {
  const raw = await new Promise(resolve => process.once('message', resolve));
  const pkg = constructionPackageSchema.safeParse(raw);
  const pdf = pkg.success
    ? await renderPackage(pkg.data)
    : await renderConstructionPlan(constructionSnapshotSchema.parse(raw));
  await send({ pdf: pdf.toString('base64') });
} catch (error) {
  await send({ error: error instanceof Error ? error.message : 'PDF-Erzeugung fehlgeschlagen.' }).catch(() => {});
}
