# Arena #1 Forecast — Design Spec (V1)

วันที่: 2026-10-16 · สถานะ: รอ user review

## 1. เป้าหมาย

เว็บ dashboard ที่ทายว่า **บริษัท/model ไหนจะเป็นอันดับ 1** บน arena.ai Text Arena (Overall)
ตอนตลาด Polymarket ตัดสิน (12:00 PM ET วันสุดท้ายของเดือน) และช่วย **ตัดสินใจเดิมพัน**
โดยเทียบความน่าจะเป็นของเรากับราคาที่ซื้อได้จริงในตลาด

**ผู้ใช้:** user คนเดียว เปิดดูเอง (รวมถึงบนมือถือ)
**สำเร็จเมื่อ:** เปิด dashboard แล้วรู้ใน 10 วินาทีว่า (ก) ใครน่าจะชนะกี่ % (ข) มี edge ที่คุ้มหลังหักค่าใช้จ่ายไหม (ค) มีความเสี่ยงอะไรที่ต้องระวัง และ (ง) ระบบนี้เคยทายแม่นแค่ไหน

### ตลาดที่รองรับ
| key | ตลาด | leaderboard ที่ใช้ตัดสิน | HF config |
|---|---|---|---|
| `off` | "Which company has the best AI model end of <Month>?" | arena.ai/leaderboard/text/overall-no-style-control | `text` |
| `on` | "Which company has #1 AI model end of <Month>? (Style Control On)" | arena.ai/leaderboard/text/overall | `text_style_control` |

กติกาตัดสิน (จาก description ตลาด): ใช้คอลัมน์ Rank, ตัด model ที่ติด "AutoEval", rank เสมอ → Arena score (ละเอียด) สูงกว่า, ยังเสมอ → ชื่อบริษัทตามตัวอักษร
→ ในทางปฏิบัติ = **model ที่ rating สูงสุดในกลุ่มที่มีสิทธิ์** ชนะ (model ที่ rating สูงสุดจะได้ rank 1 เสมอ)

## 2. ขอบเขต

**V1 (spec นี้):** forecast + edge หลัง fee/slippage (ข้อ 2) + backtest/calibration (ข้อ 1) + resolution risk (ข้อ 4) + audit trail (ข้อ 5) + ช่อง "สิ่งที่คุณรู้" + dashboard ภาษาไทย

**ไม่ทำใน V1:** Kelly sizing, trade journal, รวม exposure 2 ตลาด (→ V2 ใน NEXT_TASKS.md), แจ้งเตือน, ตลาดอื่น, auto-trade, login, การแตะ wallet/private key ใดๆ

## 3. แหล่งข้อมูล (ยืนยันจาก spike 2026-10-16)

### 3.1 Leaderboard — HuggingFace `lmarena-ai/leaderboard-dataset` (ทางการ)
- arena.ai เองโดน Cloudflare บล็อก (403) → **ไม่ scrape เว็บ**
- API: `https://datasets-server.huggingface.co/rows|filter?dataset=lmarena-ai/leaderboard-dataset&config=<text|text_style_control>&split=<latest|full>`
- คอลัมน์: `model_name, organization, license, rating, rating_lower, rating_upper, variance, vote_count, rank, category, leaderboard_publish_date`
- ใช้ `category == "overall"`; `sqrt(variance)` = SD ของ rating (ตรวจแล้ว: 1.96·√variance = rating_upper − rating)
- `full` มีประวัติตั้งแต่ 2023 (หลาย publish ต่อเดือน) → พอสำหรับ backtest
- **ข้อจำกัด:** ไม่มี flag AutoEval · อาจช้ากว่าเว็บจริง ~1 วัน → ทั้งสองข้อแสดงเป็น resolution risk

### 3.2 ตลาด — Polymarket (สาธารณะ ไม่ต้องใช้ key)
- Event: `https://gamma-api.polymarket.com/events?slug=<slug>` → `markets[]` หนึ่งตัวต่อบริษัท (`groupItemTitle`), `outcomePrices`, `bestBid/bestAsk`, `clobTokenIds` (JSON string), `feeSchedule {rate, exponent, takerOnly}`, `negRisk`
- Orderbook: `https://clob.polymarket.com/book?token_id=<id>` → `asks[] / bids[] {price,size}`
- ราคาย้อนหลัง (สำหรับ backtest baseline): `https://clob.polymarket.com/prices-history?market=<token>&...`
- slug ของแต่ละเดือนไม่ตายตัว → `config/markets.json` เก็บ slug ต่อเดือน + fallback ค้นหาจาก gamma ด้วย title

## 4. สถาปัตยกรรม

```
GitHub Actions (cron)
  ├─ fetch-arena      → HF latest (off, on)
  ├─ fetch-polymarket → events + orderbooks (off, on)
  ├─ validate         → ตรวจ schema/ความสดของข้อมูล
  ├─ forecast         → simulate (Monte Carlo) → % ราย model/บริษัท
  ├─ edge             → fill price จาก orderbook + fee → EV
  ├─ risk             → resolution-risk checklist
  ├─ explain          → เหตุผลภาษาไทย
  └─ write            → data/snapshots/… + data/latest/forecast.json + data/history/log.jsonl → commit
GitHub Pages: site/ (HTML + JS) อ่าน data/latest + data/history + data/backtest
```

**ภาษา: JavaScript (Node 20+, ES modules) ไม่มี dependency** — เหตุผล: โค้ด simulation ตัวเดียวกันรันได้ทั้งใน Actions และในเบราว์เซอร์ (ช่อง "สิ่งที่คุณรู้" คำนวณใหม่ทันทีบนหน้าเว็บโดยไม่ต้องมี server), ไม่ต้อง build, เทสด้วย `node:test` ที่ติดมากับ Node · Dashboard ใช้ Chart.js จาก CDN (pin version)

### 4.1 โครงไฟล์
```
src/
  core/            ← ใช้ร่วม Node + browser (ห้ามใช้ fs/network)
    rng.js           seeded RNG (mulberry32) + normal sampler
    rules.js         eligibility (AutoEval), winner ordering ตามกติกาตลาด
    simulate.js      Monte Carlo → { models: {name:p}, companies: {name:p} }
    edge.js          walk orderbook, fee, EV
    risk.js          resolution-risk checks
    explain.js       ข้อความเหตุผลภาษาไทย
    calendar.js      เวลา check (12:00 ET วันสุดท้ายของเดือน, รองรับ DST), วัน/ชม.ที่เหลือ
  pipeline/        ← Node เท่านั้น
    http.js          fetch + retry/backoff + timeout
    arena.js         ดึง/แปลง HF rows
    polymarket.js    หา event, ดึง orderbook
    validate.js
    history.js       สถิติจาก HF full: อัตรา model ใหม่ต่อบริษัท, การกระจาย debut delta, SD การขยับ
    backtest.js
    run.js           orchestrator (CLI: `node src/pipeline/run.js [--backtest]`)
config/
  settings.json    เกณฑ์ต่างๆ (edge 10%, stake sizes, N sims, ฯลฯ)
  companies.json   map organization (HF) → ชื่อบริษัทใน Polymarket
  markets.json     slug ต่อเดือนต่อตลาด
  overrides.json   AutoEval list + ข่าวที่ user ใส่ (มีผลกับ forecast ทางการ)
  calibration.json พารามิเตอร์ที่ backtest fit ได้ (เขียนโดย backtest)
data/              ← เขียนโดย pipeline เท่านั้น
site/  index.html, app.js, styles.css
tests/ *.test.js + fixtures/ (snapshot จริงที่ตัดให้เล็ก)
.github/workflows/ forecast.yml, backtest.yml, pages.yml
```

## 5. Forecast model (แบบ C)

ทำแยกต่อตลาด (`off`/`on`). ต่อการจำลองหนึ่งรอบ (N = 10,000, seed คงที่ต่อ run):

1. **Model ที่มีอยู่:** เอา model ที่มีสิทธิ์ (ตัด AutoEval) ที่ rating ≥ leader − 60
   `final = rating + drift + Normal(0, σ_move)`
   - `σ_move = k · √variance · √(h / 30)` (h = วันที่เหลือถึง check, ขั้นต่ำ 0.5) **+ σ_floor** (การ re-fit ของ leaderboard)
   - `drift` = slope ของ rating ใน 14 วันล่าสุด × h × shrink (0.5) — model ใหม่ที่ vote น้อยมักขยับมากกว่า
   - `k`, `σ_floor` มาจาก `calibration.json` (backtest fit) — ค่าเริ่ม k=1.0, σ_floor=2
2. **Model ใหม่:** ต่อบริษัท c, จำนวน debut ~ Poisson(λ_c · h)
   - `λ_c` = (จำนวน model ใหม่ของ c ที่ debut ใน top-10 ใน 365 วันล่าสุด) / 365, มี prior ขั้นต่ำเล็กน้อย
   - score ของ debut = best rating ปัจจุบันของ c + sample จากการกระจาย "debut delta" (empirical, ทุกบริษัทรวมกัน, ใช้ข้อมูล 2 ปีล่าสุด)
   - หัก lag: model ที่ debut หลัง cutoff (h − 1 วัน) ไม่นับ (ต้องรอขึ้น leaderboard)
3. **ข่าวจาก user** (`overrides.json` หรือช่องบนเว็บ): ต่อบริษัท `{ prob, delta }` — "โอกาส prob ที่จะมี model ใหม่ขึ้นก่อน check, score ≈ best ปัจจุบัน + delta" → แทนที่ λ_c ของบริษัทนั้นในรอบจำลอง
4. **ผู้ชนะ** = rating สูงสุด → บริษัท (ผ่าน `companies.json`; org ที่ map ไม่ได้ → "อื่นๆ" + risk warning)

Output: ความน่าจะเป็นราย **บริษัท** (สำหรับตลาด) และราย **model** (model ใหม่รวมเป็น "<บริษัท> · model ใหม่")

## 6. Edge (ข้อ 2)

ต่อบริษัท ต่อฝั่ง (YES/NO), ต่อ stake ใน `settings.stakes` (ค่าเริ่ม $100, $1,000):
- เดิน `asks` ของ token ฝั่งนั้นจากถูกไปแพง → avg fill price, shares ที่ได้, ถ้า liquidity ไม่พอ → แสดง "ซื้อได้แค่ $X"
- fee taker ตาม `feeSchedule` ของ market (**สูตรต้องยืนยันกับ docs.polymarket.com ตอน implement** แล้วเขียนเทสด้วยตัวอย่างจาก docs)
- `EV per $ = p_ours / (avg_price + fee_per_share) − 1`
- **ไฮไลต์** เมื่อ `|p_ours − mid| ≥ settings.edgeThreshold (0.10)` **และ** EV หลังหักค่าใช้จ่าย > 0
- ถ้า backtest บอกว่า model แย่กว่าตลาด → แสดงคำเตือนครอบไฮไลต์ทั้งหมด ("ระบบยังไม่แม่นกว่าตลาด — edge อาจไม่จริง")

## 7. Resolution risk (ข้อ 4)

แต่ละข้อ: ระดับ ok / warn / danger + ข้อความไทย
| check | เงื่อนไข warn/danger |
|---|---|
| ความสดของ leaderboard | publish ล่าสุด > 3 วัน warn, > 7 danger |
| ความสดของ pipeline | run ล่าสุด > 6 ชม. (หน้าเว็บตรวจเองจาก timestamp) |
| สูสี | gap อันดับ 1–2 (คนละบริษัท) < CI รวม → warn |
| vote น้อย | leader มี vote_count < 3,000 → warn (ขยับแรง/อาจเป็น preliminary) |
| AutoEval | มี model ใน top-5 ที่ user ติดไว้ใน overrides → warn; เตือนประจำว่า dataset ไม่มี flag นี้ ให้เช็คเว็บเองช่วง 48 ชม. สุดท้าย |
| lag ของ dataset | เหลือ < 48 ชม. → warn "HF อาจช้ากว่าเว็บจริง เช็ค arena.ai ด้วยตาก่อนเดิมพัน" + ลิงก์ |
| org ไม่รู้จัก | organization ที่ map ไม่ได้อยู่ใน top-10 → warn |
| ตลาดหาไม่เจอ | ไม่พบ event ของเดือนนี้ → danger (ยังแสดง forecast ได้ แต่ไม่มี edge) |

## 8. Audit trail (ข้อ 5)

ทุก run เขียน:
- `data/snapshots/YYYY-MM-DD/HHMMZ/` → `arena-off.json`, `arena-on.json` (เฉพาะ overall, top 50), `pm-off.json`, `pm-on.json` (ราคา + orderbook ระดับบน 10 ชั้น), `forecast.json`, `inputs.json` (config + overrides + calibration + git sha + seed ที่ใช้)
- `data/latest/forecast.json` (สำเนาล่าสุด สำหรับเว็บ)
- `data/history/YYYY-MM.jsonl` บรรทัดละ run: เวลา, % ของเรา, mid ตลาด ต่อบริษัท (ใช้วาดกราฟ)

จาก `inputs.json` + snapshot ต้อง **รันซ้ำได้ผลเดิมทุกตัวเลข** (มีเทสยืนยัน)
ขนาด: ~50 KB/run × 12 run/วัน ≈ 18 MB/เดือน → ยอมรับได้; ถ้าเกิน 500 MB ค่อยบีบอัด snapshot เก่า (นอก V1)

## 9. Backtest & Calibration (ข้อ 1)

- ข้อมูล: HF `full` (ทั้ง off/on) ย้อนหลัง 24 เดือน
- ต่อเดือน M, ต่อ checkpoint h ∈ {15, 7, 3, 1} วันก่อนสิ้นเดือน: ใช้เฉพาะข้อมูลที่ publish ก่อนเวลานั้น (ห้ามมองอนาคต) → รัน forecast
- ผลจริง = บริษัทที่ชนะใน publish สุดท้ายก่อน check time ของเดือน M (proxy ของการตัดสิน)
- วัด: Brier score, log loss, ตาราง calibration (bin 10%), อัตราทายถูก
- baseline: (ก) "leader ตอนนี้ชนะ 100%" (ข) ราคาตลาด Polymarket ณ checkpoint เดียวกัน (ถ้าหา event ย้อนหลังเจอ; ไม่เจอ → ระบุว่าไม่มีข้อมูล)
- fit `k`, `σ_floor` ด้วย grid search บน 12 เดือนแรก ประเมินบน 12 เดือนหลัง (กัน overfit) → เขียน `calibration.json` + `data/backtest/report.json`
- รัน: workflow รายเดือน (วันที่ 2) + สั่งเองได้

## 10. Dashboard (site/)

ภาษาไทย, รองรับมือถือ, ธีมสว่าง/มืดตามระบบ, 2 แท็บ: **Style Control ปิด / เปิด**
1. **สรุป** — นับถอยหลังถึง check time (แสดงเวลาไทย), % ท็อป 4 บริษัท, ราคาตลาด, คำแนะนำหนึ่งบรรทัด
2. **ตาราง edge** — บริษัท · ของเรา % · ตลาด mid · ซื้อได้จริง (@$100/$1,000) · EV · ป้าย "น่าซื้อ YES/NO" / "ไม่มี edge"
3. **เหตุผล** — bullet ภาษาไทยจาก `explain.js` (gap, CI ซ้อน, แนวโน้ม 3–7 วัน, อัตรา model ใหม่ของแต่ละบริษัท)
4. **สิ่งที่คุณรู้** — ต่อบริษัท: slider โอกาส model ใหม่ + delta → คำนวณใหม่ในเบราว์เซอร์ทันที, แสดงคู่กับตัวเลขทางการ, เก็บใน localStorage (ไม่ขึ้น git)
5. **กราฟ** — rating top-5 ย้อนหลัง 30 วัน · % ของเราเทียบราคาตลาดตลอดเดือน · การ์ด backtest (Brier ของเราเทียบตลาด + calibration)
6. **สถานะข้อมูล** — เวลาอัปเดตล่าสุด, publish date ของ leaderboard, ตาราง resolution risk; ถ้าข้อมูลเก่า → แถบแดง "ข้อมูลเก่า อย่าใช้ตัดสินใจ"
7. ราย model (พับไว้) — % ราย model

## 11. ตารางเวลา (GitHub Actions)

- `forecast.yml`: cron `17 */2 * * *` (ทุก 2 ชม.) + `*/30 * 28-31 * *` (script เช็คเองว่าอยู่ใน 72 ชม. สุดท้ายจริงถึงทำ, ไม่งั้นออก) + manual
- `backtest.yml`: `0 3 2 * *` + manual
- `pages.yml`: deploy `site/` + `data/latest`, `data/history`, `data/backtest` ทุกครั้งที่ main เปลี่ยน
- workflow ใช้ `concurrency` กัน run ซ้อน; GitHub cron อาจช้า 5–15 นาที — ยอมรับได้

## 12. Error handling

- ทุก request: timeout 30s, retry 3 ครั้ง (backoff 2/4/8s)
- แหล่งใดล้ม → ใช้ snapshot ล่าสุดที่ดีของแหล่งนั้น, `forecast.json.status` บอกว่าแหล่งไหนเก่า + เก่าแค่ไหน, ยังคง commit (audit)
- validate ไม่ผ่าน (schema ผิด, ไม่มี row overall, rating ไม่ใช่ตัวเลข) → ไม่ใช้ข้อมูลนั้น, status = danger
- workflow ล้มทั้งหมด → หน้าเว็บตรวจ `generated_at` เองและขึ้นแถบแดง
- ไม่มี secret ใดๆ ใน V1

## 13. Testing

`node --test` (ไม่มี dependency):
- `rules`: AutoEval ถูกตัด, เสมอ rank → score, เสมอ score → ตัวอักษร
- `simulate`: seed เดิม → ผลเดิม; leader ห่าง 100 แต้ม h=1 → >99%; สอง model เท่ากัน → ~50/50 (±2%); override prob=1 delta=+50 → บริษัทนั้นชนะ ~100%
- `edge`: walk orderbook (ข้ามหลายชั้น, liquidity ไม่พอ), fee ตามตัวอย่าง docs, EV
- `calendar`: check time 12:00 ET ทั้งช่วง EDT/EST, เดือน 28/30/31 วัน
- `risk`, `validate`: fixture ดี/เสีย
- `backtest`: ไม่มองอนาคต (fixture ที่มี model ขึ้นหลัง checkpoint ต้องไม่ถูกเห็น)
- `pipeline`: รันกับ fixture (ไม่มี network) → เขียนไฟล์ครบ, รันซ้ำจาก `inputs.json` ได้ผลเดิม
- smoke test หน้าเว็บด้วยการเปิดจริงตอนท้าย

## 14. Deploy

- GitHub repo ใหม่แบบ **public** (Pages + Actions ฟรี) — **ต้องถาม user ก่อนสร้าง/push** (ตามกฎ)
- ระหว่างนี้พัฒนาและทดสอบในเครื่อง: `node src/pipeline/run.js` + เปิด `site/` ผ่าน local static server

## 15. ความเสี่ยงที่ยอมรับ

- HF dataset อาจหยุดอัปเดตหรือเปลี่ยน schema → validate จับได้ + แถบแดง; แผนสำรองค่อยทำทีหลัง
- กติกา/slug ตลาดอาจเปลี่ยน → slug อยู่ใน config, description ของ event ถูกเก็บใน snapshot ทุกครั้ง
- Model ทางสถิติเรียบง่าย — ความน่าเชื่อถือวัดด้วย backtest และแสดงให้เห็นตรงๆ
- การใช้ Polymarket ต้องถูกกฎหมายในประเทศของผู้ใช้ — เครื่องมือนี้แค่วิเคราะห์ ไม่เทรดแทน
