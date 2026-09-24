import type { MeasureLine } from '../../shared/measurements.js';
import { measureLineCaption, measureLineMidpoint } from '../../shared/measurements.js';

/** User-drawn measure callouts on the plan (like CAD dimension tools). */
export function MeasureLayer({ lines }: { lines: readonly MeasureLine[] }) {
  return <g className="measure-layer" aria-hidden>
    {lines.map(line => {
      const mid = measureLineMidpoint(line);
      return <g key={line.id} data-testid={`measure-${line.id}`}>
        <line x1={line.x1} y1={-line.y1} x2={line.x2} y2={-line.y2} className="measure-line" />
        <circle cx={line.x1} cy={-line.y1} r={40} className="measure-end" />
        <circle cx={line.x2} cy={-line.y2} r={40} className="measure-end" />
        <text x={mid.x} y={-mid.y - 80} textAnchor="middle" fontSize="220" fontWeight={700} className="measure-caption">{measureLineCaption(line)}</text>
      </g>;
    })}
  </g>;
}
