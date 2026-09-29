export function WallIdentity({ rotation, assemblyNumber, plate, testId }: {
  rotation: number; assemblyNumber?: number; plate?: string; testId: string;
}) {
  const position = assemblyNumber != null ? String(assemblyNumber) : '';
  if (!position && !plate) return null;
  const positionSize = 460;
  const plateSize = 280;
  const width = Math.max(position.length * positionSize * 0.62, (plate?.length ?? 0) * plateSize * 0.55, 280);
  const height = (position ? positionSize * 0.9 : 0) + (plate ? plateSize * 0.9 : 0) + 40;
  return <g transform={`rotate(${rotation})`} pointerEvents="none" data-print-layer="identities" data-testid={testId}>
    <rect x={-width / 2} y={-height / 2} width={width} height={height} rx={36} fill="#f7f9f5" fillOpacity={0.94} />
    {position && <text y={plate ? -height * 0.08 : positionSize * 0.32} textAnchor="middle" fontSize={positionSize} fontWeight={700} fill="#173c36">{position}</text>}
    {plate && <text y={position ? height * 0.38 : plateSize * 0.32} textAnchor="middle" fontSize={plateSize} fontWeight={700} fill="#6a4e16">{plate}</text>}
  </g>;
}
