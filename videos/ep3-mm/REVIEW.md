# EP3 review — build of 2026-10-22

`npx hyperframes check`: **ok** (0 errors). Stills reviewed at every camera punch-in, every highlight ring and late in each scene.

## Verified

- Speech-timed reveals: p36 diagram drops on "ภาวะผู้นำจะสร้าง"; p37 Mediation / Moderation cards on their names, arrows draw on "ผลจาก X ผ่าน M" and "ปรับความแรง";
  p38 steps ringed one by one (หนึ่ง … หก), then the three patterns; p39 funnel 12 → 3 → 1 ringed on "สามโมเดล" / "หนึ่งโมเดล".
- p41: rings walk the comparison table (.093, 99% CI, SRMR, the ✗ cells), punch-ins on the 99% CI row, the SRMR row, then the reasons bar on "Bonferroni".
- p42: each ADANCO screenshot punches in as it is named; p43 punch-in on the LEAD_SUPP → ORGA row then ORGA → RU, rings on t, CI, f², R², the indirect row.
- p44: the three simple-slope lines draw on with "ลบหนึ่ง SD", "ระดับเฉลี่ย", "บวกหนึ่ง SD"; slopes .293 / .355 / .416 ringed.
- p45–48 cards drop on their words; p46 count card zoom; p49 thanks.

## Fixed during review

- Rings on bold words that wrap over two lines drew beside the text (p39, p48) → ring the whole sentence / card text.
- p48 card 3 dropped early: "และสาม" first matched "และสามรูปแบบ" in point one → cue on "และสาม การสนับสนุน".
- p44 punch-in aimed at the chart title instead of the chart → removed; the line draws carry the beat.
- p47 bottom bar appeared 2 s before the cut → reveals with the page.

## Open

- **Pages 45, 46, 47 have no narration** (no recording in the Drive folder). They play silent for ~26 s / ~11 s / ~43 s on estimated timing.
  Add `source/audio-raw/EP3-MOD-12.mp3` (p45), `-13` (p46), `-14` (p47) — or change `VOICE` in `scripts/process_voice.py` — and rebuild.
- `EP3-MOD-09.mp3` (7 s: "ระหว่างทาง เราก็พบจุดที่ควรชี้แจงเพิ่มเติม ตอนที่ 1 ช่วง weight…", then silence) matches no EP3 page; not used.
- `EP3-MOD-05` is page 41 and `EP3-MOD-06` is page 40 (demo intro, "…ในที่นี้เราจะกดสามโมเดล"), by content.
- **Demo clip** is a placeholder (6 s card) until `assets/video/EP3-MOD.mp4` is pushed; then run the pipeline from step 1 and render.
- Text under 28 px and the demo slide's text leaving when the clip opens are the accepted warnings from EP2.
