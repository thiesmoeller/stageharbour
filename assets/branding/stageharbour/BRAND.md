# StageHarbour brand guide

**Status:** working brand direction · 21 October 2026. Use this document to review marketing and future application styling. The name, logo, domain, and trademarks are **not cleared or final**. The three images in this folder are concept art, not a finished identity system.

## Brand idea

**StageHarbour** is the home base for a theatre company's scenery plans as its production travels between venues. *Harbour* connects the product to Hamburg and suggests a place to gather the pieces before the next journey. The harbour reference should feel practical and welcoming, not nautical costume. *Stage* matches product language (**stage layout** / Bühnenbild), not dramatic play scenes or light looks.

**Audience:** people in community and independent theatre groups who design, build, transport, fit, and document productions; especially set designers, technical leads, stage managers, and crews who may share these jobs.

**Product promise:** keep a group's production scenery, physical stock, venue adaptations, and issued plans understandable together. Show what is planned, what is assigned, and what still needs checking.

**Positioning sentence:** StageHarbour helps travelling theatre groups plan their scenery for each venue and prepare clear plans for the people who build and move it.

### Name and language

- Write **StageHarbour** with a capital S and H, no space. Keep the British spelling **Harbour** in English and German copy. Do not alternate with *Stage Harbor*, *SceneHarbour*, *Scene Dock*, or *StagePlanner*.
- Treat the name as a proper noun: “Plan it in StageHarbour”; “a StageHarbour plan.” Do not translate it to *Bühnenhafen* in German UI.
- Pair the name with a short descriptor until the product is known: **“Scenery planning for touring theatre”** / **“Bühnenbilder für Gastspielorte planen.”**
- “Touring theatre” here means a **group travelling to venues**. A venue is the place hosting a performance, not the group that owns the production or scenery.
- Avoid making the Hamburg origin a feature claim. The name can travel internationally even when the city is absent from everyday UI.
- Ops fallback: CapRover app id `stageplanner` and host `stageplanner.example.org` may remain as redirect/technical names; they are not the public product name.

## Words to use

| Purpose | English | German |
| --- | --- | --- |
| Main headline | **One production. Many stages.** | **Eine Produktion. Viele Bühnen.** |
| Short descriptor | Scenery planning for touring theatre. | Bühnenbilder für Gastspielorte planen. |
| One-sentence pitch | Plan scenery, stock, and venue adaptations in one place. | Bühnenbild, Bestand und Anpassungen an Spielorte an einem Ort planen. |
| Call to action | Plan a production | Produktion planen |
| Supporting line | From the first layout to the crew's issued plan. | Vom ersten Bühnenbild bis zum freigegebenen Plan für das Team. |

Use **“One production. Many stages.”** as the lead marketing line for now. The earlier “Build once. Fit every stage.” is attractive but implies a fit guarantee that the product does not provide. Say **“check the fit”** or **“adapt for a venue”** when describing that workflow.

### Voice

Write like a capable colleague in a workshop: direct, concrete, calm, and aware that many users are volunteers working under time pressure. Prefer *wall panel, brace, stock item, venue, clearance, issued plan* to broad promises about creativity. Use active verbs: **plan, place, check, assign, prepare, issue**. Explain a warning with the affected piece, the venue condition, and the next action.

Examples:

- **Good:** “This wall is 180 mm outside the venue boundary. Move it or review the venue dimensions.”
- **Good:** “Two placements use panel W-04. Check whether they appear in the same scene.”
- **Avoid:** “Your show is ready for every venue.”
- **Avoid:** language that implies an engineering approval, automatic fit, reservation, or dated stock availability when the app has not established one.

### Claims to match to the release

| Topic | Safe to demonstrate from the current product | Keep as a future direction |
| --- | --- | --- |
| Productions and venues | A group can maintain production layouts and explicit adaptations tied to venue versions. | Automatic adaptation or a guarantee that a set fits a venue. |
| Scenery and stock | Walls, braces, panels, ballast, assignments, and stock warnings have defined workflows. | Every group defining arbitrary new element kinds and material recipes. See the [configurable elements spec](../../../docs/travelling-group-elements-spec.md). |
| Issued plans | Frozen revisions and construction exports can be demonstrated. | Engineering certification, physical load approval, or a promise that every assembly is safe. |
| Collaboration | A private group workspace, roles, and controlled editing can be demonstrated. | Real-time multi-user editing or a public, self-service multi-group platform. |

Use screenshots and examples from the release being promoted. Update this table before publishing a feature page; marketing copy should follow the shipped product.

## Visual direction

**Core image:** stage scenery and a harbour share a visual grammar: docks, routes, frames, crates, construction lines, and a clear place from which a production departs. The strongest motif is a **stage flat framing a Hamburg skyline**. Let the working structure show. The product should look made for theatre crews rather than for shipping logistics.

**Character:** capable, warm, precise, and visually bold. Use the drama of a stage light or a port at dusk in marketing; keep the planning workspace quiet and legible.

### Concept assets in this folder

| File | Size | Best use | Crop guidance |
| --- | --- | --- | --- |
| [hamburg-daylight-stage-hero.png](hamburg-daylight-stage-hero.png) | 1916 × 821 | Primary landing-page hero or launch graphic. Its modular scenic pieces communicate the product most clearly. | Put headline over the light left area; keep the scenic flats and Elbphilharmonie visible on the right. |
| [hamburg-illustrated-hero.png](hamburg-illustrated-hero.png) | 1672 × 941 | Editorial campaign image, event slide, or an alternate dark hero. | Use the navy left area for copy; do not crop away the flat that frames the skyline. |
| [hamburg-backstage-hero.png](hamburg-backstage-hero.png) | 1774 × 887 | Atmospheric background for a story, presentation, or sign-in concept. | Keep the loading-dock equipment on the right; add a solid or gradient overlay behind any text. |

These are **generated concept images**. The skyline is stylized and should not be represented as an exact city photograph or architectural record. Keep campaign images out of technical drawings and exports, where they would compete with measurements. Do not place text directly into the image files; compose accessible HTML text above them. Store final web derivatives separately and retain these source PNGs.

### Palette proposal

These are starting values drawn from the image direction. They are **not yet applied to the app**.

| Token | Hex | Role |
| --- | --- | --- |
| Harbour navy | `#10263D` | Brand anchor, dark backgrounds, primary headings |
| Elbe blue | `#16577B` | Links, active navigation, secondary actions |
| Signal copper | `#B34F2A` | Important call to action and selective emphasis |
| Paper | `#F7F3EA` | Warm marketing background, editorial cards |
| Ink | `#1F303C` | Body text on light backgrounds |
| Quiet ink | `#4F626D` | Secondary text on Paper |
| Rule | `#CBD5D9` | Borders and construction lines |
| White | `#FFFFFF` | UI surfaces and text on dark buttons |

Checked contrast ratios for normal text: Harbour navy on White **15.37:1**; Elbe blue on White **7.83:1**; Signal copper on White **5.16:1**; Ink on Paper **12.26:1**; Quiet ink on Paper **5.75:1**. Recheck every new foreground/background pairing when implementing. Copper is an accent, not a status colour. Use text and icons with colour for errors, warnings, selections, and stock shortages.

### Typography

- Use the repository's licensed [Source Sans 3](../../fonts/NOTICE.md) Regular and Bold as the dependable starting family for UI and marketing. It supports practical, readable labels and the current local font assets avoid a new dependency.
- Wordmark direction: a custom, restrained **StageHarbour** wordmark. Let the capital S and H establish rhythm; avoid decorative ship wheels, anchors, theatre masks, and wave-shaped letters. A small independent symbol may combine a stage frame with a dock edge, but must work at 24–29 px in the app masthead.
- Marketing headline: bold, compact lines with generous surrounding space. UI: sentence case labels, tabular numerals for dimensions, and no letter-spaced all-caps paragraphs.
- Logo, favicon, and one-colour mark are **not designed yet**. Do not use a cropped hero image as the logo.

### Composition and imagery

- Let one theatrical object explain each visual: a flat, case, brace, plan, or working light. Hamburg landmarks support the story; they should not overwhelm it.
- Use architectural lines and stage geometry as secondary graphics. Grid marks, centre lines, and measured offsets can frame a campaign image, but should not mimic a technical plan inaccurately.
- Use navy or Paper as a calm text field. Keep headlines separate from detailed scenery and harbour cranes. Check mobile crops independently.
- Real future photography should show actual crews and physical objects respectfully, with their permission and accurate captions. Use genuine venue and production imagery for case studies.
- Avoid stock images of a generic proscenium, anonymous applause, cruise ships, or containers as the main product metaphor.

## Applying this to the application later

The current app uses green/grey colours in [`src/client/style.css`](../../../src/client/style.css) and [`src/client/workspace.css`](../../../src/client/workspace.css). It supports an installation-level product name, tagline, footer, and PNG/JPEG logo, but does not currently offer a full theme. That configurable site branding is separate from the future StageHarbour product identity: a self-hosting group may still present its own name on its sign-in page.

1. **Start with shared tokens.** Introduce semantic roles for text, surfaces, borders, focus, actions, selection, warning, and error. Map the proposed palette to those roles, then review the editor's 2D/3D colours separately so planning meaning remains clear.
2. **Keep the canvas first.** Use the harbour identity in the sign-in page, onboarding, production gallery, and empty states. In the editor, limit it to the masthead and a few action accents. Measurements and stock warnings must win the visual hierarchy.
3. **Design the small mark first.** The editor masthead reserves about 24 px, the workspace masthead about 29 px, and the general header about 35 px. Test a one-colour mark at each size before making a detailed logo.
4. **Treat images as optional.** A dark or light background, product name, and next action must remain complete when hero images are disabled, slow to load, or cropped on mobile.
5. **Check accessible states.** Keyboard focus, selected placements, warnings, unavailable stock, and save status need explicit shapes/text and sufficient contrast. Do not use copper alone to mean “problem.”
6. **Keep exports functional.** Issued construction plans should prioritize scale, legends, revision, labels, and warning text. Branding belongs in a modest header/footer, not behind the plan.

The current logo upload accepts PNG/JPEG up to 2 MB. Prepare that small raster derivative only after a logo is chosen; keep the master as vector artwork. The hero PNGs in this folder are larger and are **not** logo upload candidates.

## Marketing rollout kit

**Landing page opening:** “One production. Many stages.” Follow with the short descriptor and a sentence about scenery, stock, and venue adaptations. Show the daylight hero beside the message, then a real product screen showing a venue-specific plan. Explain the group-to-venue workflow before listing features.

**Three proof points to demonstrate with product evidence:**

1. **Carry your scenery system:** reusable set pieces and real stock remain the group's property across productions and venues.
2. **Adapt with context:** each venue has its own geometry; adaptations and issues stay visible.
3. **Give crews a stable plan:** issued revisions keep their labels, requirements, and warnings.

**Suggested assets to make next:** vector wordmark and 24 px mark; light and dark logo exports; favicon; responsive web versions of the chosen hero; one screenshot of a production-to-venue journey; German and English launch copy; a one-page PDF with a product screenshot and contact details. For any screenshot, use a realistic example group and venue, without private customer data.

**Before public launch:** confirm the product name with trademark searches in intended markets, check relevant domains and social handles, secure the chosen naming, and confirm that any real venue or production imagery can be used commercially. A web search alone is not clearance.

## Decisions to resolve

- Is **StageHarbour** the final product name after clearance, or the working direction?
- Does the brand centre on the **daylight theatre-set** direction or the **dark harbour** direction? Both may be used, but one needs to lead.
- Should the tagline stay descriptive for launch, or should “One production. Many stages.” become the main brand line in both languages?
- Will the public product use one StageHarbour identity while allowing self-hosted installations to display a group's own site branding?
