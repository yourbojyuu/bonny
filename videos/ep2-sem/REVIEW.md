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

- Reveals follow the narration, so some pages hold empty space until a card is named (e.g. p21 right card, p32 right cards). This is the requested speech sync; the EP1 rule "everything within ~5 s" no longer holds on those pages.
- Text under 28 px is the deck's own design (labels, chips, page numbers) — left as is.

## Revision 2 (2026-10-22)

- **Timing to the real speech**: narration transcribed with Whisper turbo (scripts/transcribe.py → scripts/asr.json); the script
  is aligned to the transcript, and cues where the narrator ad-libs or the transcript garbles a term are pinned to the second
  they are spoken (numbers in `CUES`). Camera punch-ins start 0.65 s early so the camera arrives on the word.
- Zooms on tables/cards frame the whole card (`card:` targets), so rows ringed during a zoom stay in view.
- **Arrowheads** travel with the drawing tip (marker replaced by a moving copy, path sampled at build time).
- **Demo box** plays a teaser montage of the demo (scripts/make_preview.py) with a slow zoom, chip and pulsing play button.
- **Voice**: every file tone-matched to one curve, light denoise, two-pass loudnorm → all tracks −16.0…−16.6 LUFS;
  silence trimmed at the edges and pauses > 0.7 s shortened. Clip: silences ≥ 1.0 s sped up (17:45 → 11:49).

### Open (needs the author)

- p19: real narration added 23 Oct (`EP2SEM-03.mp3`, 36 s); cues re-timed to it (FAM 6.9 s, PAM 16.0 s, SEM 25.9 s, rings on "CFA หรือ CCA", "β และ R²" and the closing bar).
- **p21 narration stops early**: `EP2-SEM-05.mp3` ends at "…เอาคะแนนมาเป็นตัวชี้วัดของ RU และประ…" — the Embedded two-stage
  part is not in the recording; the Embedded card is dragged in at the end without narration.
- Full `hyperframes check` exceeds its deadline on this 20-min project; run per range (`--range 0,150` etc.) — all ranges pass,
  only contrast warnings on the deck's own greyed "ns" rows.
