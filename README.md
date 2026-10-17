# 🎵 MAITEMBATH GANG PARTY

> **Collaborative In-Car Party Music & Video Console**
> แพลตฟอร์มเปิดเพลงและควบคุมปาร์ตี้ร่วมกันแบบ Real-time รองรับทั้งหน้าจอหลัก (Host Display) และมือถือของผู้โดยสารทุกคน (Mobile Remote)

---

## ✨ ไฮไลท์ฟีเจอร์ (Key Features)

- **🎶 Real-time Collaborative Queue:** ทุกคนในรถหรือในปาร์ตี้สามารถสแกน QR Code เข้ามาช่วยกันเพิ่มเพลงจาก YouTube / Spotify จัดคิว และลบเพลงได้ทันที
- **⏭️ Universal 3-Tap Direct Skip:** ทุกคนสามารถกดข้ามเพลงได้โดยตรง เพียงกดปุ่มข้าม 3 ครั้งเพื่อป้องกันการกดพลาด พร้อมไฟสถานะแสดงผลชัดเจน
- **📱 Mobile Responsive & Smooth Playback:** รองรับการเปิดบนสมาร์ตโฟนแนวตั้ง วิดีโอไหลลื่น ไม่กระตุก พร้อมปุ่มปลดล็อกเสียงเมื่อเบราว์เซอร์บล็อก Autoplay
- **💬 Flying Danmaku & Floating Emojis:** พิมพ์ข้อความหรือส่งอีโมจิลอยผ่านหน้าจอวิดีโอแบบสดๆ เพิ่มความสนุกในห้องโดยสาร
- **📢 Thai TTS Voice Announcements:** ระบบเสียงพูดภาษาไทยสังเคราะห์อัตโนมัติเมื่อมีคนเพิ่มเพลงใหม่เข้าคิว
- **🎛️ DJ Party Soundboard:** ปุ่มซาวด์เอฟเฟกต์ปาร์ตี้สุดมันส์ (แตรลม, ตบมุก, ปรบมือ, ไซเรน ฯลฯ) พร้อมระบบ Ducking ลดเสียงเพลงชั่วคราวให้อัตโนมัติ
- **🗺️ GPS Radar & Weather Radar:** แผนที่นำทางสดพร้อมเรดาร์ตรวจสภาพอากาศและเส้นทางข้างหน้า
- **🤖 Smart Auto-DJ:** เมื่อคิวเพลงหมด ระบบจะสุ่มเพลงฮิตมาเล่นต่อให้อัตโนมัติตามโหมดที่ตั้งไว้ (เคลิ้มๆ, สายตี้, อินดี้ไทย, 90s ฯลฯ)

---

## 🚀 วิธีติดตั้งและรันโปรเจกต์ (Getting Started)

### ความต้องการของระบบ (Prerequisites)
- [Node.js](https://nodejs.org/) (เวอร์ชัน 18 ขึ้นไป แนะนำเวอร์ชัน 20 LTS)

### ขั้นตอนการรัน (Installation)

1. **โคลนโปรเจกต์:**
   ```bash
   git clone <YOUR_GITHUB_REPO_URL>
   cd MAITEMBATH-GANG-PRATY-main
   ```

2. **ติดตั้ง Dependencies:**
   ```bash
   npm install
   ```

3. **เริ่มรันเซิร์ฟเวอร์:**
   ```bash
   npm start
   ```

4. **เข้าใช้งาน:**
   - **บนคอมพิวเตอร์ / หน้าจอหลัก (Host):** เปิดเบราว์เซอร์ไปที่ `http://localhost:3000`
   - **บนมือถือ (Guest / Passengers):** เชื่อมต่อ Wi-Fi หรือ Hotspot เดียวกัน แล้วสแกน **QR Code** บนหน้าจอหลักเพื่อเข้าร่วมปาร์ตี้

---

## 📁 โครงสร้างโปรเจกต์ (Project Structure)

```text
├── public/                 # ไฟล์ Frontend ทั้งหมด
│   ├── index.html          # หน้าจอหลัก (HTML5 + TailwindCSS)
│   ├── style.css           # สไตล์ตกแต่งเพิ่มเติม
│   ├── PNRJAPANLOGO.png    # โลโก้แบรนด์
│   ├── favicon.ico         # ไอคอนแท็บเบราว์เซอร์
│   ├── app.js              # Entrypoint สำหรับฝั่ง Client
│   └── js/                 # โมดูล JavaScript (ES Modules)
│       ├── audio.js        # เครื่องเล่นวิดีโอ/เสียง และ Web Audio Synthesizer
│       ├── avatars.js      # ระบบโปรไฟล์และอวาตาร์
│       ├── favorites.js    # ระบบบันทึกเพลงโปรด
│       ├── history.js      # บันทึกประวัติการเล่นเพลง
│       ├── lyrics.js       # ระบบดึงและแสดงเนื้อเพลง/คาราโอเกะ
│       ├── main.js         # Bootstrap และการผูก Event เริ่มต้น
│       ├── map.js          # แผนที่ GPS และเรดาร์สภาพอากาศ
│       ├── queue.js        # การจัดการคิวและปุ่มข้าม 3 ครั้ง
│       ├── socket.js       # จัดการการเชื่อมต่อ Socket.IO แบบ Real-time
│       ├── state.js        # ศูนย์กลางจัดการ State ภายในแอพ
│       └── ui.js           # การควบคุมและเรนเดอร์ UI
├── tests/                  # ชุดทดสอบอัตโนมัติ (Automated Verification Suites)
├── server.js               # เซิร์ฟเวอร์ Node.js Express + Socket.IO Backend
├── package.json            # การกำหนด dependencies และสคริปต์
└── .gitignore              # กำหนดไฟล์ที่ไม่ต้องอัปโหลดขึ้น Git
```

---

## 🧪 การรันชุดทดสอบ (Testing)

```bash
# รันการทดสอบฟังก์ชันและการซิงค์ข้อมูล (21 รายการ)
node tests/verify_suite.js

# รันการทดสอบความปลอดภัยและการทำงานภายใต้สภาวะรุนแรง (22 รายการ)
node tests/tier5_adversarial_suite.js
```

---

## 📜 ลิขสิทธิ์ (License)

ISC License - พัฒนาเพื่อความบันเทิงในกลุ่มเพื่อน **MAITEMBATH GANG** 🚗💨
