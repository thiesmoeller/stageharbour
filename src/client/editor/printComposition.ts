const LAYERS = [
  ['grid', 'Raster'], ['venue', 'Raum und feste Wände'], ['walls', 'Bühnenwände'],
  ['platforms', 'Podeste und Treppen'], ['braces', 'Stützen'], ['objects', 'Möbel und Requisiten'],
  ['audience', 'Publikum'], ['curtains', 'Vorhänge'], ['overhead', 'Traversen und Überbauungen'],
  ['constraints', 'Freihalten und Technik'], ['dimensions', 'Maße und Maßlinien'],
  ['identities', 'Platten- und Aufbaunummern'], ['orientation', 'Ausrichtung und Mittellinie'],
] as const;
const NS = 'http://www.w3.org/2000/svg';

/** Transient composition on a cloned drawing; never writes to the scene or inventory. */
export function addPrintComposition(drawing: SVGSVGElement, controls: HTMLElement) {
  const doc = controls.ownerDocument;
  const heading = doc.createElement('h2'); heading.textContent = 'Druck gestalten'; controls.append(heading);
  const explanation = doc.createElement('p');
  explanation.textContent = 'Elemente für dieses Blatt ein-/ausblenden. Notizen und Pfeile auf der Zeichnung platzieren und durch Ziehen verschieben. Änderungen gelten nur für diese Druckansicht.';
  controls.append(explanation);
  const layers = doc.createElement('div'); layers.className = 'print-layers'; controls.append(layers);
  const resetters: (() => void)[] = [];
  const visibility = new Map<SVGElement, { display: string; hiddenBy: Set<symbol> }>();
  function toggle(parent: HTMLElement, label: string, elements: SVGElement[]) {
    if (!elements.length) return;
    const wrapper = doc.createElement('label'); wrapper.className = 'print-check';
    const checkbox = doc.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = true;
    wrapper.append(checkbox, doc.createTextNode(label)); parent.append(wrapper);
    const reason = Symbol(label);
    for (const element of elements) if (!visibility.has(element)) visibility.set(element, { display: element.style.display, hiddenBy: new Set() });
    const apply = () => elements.forEach(element => {
      const state = visibility.get(element)!;
      if (checkbox.checked) state.hiddenBy.delete(reason); else state.hiddenBy.add(reason);
      element.style.display = state.hiddenBy.size ? 'none' : state.display;
    });
    checkbox.addEventListener('change', apply);
    resetters.push(() => { checkbox.checked = true; apply(); });
  }
  for (const [key, label] of LAYERS) toggle(layers, label, [...drawing.querySelectorAll<SVGElement>(`[data-print-layer="${key}"]`)]);
  toggle(layers, 'Objektbeschriftungen', [...drawing.querySelectorAll<SVGElement>('text')].filter(element => !element.closest('[data-print-layer="dimensions"], [data-print-layer="orientation"], [data-print-layer="identities"]')));
  const details = doc.createElement('details'); const summary = doc.createElement('summary'); summary.textContent = 'Einzelne Elemente'; details.append(summary);
  const list = doc.createElement('div'); list.className = 'print-object-list'; details.append(list); controls.append(details);
  for (const element of drawing.querySelectorAll<SVGElement>('[data-print-name]')) {
    const category = LAYERS.find(([key]) => key === element.dataset.printLayer)?.[1] ?? 'Element';
    toggle(list, `${category}: ${element.dataset.printName}`, [element]);
  }
  const reset = doc.createElement('button'); reset.textContent = 'Alle Elemente einblenden'; reset.addEventListener('click', () => resetters.forEach(fn => fn())); controls.append(reset);

  const tools = doc.createElement('div'); tools.className = 'print-note-tools'; controls.append(tools);
  const textLabel = doc.createElement('label'); textLabel.textContent = 'Drucknotiz';
  const text = doc.createElement('input'); text.maxLength = 200; text.placeholder = 'z. B. Zugang freihalten'; textLabel.append(text); tools.append(textLabel);
  const sizeLabel = doc.createElement('label'); sizeLabel.textContent = 'Schriftgröße (pt)';
  const size = doc.createElement('select');
  for (const value of [10, 12, 16, 20]) { const option = doc.createElement('option'); option.value = String(value); option.textContent = String(value); size.append(option); }
  size.value = '12'; sizeLabel.append(size); tools.append(sizeLabel);
  const noteButton = doc.createElement('button'); noteButton.textContent = 'Notiz platzieren'; tools.append(noteButton);
  const arrowButton = doc.createElement('button'); arrowButton.textContent = 'Pfeil zeichnen'; tools.append(arrowButton);
  const cancel = doc.createElement('button'); cancel.textContent = 'Platzierung abbrechen'; cancel.hidden = true; tools.append(cancel);
  const status = doc.createElement('p'); status.setAttribute('role', 'status'); tools.append(status);
  const added = doc.createElement('ul'); added.className = 'print-note-list'; controls.append(added);
  let denominator = 50;
  let mode: 'note' | 'arrow' | undefined;
  let first: { x: number; y: number } | undefined;
  let pendingText = '', pendingSize = 12;
  const annotations: { element: SVGGElement; render: () => void }[] = [];
  function stop() {
    mode = undefined; first = undefined; cancel.hidden = true; status.textContent = ''; drawing.style.cursor = '';
  }
  noteButton.addEventListener('click', () => {
    if (!text.value.trim()) { status.textContent = 'Bitte zuerst eine Drucknotiz eingeben.'; text.focus(); return; }
    mode = 'note'; first = undefined; pendingText = text.value.trim(); pendingSize = Number(size.value); cancel.hidden = false;
    status.textContent = 'In die Zeichnung klicken, um die Notiz zu platzieren.'; drawing.style.cursor = 'crosshair';
  });
  arrowButton.addEventListener('click', () => { mode = 'arrow'; first = undefined; cancel.hidden = false; status.textContent = 'Startpunkt und dann Pfeilspitze in der Zeichnung anklicken.'; drawing.style.cursor = 'crosshair'; });
  cancel.addEventListener('click', stop);
  doc.addEventListener('keydown', event => { if (event.key === 'Escape') stop(); });
  function point(event: MouseEvent | PointerEvent) {
    const matrix = drawing.getScreenCTM();
    if (!matrix) return undefined;
    const p = drawing.createSVGPoint(); p.x = event.clientX; p.y = event.clientY;
    return p.matrixTransform(matrix.inverse());
  }
  function mount(label: string, x: number, y: number, render: (group: SVGGElement) => void) {
    const group = doc.createElementNS(NS, 'g'); group.dataset.printAnnotation = 'true';
    group.setAttribute('transform', `translate(${x} ${y})`); group.style.cursor = 'move';
    drawing.append(group);
    const annotation = { element: group, render: () => render(group) }; annotations.push(annotation); annotation.render();
    const item = doc.createElement('li'); item.append(doc.createTextNode(label));
    const remove = doc.createElement('button'); remove.textContent = 'Entfernen'; remove.setAttribute('aria-label', `${label} entfernen`);
    remove.addEventListener('click', () => { group.remove(); item.remove(); annotations.splice(annotations.indexOf(annotation), 1); }); item.append(remove); added.append(item);
    let drag: { x: number; y: number; startX: number; startY: number } | undefined;
    group.addEventListener('pointerdown', event => {
      if (mode || event.button !== 0) return;
      const p = point(event); if (!p) return;
      drag = { x, y, startX: p.x, startY: p.y }; group.setPointerCapture(event.pointerId); event.preventDefault();
    });
    group.addEventListener('pointermove', event => {
      if (!drag) return;
      const p = point(event); if (!p) return;
      x = drag.x + p.x - drag.startX; y = drag.y + p.y - drag.startY;
      group.setAttribute('transform', `translate(${x} ${y})`);
    });
    group.addEventListener('pointerup', () => { drag = undefined; });
    group.addEventListener('pointercancel', () => { drag = undefined; });
  }
  drawing.addEventListener('click', event => {
    if (!mode) return;
    const p = point(event); if (!p) return;
    if (mode === 'note') {
      const value = pendingText, pt = pendingSize;
      mount(value, p.x, p.y, group => {
        const caption = doc.createElementNS(NS, 'text'); caption.textContent = value;
        caption.setAttribute('font-size', String(pt * 25.4 / 72 * denominator));
        caption.setAttribute('font-family', 'Arial, sans-serif'); caption.setAttribute('fill', '#203c36');
        const backing = doc.createElementNS(NS, 'rect'); backing.setAttribute('fill', '#ffffff'); backing.setAttribute('fill-opacity', '0.94');
        group.replaceChildren(backing, caption);
        const box = caption.getBBox(), padding = denominator;
        for (const [key, value] of Object.entries({ x: box.x - padding, y: box.y - padding, width: box.width + padding * 2, height: box.height + padding * 2 })) backing.setAttribute(key, String(value));
      });
      stop();
    } else if (!first) { first = { x: p.x, y: p.y }; status.textContent = 'Jetzt die Pfeilspitze anklicken.'; }
    else {
      const dx = p.x - first.x, dy = p.y - first.y;
      if (Math.hypot(dx, dy) < 1) return;
      mount('Pfeil', first.x, first.y, group => {
        const length = Math.hypot(dx, dy), head = Math.min(length / 3, denominator * 3);
        const ux = dx / length, uy = dy / length;
        const line = doc.createElementNS(NS, 'line'); line.setAttribute('x2', String(dx)); line.setAttribute('y2', String(dy));
        line.setAttribute('stroke', '#203c36'); line.setAttribute('stroke-width', String(denominator * 0.4));
        const tip = doc.createElementNS(NS, 'polygon'); tip.setAttribute('fill', '#203c36');
        tip.setAttribute('points', `${dx},${dy} ${dx - ux * head - uy * head / 2},${dy - uy * head + ux * head / 2} ${dx - ux * head + uy * head / 2},${dy - uy * head - ux * head / 2}`);
        group.replaceChildren(line, tip);
      });
      stop();
    }
  });
  return { setScale(next: number) { denominator = next; annotations.forEach(annotation => annotation.render()); } };
}
