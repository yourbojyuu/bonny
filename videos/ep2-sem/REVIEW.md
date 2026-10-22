# EP2 review — build of 2026-10-22

`npx hyperframes check`: **ok** (0 errors). Review set: each scene at start + 0.3 s and middle, every cut, plus targeted
stills at every camera punch-in and highlight ring.

## Verified

- Speech-timed reveals: cards drop under the cursor as the narration names them (p18 RU → factors pop on their names; p22 items 1–4; p35 cards).
- Camera punch-ins frame their target and return (p20 table, p24 each screenshot, p26 three tables in sequence, p28 table then the r = .90 card, p29 .83 / R² .814, p31, p32, p34 count card, p35).
- Highlight rings sit on the named cell / row / word (grid-table rows joined across cells: p25 dULS/dG, p28 rows, p31 rows; <tr> rows on p32; bold words on p27).
- Arrows draw on with their words (p18 pink then grey; p29 solid then dashed fade in).
- p23: steps card is dragged in on "ADANCO", cursor clicks the play button, the clip box opens to full screen.
- Sound: 285 effects from 14 categories (63 variants), shuffle-bag so neighbours differ; effects mix at about −30 LUFS against narration at −17 LUFS.

## Fixed during review

- Ring "lift" on inline bold text moved the word to the end of its line → lift only on block elements.
- Confetti for a later drop showed early as a small clump → confetti no longer pre-renders.
- p23 cursor went to the corner (SVG has no offset box) → aims at the round HTML button.
- p27/p29 script errors from one element carrying two target ids → one id per element.

## Open

- **p19 narration** (`EP2-SEM-03.mp3`) is 8.4 s, far shorter than the page text (other pages speak ~6–10 chars/s; this one would need 34). Please confirm it is the right take; the page's bottom bar is on screen only ~1.3 s because of it.
- **Demo clip** is a placeholder (6 s card) until `assets/video/EP2-SEM.mp4` is pushed; then run the pipeline from step 1.
- Reveals follow the narration, so some pages hold empty space until a card is named (e.g. p21 right card, p32 right cards). This is the requested speech sync; the EP1 rule "everything within ~5 s" no longer holds on those pages.
- Text under 28 px is the deck's own design (labels, chips, page numbers) — left as is.
