# Next Tasks

## V1 (กำลังออกแบบ)
- [ ] Brainstorm → spec → plan (ดู RESUME.md)

## V1 ที่เหลือ / ปรับปรุง (จาก backtest 2026-10-16)
- [ ] Risk ใหม่: vote_count ของอันดับ 1 ไม่เพิ่มขึ้นหลายวัน (เช่น Gemini 4 Argon ค้าง ~4,900) → อาจเป็น preliminary/AutoEval/ถูกถอด
- [ ] Risk ใหม่: model ที่ publish ในวันตัดสิน — HF อาจ publish หลังเที่ยง ET (ก.ย. 2026: HF บอก Google แต่ตลาดตัดสิน Anthropic)
- [ ] Backtest ใช้ผลตัดสินจริงของตลาดเป็นเฉลยในการ fit ด้วย (ตอนนี้ fit ด้วย HF proxy)
- [ ] ตลาดปี 2025 ใช้กติกาต่างจากปัจจุบัน + ชื่อ "xAI" → ตัดออกจากการเทียบ หรือ map ชื่อ
- [ ] Backtest ตลาด style control เปิด (รอ cache)

## V2 (จดไว้ ทำหลัง V1)
- [ ] ขนาดเงินแนะนำ — Fractional Kelly (เช่น ¼) + เพดานต่อเดือน
- [ ] Trade journal / P&L — จดการซื้อ, เหตุผล, สรุปรายเดือน, เทียบ "ตามระบบ" vs "ตามใจ" (เก็บในเบราว์เซอร์ ไม่ขึ้น git)
- [ ] รวม exposure ของตลาด style control ON/OFF (correlated)

## Later (หลัง V2)
- [ ] แจ้งเตือนเมื่อ edge เกินเกณฑ์ / มี model ใหม่ขึ้น
- [ ] Scenario analysis ("ถ้า model ใหม่ได้ +20 คะแนน")
- [ ] ตลาดอื่น (อันดับ 2, สิ้นปี, WebDev)
