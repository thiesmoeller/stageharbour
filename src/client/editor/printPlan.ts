import { addPrintComposition } from './printComposition.js';

/** Preserve the rendered 2D SVG rather than translating it into a reduced PDF renderer. */
export function openPlanPrint(source: SVGSVGElement, title: string): boolean {
  const popup = window.open('', '_blank');
  if (!popup) return false;
  popup.opener = null;
  const doc = popup.document;
  doc.title = title;
  doc.documentElement.lang = 'de';
  const clone = source.cloneNode(true) as SVGSVGElement;
  const originals = [source, ...source.querySelectorAll('*')];
  const copies = [clone, ...clone.querySelectorAll('*')];
  const properties = ['fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin', 'opacity', 'font-family', 'font-size', 'font-weight', 'font-style', 'text-anchor', 'dominant-baseline', 'vector-effect', 'paint-order', 'visibility', 'display'];
  originals.forEach((original, index) => {
    const style = getComputedStyle(original);
    const copy = copies[index] as SVGElement;
    for (const property of properties) {
      // Computed fragment URLs may contain the editor URL; the print document owns its own defs.
      const value = style.getPropertyValue(property).replace(/url\(["']?[^#)]*#([^"')]+)["']?\)/g, 'url(#$1)');
      if (value) copy.style.setProperty(property, value);
    }
  });
  clone.querySelectorAll('.rotation-handle, .dimension-snap, [data-testid="alignment-guides"], [data-testid="selection-marquee"], [data-testid="marquee-target"], [data-testid="dimension-target"], [data-testid="dimension-preview"], [data-testid="placing-wall"], [data-testid="placing-object"]').forEach(element => element.remove());
  const viewport = source.getAttribute('viewBox')!;
  // Measure in the live document. Infinite construction guides must not enlarge the page.
  clone.style.cssText += ';position:absolute;left:-100000px;width:1000px;height:1000px;opacity:0';
  document.body.append(clone);
  const guide = clone.querySelector<SVGElement>('[data-testid="stage-centreline"]');
  if (guide) guide.style.display = 'none';
  // Chromium rasterizes nested SVG patterns when printing. Expand the editor grid into
  // ordinary clipped lines so a large-format PDF keeps the grid sharp as well.
  const floor = clone.querySelector<SVGPathElement>('[data-testid="venue-floor"]');
  if (floor) {
    const ns = 'http://www.w3.org/2000/svg';
    const box = floor.getBBox();
    const clip = document.createElementNS(ns, 'clipPath'); clip.id = 'print-floor-clip';
    const outline = document.createElementNS(ns, 'path'); outline.setAttribute('d', floor.getAttribute('d') ?? ''); clip.append(outline);
    clone.querySelector('defs')?.append(clip);
    floor.style.fill = '#fff';
    const grid = document.createElementNS(ns, 'g'); grid.setAttribute('clip-path', 'url(#print-floor-clip)'); grid.dataset.printLayer = 'grid';
    const line = (x1: number, y1: number, x2: number, y2: number, major: boolean) => {
      const element = document.createElementNS(ns, 'line');
      for (const [key, value] of Object.entries({ x1, y1, x2, y2 })) element.setAttribute(key, String(value));
      element.setAttribute('stroke', major ? '#cfd6c6' : '#ebefe6');
      element.setAttribute('stroke-width', major ? '1.25' : '1');
      element.setAttribute('vector-effect', 'non-scaling-stroke'); grid.append(element);
    };
    for (let x = Math.ceil(box.x / 500) * 500; x <= box.x + box.width; x += 500) line(x, box.y, x, box.y + box.height, x % 1000 === 0);
    for (let y = Math.ceil(box.y / 500) * 500; y <= box.y + box.height; y += 500) line(box.x, y, box.x + box.width, y, y % 1000 === 0);
    floor.after(grid);
  }
  const bounds = clone.getBBox();
  if (guide) guide.style.removeProperty('display');
  const pad = Math.max(bounds.width, bounds.height) * 0.025;
  const whole = `${bounds.x - pad} ${bounds.y - pad} ${Math.max(1, bounds.width + pad * 2)} ${Math.max(1, bounds.height + pad * 2)}`;
  clone.remove();
  clone.style.position = ''; clone.style.left = ''; clone.style.opacity = '1';
  clone.style.width = '100%'; clone.style.height = '100%'; clone.style.display = 'block';
  clone.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  const style = doc.createElement('style');
  style.textContent = 'body{margin:0;background:#e9edeb;color:#203c36;font:14px system-ui}header{padding:20px;display:flex;align-items:center;gap:16px;flex-wrap:wrap}h1{font-size:18px;margin:0;width:100%}label{display:grid;gap:4px}select,button{font:inherit;padding:8px}p{margin:0;width:100%}main{background:white;margin:20px auto;box-shadow:0 2px 12px #0002;display:flex;flex-direction:column}main svg{flex:1;min-height:0}svg{print-color-adjust:exact;-webkit-print-color-adjust:exact}.print-title-block{display:none;border-top:1.2pt solid #203c36;font:9pt "Source Sans 3",system-ui,sans-serif;color:#203c36}.print-title-block table{width:100%;border-collapse:collapse}.print-title-block th,.print-title-block td{border:0.6pt solid #203c36;padding:3mm 2.5mm;text-align:left;vertical-align:top}.print-title-block th{font-weight:600;width:22%}.print-title-block .scale-bar{display:flex;align-items:flex-end;gap:0;height:8mm;margin-top:2mm}.print-title-block .scale-bar span{border-top:1.2pt solid #203c36;border-left:0.6pt solid #203c36;text-align:center;font-size:7pt;padding-top:1mm}.print-title-block[data-on="true"]{display:block}@media print{header{display:none}body{background:white}main{margin:0;box-shadow:none;break-inside:avoid;height:100vh}}';
  style.textContent += '.print-composition{background:white;margin:0 20px;padding:16px;border-radius:8px}.print-composition h2{font-size:16px;margin:0 0 8px}.print-composition p{margin:8px 0}.print-layers{display:flex;flex-wrap:wrap;gap:12px;margin:16px 0}.print-check{display:flex;align-items:center;gap:6px}.print-object-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:8px;max-height:220px;overflow:auto;padding:12px 0}.print-composition summary{cursor:pointer;margin:12px 0}.print-note-tools{display:flex;align-items:end;flex-wrap:wrap;gap:12px;margin-top:16px}.print-note-tools input{font:inherit;padding:8px;min-width:220px}.print-note-list li{display:flex;align-items:center;gap:12px;margin:6px 0}.print-note-list button{padding:4px 8px}.print-composition svg{touch-action:none}@media print{.print-composition{display:none}}';
  doc.head.append(style);
  const pageStyle = doc.createElement('style'); doc.head.append(pageStyle);
  const header = doc.createElement('header');
  const heading = doc.createElement('h1'); heading.textContent = title; header.append(heading);
  function select(label: string, options: [string, string][], value: string) {
    const wrapper = doc.createElement('label'); wrapper.textContent = label;
    const control = doc.createElement('select');
    options.forEach(([value, text]) => { const option = doc.createElement('option'); option.value = value; option.textContent = text; control.append(option); });
    control.value = value; wrapper.append(control); header.append(wrapper); return control;
  }
  const paper = select('Papierformat', [['A4', 'A4'], ['A3', 'A3'], ['A2', 'A2'], ['A1', 'A1']], 'A3');
  const orientation = select('Ausrichtung', [['landscape', 'Querformat'], ['portrait', 'Hochformat']], 'landscape');
  const scope = select('Ausschnitt', [['whole', 'Ganze 2D-Zeichnung'], ['viewport', 'Wie im aktuellen Sichtfenster']], 'whole');
  const scale = select('Maßstab', [['fit', 'An Blatt anpassen'], ['25', '1:25'], ['50', '1:50'], ['100', '1:100']], 'fit');
  const titleBlock = select('Plankopf', [['off', 'Ohne'], ['on', 'DIN-Plankopf']], 'on');
  const print = doc.createElement('button'); print.textContent = 'Drucken / Als PDF speichern'; header.append(print);
  const download = doc.createElement('button'); download.textContent = 'SVG herunterladen'; header.append(download);
  const hint = doc.createElement('p'); header.append(hint);
  const sheet = doc.createElement('main'); sheet.setAttribute('aria-label', '2D-Druckansicht'); sheet.append(doc.adoptNode(clone));
  const plankopf = doc.createElement('aside');
  plankopf.className = 'print-title-block';
  const today = new Date().toLocaleDateString('de-DE');
  plankopf.innerHTML = `<table><tbody>
    <tr><th>Titel</th><td colspan="3">${title.replace(/</g, '&lt;')}</td></tr>
    <tr><th>Maßstab</th><td data-scale-cell>1:50</td><th>Datum</th><td>${today}</td></tr>
    <tr><th>Blatt</th><td>1 / 1</td><th>Fassung</th><td>—</td></tr>
  </tbody></table>
  <div class="scale-bar" aria-hidden="true" data-scale-bar></div>`;
  sheet.append(plankopf);
  const compositionControls = doc.createElement('section'); compositionControls.className = 'print-composition'; compositionControls.setAttribute('aria-label', 'Druck gestalten');
  doc.body.replaceChildren(header, compositionControls, sheet);
  const composition = addPrintComposition(clone, compositionControls);
  function update() {
    const sizes = { A4: [210, 297], A3: [297, 420], A2: [420, 594], A1: [594, 841] };
    const size = sizes[paper.value as keyof typeof sizes];
    const landscape = orientation.value === 'landscape';
    const titleOn = titleBlock.value === 'on';
    plankopf.dataset.on = titleOn ? 'true' : 'false';
    const titleReserve = titleOn ? 28 : 0;
    const width = (landscape ? size[1]! : size[0]!) - 20;
    const height = (landscape ? size[0]! : size[1]!) - 20 - titleReserve;
    pageStyle.textContent = `@page{size:${paper.value} ${orientation.value};margin:10mm}`;
    const viewBox = scope.value === 'whole' ? whole : viewport;
    clone.setAttribute('viewBox', viewBox);
    const [, , modelWidth = 1, modelHeight = 1] = viewBox.split(/\s+/).map(Number);
    const denominator = scale.value === 'fit' ? Math.max(modelWidth / width, modelHeight / height) : Number(scale.value);
    composition.setScale(denominator);
    const scaleLabel = scale.value === 'fit' ? 'angepasst' : `1:${scale.value}`;
    const scaleCell = plankopf.querySelector('[data-scale-cell]');
    if (scaleCell) scaleCell.textContent = scaleLabel;
    const bar = plankopf.querySelector('[data-scale-bar]');
    if (bar) {
      const metres = scale.value === 'fit' ? [1, 2, 5] : [1, 2, 5].map(m => m);
      bar.replaceChildren(...metres.map((metresValue, index) => {
        const segment = doc.createElement('span');
        const mm = scale.value === 'fit' ? 20 : (metresValue * 1000) / Number(scale.value);
        segment.style.width = `${mm}mm`;
        segment.style.background = index % 2 ? '#203c36' : '#fff';
        segment.style.color = index % 2 ? '#fff' : '#203c36';
        segment.textContent = `${metresValue} m`;
        return segment;
      }));
    }
    const drawingWidth = modelWidth / denominator, drawingHeight = modelHeight / denominator;
    sheet.style.width = `${drawingWidth}mm`;
    sheet.style.height = titleOn ? `${drawingHeight + titleReserve}mm` : `${drawingHeight}mm`;
    clone.style.height = titleOn ? `calc(100% - ${titleReserve}mm)` : '100%';
    const overflow = drawingWidth > width + 0.01 || drawingHeight > height + 0.01;
    print.disabled = overflow;
    hint.textContent = overflow ? 'Die Zeichnung passt in diesem Maßstab nicht auf das Blatt. Größeres Papier oder „An Blatt anpassen“ wählen.'
      : `${scale.value === 'fit' ? 'An Blatt angepasst · kein fester Maßstab.' : `Maßstab 1:${scale.value}.`}${titleOn ? ' Mit DIN-Plankopf.' : ''} Vektorzeichnung mit den sichtbaren 2D-Ebenen. Im Druckdialog dasselbe Papier, 100 %, keine Kopf-/Fußzeilen und Hintergrundgrafiken wählen. Als Druckziel ist auch „Als PDF speichern“ möglich.`;
  }
  for (const control of [paper, orientation, scope, scale, titleBlock]) control.addEventListener('change', update);
  print.addEventListener('click', () => { void doc.fonts.ready.then(() => { popup.focus(); popup.print(); }); });
  download.addEventListener('click', () => {
    const asset = clone.cloneNode(true) as SVGSVGElement;
    asset.setAttribute('width', sheet.style.width); asset.setAttribute('height', sheet.style.height);
    asset.style.width = sheet.style.width; asset.style.height = sheet.style.height;
    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(asset)], { type: 'image/svg+xml' }));
    const anchor = doc.createElement('a'); anchor.href = url; anchor.download = `${title.replace(/[^\wÄÖÜäöüß-]+/g, '_').slice(0, 80)}.svg`; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  update();
  return true;
}
