import type { PartMaterial } from '../../shared/parts/definition.js';
import { formatNumber, type PartIssue } from '../../shared/parts/issues.js';
import type { ResolvedPart } from '../../shared/parts/resolve.js';

const kg = (value: number) => `${formatNumber(Math.round(value * 100) / 100)} kg`;
const m = (millimetres: number) => `${formatNumber(Math.round(millimetres / 10) / 100)} m`;
const m2 = (squareMillimetres: number) => `${formatNumber(Math.round(squareMillimetres / 10_000) / 100)} m²`;

/** Zuschnittliste, Zubehör, Unterbauteile and Gewicht of the current resolve. */
export function CutListPanel({ resolved, materials }: { resolved: ResolvedPart | undefined; materials: readonly PartMaterial[] }) {
  if (!resolved) return <p className="muted">Keine Vorschau verfügbar.</p>;
  const name = (key: string) => materials.find(material => material.key === key)?.name ?? key;
  const { beams, sheets } = resolved.cutList;
  return <div className="designer-cutlist" data-testid="designer-cutlist">
    <p className="designer-weight"><span>Gewicht</span> <strong data-testid="designer-weight">{kg(resolved.weightKg)}</strong></p>
    {beams.length > 0 && <table className="designer-table compact">
      <caption>Profile</caption>
      <thead><tr><th scope="col">Material</th><th scope="col">Länge</th><th scope="col">Stück</th><th scope="col">Gesamt</th><th scope="col">Gewicht</th></tr></thead>
      <tbody>{beams.map((row, index) => <tr key={index}>
        <td>{name(row.material)}</td><td>{row.lengthMm} mm</td><td>{row.count}</td><td>{m(row.totalLengthMm)}</td><td>{kg(row.weightKg)}</td>
      </tr>)}</tbody>
    </table>}
    {sheets.length > 0 && <table className="designer-table compact">
      <caption>Platten</caption>
      <thead><tr><th scope="col">Material</th><th scope="col">Zuschnitt</th><th scope="col">Stück</th><th scope="col">Netto</th><th scope="col">Gewicht</th></tr></thead>
      <tbody>{sheets.map((row, index) => <tr key={index}>
        <td>{name(row.material)}</td><td>{row.widthMm} × {row.heightMm} × {formatNumber(row.thicknessMm)} mm</td><td>{row.count}</td>
        <td>{m2(row.areaMm2)}</td><td>{kg(row.weightKg)}</td>
      </tr>)}</tbody>
    </table>}
    {resolved.hardware.length > 0 && <table className="designer-table compact">
      <caption>Zubehör</caption>
      <thead><tr><th scope="col">Material</th><th scope="col">Stück</th><th scope="col">Gewicht</th></tr></thead>
      <tbody>{resolved.hardware.map(row => <tr key={row.material}>
        <td>{name(row.material)}</td><td>{row.quantity}</td><td>{kg(row.weightKg)}</td>
      </tr>)}</tbody>
    </table>}
    {resolved.partCounts.length > 0 && <table className="designer-table compact">
      <caption>Unterbauteile</caption>
      <thead><tr><th scope="col">Bauteil</th><th scope="col">Variante</th><th scope="col">Stück</th></tr></thead>
      <tbody>{resolved.partCounts.map((row, index) => <tr key={index}>
        <td>{row.name}</td><td>{row.variant ?? '–'}</td><td>{row.count}</td>
      </tr>)}</tbody>
    </table>}
    {!beams.length && !sheets.length && !resolved.hardware.length && <p className="muted">In dieser Einstellung entsteht kein Zuschnitt.</p>}
  </div>;
}

/** Findings of the current check; errors block saving. Clicking one selects what it is about. */
export function IssueList({ issues, onSelect }: {
  issues: readonly Pick<PartIssue, 'severity' | 'message'>[];
  onSelect?: (index: number) => void;
}) {
  const errors = issues.filter(item => item.severity === 'error').length;
  return <div className="designer-issues" data-testid="designer-issues">
    <p className={errors ? 'designer-issue-summary error-text' : 'designer-issue-summary'}>
      {errors ? `${errors} ${errors === 1 ? 'Fehler verhindert' : 'Fehler verhindern'} das Speichern.`
        : issues.length ? 'Keine Fehler; Hinweise beachten.' : 'Keine Fehler gefunden.'}
    </p>
    {issues.length > 0 && <ul>
      {issues.map((item, index) => <li key={index} className={item.severity}>
        {onSelect ? <button type="button" className="link-button" onClick={() => onSelect(index)}>{item.message}</button> : item.message}
      </li>)}
    </ul>}
  </div>;
}
