# NAMNUAH PARTY (❁´◡`❁) 🎵
**Collaborative Queue Music Player (Elegant Dark Theme)**

ระบบคิวเพลงที่ให้ผู้ใช้งานสามารถร่วมกันส่งลิงก์วิดีโอจาก YouTube เข้าคิวเพื่อเล่นบนหน้าจอหลัก (Host Screen) พร้อมระบบควบคุมผ่านมือถือและฟีเจอร์เพิ่มสีสันในปาร์ตี้ เช่น ระบบส่งรีแอคชันและข้อความวิ่งบนหน้าจอ (Danmaku) ในธีม Elegant Dark สไตล์หรูหราสีดำ-ทอง

## 🌟 Features (คุณสมบัติเด่น)

- **🎶 YouTube Integration:** ค้นหาและดึงคลิป/เพลงจาก YouTube มาเล่นผ่านคิวได้อย่างลื่นไหล
- **📱 Remote Control (Mobile Ready):** ควบคุมการเล่นเพลง เพิ่มคิว ข้ามเพลง หรือปรับเสียงผ่านหน้าจอมือถือได้ง่ายๆ ด้วยการสแกน QR Code (มีระบบแยกแท็บควบคุมและแท็บดูคิวเพลง)
- **😂 Mood Reactions:** ปุ่มกดส่งอีโมจิ (😍, 👍, 👎) จากมือถือให้ลอยขึ้นไปบนจอหลักแบบเรียลไทม์
- **💬 Danmaku Comments:** ระบบพิมพ์ข้อความจากมือถือให้เลื่อนผ่านหน้าจอหลัก (ซ้ายไปขวา) คล้ายกับระบบคอมเมนต์บนแพลตฟอร์มสตรีมมิ่ง
- **💎 Elegant Dark Theme:** ดีไซน์เรียบหรูสไตล์ Glassmorphism ด้วยโทนสีดำ (Obsidian Black) ตัดกับสีทอง (Luxury Gold)
- **🗳️ Vote to Skip:** ระบบโหวตข้ามเพลง หากมีคนโหวตเกินครึ่งหนึ่งของจำนวนผู้ใช้งานออนไลน์ เพลงจะถูกข้ามอัตโนมัติ

## 🛠️ Tech Stack (เทคโนโลยีที่ใช้)

- **Frontend:** HTML5, Tailwind CSS, Vanilla JavaScript, YouTube Iframe API
- **Backend:** Node.js, Express.js
- **Real-time Communication:** Socket.io
- **Others:** QRCode.js

## 🚀 How to Run (วิธีเปิดใช้งานบนเครื่องตัวเอง)

1. ดาวน์โหลดหรือ Clone โปรเจกต์นี้
2. ตรวจสอบว่าในเครื่องติดตั้ง [Node.js](https://nodejs.org/) เรียบร้อยแล้ว
3. เปิด Terminal แล้วเข้าไปที่โฟลเดอร์โปรเจกต์
4. รันคำสั่งติดตั้ง dependencies:
   ```bash
   npm install
   ```
5. รันเซิร์ฟเวอร์:
   ```bash
   npm start
   ```
6. เปิดเบราว์เซอร์แล้วไปที่: `http://localhost:3000`

## 🌐 How to Deploy (วิธีอัปโหลดขึ้นเซิร์ฟเวอร์สาธารณะฟรี)

แนะนำให้อัปโหลดขึ้น **Render.com** 
1. สร้างบัญชี GitHub และอัปโหลดไฟล์ในโฟลเดอร์นี้ทั้งหมดขึ้นไปเป็น Repository
2. สมัครบัญชี [Render.com](https://render.com/) แนะนำให้ล็อกอินด้วย GitHub
3. กด **New +** > **Web Service**
4. เลือก Repository ที่เพิ่งอัปโหลดไป
5. ตั้งค่า:
   - **Environment:** `Node`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
6. เลือกแผน **Free** และกด Create Web Service รอประมาณ 2-3 นาที คุณก็จะได้ลิงก์เว็บไซต์สาธารณะที่เปิดได้ 24 ชั่วโมง!
