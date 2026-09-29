# Separate physical finish from scene intent

A scene describes a proposed set; it does not prove that a panel has been painted. On physical-panel assignment, capture the intended face surfaces as an immutable finish assignment. Only an explicit completion action in Bestand copies that snapshot to the panel's actual finish. This follows the user's confirmed workflow and supersedes ADR 0005's temporary exclusion of finishes from Bestand.

Later scene edits retain the snapshot. A new job requires releasing the assignment, saving, and assigning again. Cross-venue copies and clipboard copies discard assignment metadata along with panel IDs; same-production scene duplicates retain it. Previously assigned legacy walls acquire a snapshot on their next save. Empty surfaces mean standard plywood, while an absent physical-finish record means unknown. Completing an assignment checks that the scene still assigns that panel and snapshot; it never modifies scene appearance.

Technical outlet/cable cutouts belong to individual panels and appear in inventory previews. Scenic openings continue to belong to wall types. This avoids changing every instance when measuring one unusual physical panel. Cutouts are informational stock details in this iteration, not automatically punched into stage designs.
