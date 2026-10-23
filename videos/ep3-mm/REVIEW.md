# EP3 review — build of 2026-10-23 (second pass)

## Second pass (author feedback: sync, arrows, demo box, voice, pace, dead air)

- **Sync**: cue times come from whisper-small transcripts of the final narration (`scripts/words/`, windows of ≤ 18 s cut at
  pauses), aligned to SCRIPT.md by edit distance. Every cue was checked against the transcript at its time; examples of
  corrections over the old estimate: p41 "ค่า β อยู่ที่ .093" 13.3 → 12.1 s, p43 "R² ของ ORGA" 28.4 → 25.1 s, p44 ".293" 8.3 → 6.9 s.
  SCRIPT.md p41/p43/p44 rewritten to the spoken wording (the speaker repeats "ช่วงความเชื่อมั่น", says "ไปหา").
- **Arrows**: lines grow from their start with the head at the tip (p36, p37, p44 checked mid-draw).
- **Demo box (p40)**: plays a 12 s montage of the clip (Excel → model → bootstrap → result) with push-in, scan light, PREVIEW /
  duration chips and a pulsing play button; the clip starts as the box opens (no empty frame). Caption "แทรกคลิป:" (a placeholder
  note on the slide) shown as "คลิปสาธิต:".
- **Voice**: narration −16.1 LUFS on every file (LRA 1.3–2.4), clip voice −16.1 LUFS, levelled and EQ-matched (+5 dB presence,
  −3 dB low end) to the narration.
- **Pace**: narration pauses > 0.38 s cut to 0.30 s and 1.07×; clip speech 1.08×, silent stretches squeezed (13:49 → 8:25).
  Whole episode 18:17 → 15:17. Silent pages 45–47 shortened from 80 s to ~35 s.

# First pass — build of 2026-10-22

`npx hyperframes check`: **ok** (0 errors). Stills reviewed at every camera punch-in, every highlight ring and late in each scene.

## Verified

- Speech-timed reveals: p36 diagram drops on "ภาวะผู้นำจะสร้าง"; p37 Mediation / Moderation cards on their names, arrows draw on "ผลจาก X ผ่าน M" and "ปรับความแรง";
  p38 steps ringed one by one (หนึ่ง … หก), then the three patterns; p39 funnel 12 → 3 → 1 ringed on "สามโมเดล" / "หนึ่งโมเดล".
- p41: rings walk the comparison table (.093, 99% CI, SRMR, the ✗ cells), punch-ins on the 99% CI row, the SRMR row, then the reasons bar on "Bonferroni".
- p42: each ADANCO screenshot punches in as it is named; p43 punch-in on the LEAD_SUPP → ORGA row then ORGA → RU, rings on t, CI, f², R², the indirect row.
- p44: the three simple-slope lines draw on with "ลบหนึ่ง SD", "ระดับเฉลี่ย", "บวกหนึ่ง SD"; slopes .293 / .355 / .416 ringed.
- p45–48 cards drop on their words; p46 count card zoom; p49 thanks.

- p40 demo: cursor clicks play, the box opens to full screen, slide and stickers clear, clip plays (13:49 → 9:30 after
  `edit_clip.py`: 57 silent stretches sped up), then fades into p41. The clip ends "…ไปดูผลในไฟล์กันว่าทำไมเราถึงเลือก", which leads into p41.

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
- Text under 28 px and the demo slide's text leaving when the clip opens are the accepted warnings from EP2.
