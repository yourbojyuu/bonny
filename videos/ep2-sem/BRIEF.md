---
workflow: general-video
flow: automation
message: "ห้าปัจจัยร่วมกันอธิบาย RU ได้ 52.9% ปัจจัยใกล้ตัวครูส่งผลตรง ส่วนผู้นำไม่มีผลตรง"
destination: youtube
aspect: 1920x1080
language: th
audience: "ผู้เรียนวิชาโมเดลสมการโครงสร้าง / ผู้สนใจ ADANCO"
length: "~9 min narration + demo clip"
angle: "สไลด์บรรยายเสียงพากย์ (EP2 ของซีรีส์ 3 ตอน) ตาม videos/STYLE-GUIDE.md"
---

## Intent

EP 2 ของซีรีส์ "Phuchit × ADANCO": อะไรทำให้ครูใช้งานวิจัย — PLS-SEM (Disjoint two-stage), อ่านผลห้าขั้น.
หน้า 17–35 ของเด็ค (หน้า 17 = หน้าแรกของตอน). เสียงพากย์ล็อกแล้ว (SCRIPT.md).
เพิ่มจาก EP1: ทุกการปรากฏ/ลากวาง/ซูม/วงไฮไลต์/ลูกศรวาด ตรงกับคำที่พากย์พูดถึง, กล้องซูมจุดสำคัญ, เสียงเอฟเฟกต์หลายแบบสลับกัน.

## Assets

- Slide deck — https://claude.ai/artifact/K8CmGMY9XoxP4J8HcDecxA, slides `ep2` … `sem-ph-sum` → `source/slides/`
- Narration — Drive folder 1O0Rs7ZpbuXQJ14GFweMRqNSAETz6Qahf, `EP2:SEM-01..19.mp3` → `source/audio-raw/EP2-SEM-NN.mp3` (page = 16 + NN)
- Demo clip — `EP2-SEM.mp4` (88.5 MB, Drive) → `assets/video/EP2-SEM.mp4`; too large for the sandbox's Drive download, push it via GitHub
- ADANCO screenshots — 8 deck assets → `assets/img/`

## Pipeline

1. `python3 scripts/edit_clip.py` (once `assets/video/EP2-SEM.mp4` is in place)
2. `python3 scripts/process_voice.py`
3. `python3 scripts/make_sfx.py`
4. `python3 scripts/build_frames.py` — scene schedule, reveals, cues (`CUES`), SFX, `index.html`
5. `npx hyperframes check` → snapshot → render

## Timing to the words

There is no speech recogniser in the sandbox, so `build_frames.py` estimates when each word is spoken:
the page text from SCRIPT.md is spread over the voiced stretches of its narration file, weighted by
how long each kind of character takes to say (digits, β, R², spelled acronyms take longer). Cues in
`CUES` name the words; to move a beat, change its words there and rebuild.
