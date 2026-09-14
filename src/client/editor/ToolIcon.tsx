const paths = {
  orbit: 'M12 3v4m0 10v4M3 12h4m10 0h4M4 7c3-4 13-4 16 0s-1 10-8 10S1 11 4 7Zm4-3c-4 3-4 13 0 16s10-1 10-8S12 1 8 4Z',
  audience: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Zm13 0a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
  top: 'M4 5h16v14H4V5Zm4 4h8v6H8V9Z',
  front: 'M4 20V5h16v15M2 20h20M8 20V9h8v11',
  side: 'm6 20 12-3V4L6 7v13Zm0-8 12-3M3 21h18',
  move: 'M12 2v20M2 12h20M9 5l3-3 3 3M9 19l3 3 3-3M5 9l-3 3 3 3m14-6 3 3-3 3',
  rotate: 'M20 7v5h-5M20 12a8 8 0 1 0-2 6',
  tray: 'M3 4h18v16H3V4Zm11 0v16m3-12h1m-1 4h1m-1 4h1',
  back: 'M15 5 8 12l7 7M8 12h13',
  undo: 'M8 4 3 9l5 5M3 9h10a7 7 0 0 1 7 7v3',
  redo: 'm16 4 5 5-5 5M21 9H11a7 7 0 0 0-7 7v3',
  wall: 'M5 21V5l14-3v17L5 21ZM9 5v15',
  brace: 'M5 3v18h15L5 3Zm0 12h10M3 21h19',
  platform: 'm3 10 9-5 9 5-9 5-9-5Zm0 0v5l9 5 9-5v-5M12 15v5',
  stairs: 'M3 20v-5h6v-5h6V5h6v15H3Z',
  library: 'M3 3h7v7H3V3Zm11 0h7v7h-7V3ZM3 14h7v7H3v-7Zm11 0h7v7h-7v-7Z',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  expand: 'M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5',
  settings: 'M4 7h16M4 17h16M8 4v6m8 4v6',
  help: 'M9 9a3 3 0 1 1 5 2c-2 1-2 2-2 3m0 3v.1M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z',
};

export function ToolIcon({ name }: { name: keyof typeof paths }) {
  return <svg className="tool-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}
