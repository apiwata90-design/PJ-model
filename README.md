# Arena #1 Forecast

ทายว่า **บริษัท/model ไหนจะเป็นอันดับ 1** บน arena.ai Text Arena (Overall) ตอนที่ Polymarket ตัดสิน
(12:00 PM เวลา New York วันสุดท้ายของเดือน) ทั้งตลาด **Style Control ปิด** และ **เปิด**
แล้วเทียบกับราคาที่ซื้อได้จริงใน orderbook (หักค่าธรรมเนียม + slippage)

- Spec: `docs/superpowers/specs/2026-10-16-arena-forecast-design.md`
- Plan: `docs/superpowers/plans/2026-10-16-arena-forecast.md`

## ใช้งานในเครื่อง

ต้องมี Node 20 ขึ้นไป ไม่มี dependency ให้ติดตั้ง

```bash
npm test                       # เทสทั้งหมด (ไม่ใช้ network)
node scripts/warm-history.js   # ครั้งแรก: ดึงประวัติ leaderboard ~2.5 ปี (ช้า 10-30 นาที)
npm run run                    # ดึงข้อมูลล่าสุด + คำนวณ -> data/latest/forecast.json
npm run backtest -- --market   # ทดสอบย้อนหลัง 24 เดือน + fit calibration
npm run serve                  # เปิด http://localhost:8787/site/
```

## ปรับแต่ง

| ไฟล์ | ใช้ทำอะไร |
|---|---|
| `config/overrides.json` | `autoEval`: ชื่อ model ที่ติดป้าย AutoEval บน arena.ai (ถูกตัดออกตามกติกาตลาด) · `preliminary`: model ที่ติดป้าย Preliminary (ยังนับ แต่ขึ้นเตือนความเสี่ยง) · `news`: ข่าวที่มีผลกับผลทายทางการ เช่น `{"OpenAI": {"prob": 0.5, "delta": 15}}` |
| `config/companies.json` | จับคู่ organization ใน HF → ชื่อบริษัทใน Polymarket |
| `config/markets.json` | กำหนด slug ตลาดเองถ้าค้นหาอัตโนมัติไม่เจอ: `{"2026-11": {"off": "...", "on": "..."}}` |
| `config/settings.json` | เกณฑ์ edge, stake, จำนวนรอบจำลอง ฯลฯ |
| `config/calibration.json` | เขียนโดย backtest |

## Deploy (GitHub Pages)

1. สร้าง repo **public** แล้ว push
2. Settings → Pages → Source: **GitHub Actions**
3. Actions → `forecast` → Run workflow (ครั้งแรก) จากนั้นระบบจะรันเองทุก 2 ชม.

## Audit trail

ทุกครั้งที่รันจะเก็บข้อมูลดิบ + input + ผลไว้ที่ `data/snapshots/<วันที่>/<เวลา>Z/`
รันซ้ำได้ผลเดิม: `simulate(inputs.simInputs.off)` จะได้ตัวเลขเดียวกับ `forecast.json`

> เครื่องมือวิเคราะห์เท่านั้น — ไม่เทรดแทน ไม่แตะ wallet และไม่ใช่คำแนะนำการลงทุน
