/** Online help for crews: tools, shortcuts, gestures, wall surfaces. */

export function Help() {
  return <article className="help-page" aria-labelledby="help-title">
    <header className="help-hero">
      <p className="eyebrow">ONLINE-HILFE</p>
      <h1 id="help-title">Bedienung des Bühnenplaners</h1>
      <p className="lead">Kurzüberblick zu Werkzeugen, Mausgesten, Tastaturkürzeln und Wandoberflächen.
        Maße sind immer Millimeter.</p>
    </header>

    <nav className="help-toc" aria-label="Inhalt">
      <a href="#hilfe-ablauf">Ablauf</a>
      <a href="#hilfe-werkzeuge">Werkzeuge</a>
      <a href="#hilfe-gesten">Gesten &amp; Navigation</a>
      <a href="#hilfe-kuerzel">Tastatur</a>
      <a href="#hilfe-oberflaechen">Wandoberflächen</a>
      <a href="#hilfe-raumsicht">Raumsicht</a>
    </nav>

    <section id="hilfe-ablauf">
      <h2>Ablauf</h2>
      <ol>
        <li><strong>Spielstätte</strong> anlegen oder wählen: Umriss, feste Wände, Podeste, Überbauung.</li>
        <li><strong>Produktion / Szene</strong> öffnen: bewegliche Wände und Requisiten auf dem Grundriss platzieren.</li>
        <li>In den <strong>Eigenschaften</strong> Maße übernehmen (Übernehmen), in der <strong>Raumsicht</strong> prüfen.</li>
        <li>Bei Bedarf <strong>Export</strong> (Bauzeichnung / PDF) oder Bauplan-Revision einfrieren.</li>
      </ol>
      <p className="muted">Der Status unten rechts zeigt „Gespeichert“ oder Konflikte. Entwürfe mit offenen Änderungen blockieren das Verlassen der Szene.</p>
    </section>

    <section id="hilfe-werkzeuge">
      <h2>Werkzeuge</h2>
      <h3>Szene (Bühnenbild)</h3>
      <ul>
        <li><strong>Wand / Stütze / Platzhalter</strong> — aus der Werkzeugleiste oder Objektbibliothek platzieren, Klick setzt.</li>
        <li><strong>Auswahl</strong> — Klick wählt; Ziehen auf dem Boden umschließt (nur vollständig enthaltene Objekte).</li>
        <li><strong>Shift+Klick</strong> — zur Mehrfachauswahl hinzufügen oder entfernen.</li>
        <li><strong>Gruppieren</strong> — ausgewählte Teile drehen und verschieben um einen gemeinsamen Drehpunkt.</li>
        <li><strong>Ausschnitte</strong> — an Wänden ohne Wandtyp zeichnen oder in den Eigenschaften bearbeiten.</li>
      </ul>
      <h3>Spielstätte</h3>
      <ul>
        <li><strong>Eckpunkt / Kante</strong> — Umriss verfeinern oder parallel verschieben.</li>
        <li><strong>Feste Wand</strong> — zwei Punkte, 15°-Winkel; optional Wandtyp oder gezeichneter Ausschnitt.</li>
        <li><strong>Podest, Treppe, Stuhl, …</strong> — feste Einrichtungen der Halle.</li>
        <li><strong>Traverse / Molton / Lüftung / Notausgang</strong> — zeichnen oder setzen; Speichern legt eine neue Spielstättenfassung an.</li>
      </ul>
    </section>

    <section id="hilfe-gesten">
      <h2>Gesten &amp; Navigation</h2>
      <ul>
        <li><strong>Verschieben</strong> — Objekt ziehen; Mittelklick oder Zwei-Finger-Scroll verschiebt den Ausschnitt.</li>
        <li><strong>Zoomen</strong> — Pinch oder Strg/Cmd+Scroll; Raster 1&nbsp;m / 50&nbsp;cm.</li>
        <li><strong>Drehen</strong> — orange ↻-Griff am ausgewählten Objekt.</li>
        <li><strong>Einrasten</strong> — Vorderseite bei ⅓·½·⅔, Stirnseiten, Mittellinie, 15°-Winkel; <kbd>Alt</kbd> umgeht das Einrasten.</li>
        <li><strong>Platzieren abbrechen</strong> — Escape oder Klick in freien Raum (auch in der Raumsicht).</li>
        <li><strong>Überschneidungen</strong> — erscheinen rot auf dem Grundriss.</li>
      </ul>
    </section>

    <section id="hilfe-kuerzel">
      <h2>Tastatur</h2>
      <table className="help-keys">
        <thead><tr><th>Taste</th><th>Wirkung</th></tr></thead>
        <tbody>
          <tr><td><kbd>Escape</kbd></td><td>Platzieren / Ziehen abbrechen oder Auswahl aufheben</td></tr>
          <tr><td><kbd>Entf</kbd> / <kbd>Backspace</kbd></td><td>Auswahl löschen</td></tr>
          <tr><td><kbd>Strg</kbd>/<kbd>Cmd</kbd>+<kbd>Z</kbd></td><td>Rückgängig</td></tr>
          <tr><td><kbd>Strg</kbd>/<kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> oder <kbd>Y</kbd></td><td>Wiederholen</td></tr>
          <tr><td><kbd>Strg</kbd>/<kbd>Cmd</kbd>+<kbd>C</kbd> / <kbd>X</kbd> / <kbd>V</kbd></td><td>Kopieren / Ausschneiden / Einfügen (Kopie hängt am Zeiger)</td></tr>
          <tr><td><kbd>Strg</kbd>/<kbd>Cmd</kbd>+<kbd>S</kbd></td><td>Speichern anstoßen (wo vorgesehen)</td></tr>
          <tr><td><kbd>Alt</kbd> (während Ziehen)</td><td>Einrasten vorübergehend aus</td></tr>
        </tbody>
      </table>
      <p className="muted">In Eingabefeldern greifen die Systemkürzel der Felder; Editor-Befehle sind dort deaktiviert.</p>
    </section>

    <section id="hilfe-oberflaechen">
      <h2>Wandoberflächen</h2>
      <p>Unter <strong>Oberflächen</strong> in den Eigenschaften einer Wand (Szene oder feste Spielstättenwand):</p>
      <ul>
        <li><strong>Vorderseite / Rückseite / Kante</strong> — je Seite unabhängig.</li>
        <li><strong>Ganzflächig</strong> oder <strong>Zwei Streifen</strong> (Teilungshöhe von unten, Standard 1200&nbsp;mm).</li>
        <li><strong>RAL-Wandfarbe</strong> — matte Theaterfarbe aus den Swatches.</li>
        <li><strong>Bibliothek</strong> — Holz, Stoff, Stein, … aus dem Pascal-Katalog (ohne flache Farb-Presets).</li>
        <li><strong>Mustermaß</strong> — ungefähre Kachelbreite auf der Fläche in mm.</li>
        <li><strong>Faserrichtung</strong> — 0° / 90° / 180° / 270° für Maserung und Muster.</li>
      </ul>
      <p>Beurteilen Sie Materialien in der <strong>erweiterten Raumsicht</strong> (beleuchtet). Die einfache Darstellung und der Grundriss zeigen nur Hinweise.</p>
      <p className="muted">Ältere Pläne mit „finish“ oder RAL-Feldern werden beim Laden automatisch in Oberflächen übernommen.</p>
    </section>

    <section id="hilfe-raumsicht">
      <h2>Raumsicht</h2>
      <ul>
        <li>Ansichten: Von oben, vorne, Seite, Publikum, Umlauf — und Bühne einpassen.</li>
        <li><strong>Erweiterte Darstellung</strong> nutzt Pascal-Beleuchtung und Texturen; dort wirken Oberflächen.</li>
        <li>Klick in freien Raum hebt die Auswahl auf (wie im Grundriss).</li>
      </ul>
    </section>

    <p className="help-footer muted">Kurzhilfe im Editor: Schaltfläche <strong>Bedienung</strong> in der Statusleiste · diese Seite jederzeit unter Hilfe im Arbeitsbereich.</p>
  </article>;
}
