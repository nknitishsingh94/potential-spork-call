# potential-spork-call

A WebRTC Video and Audio calling application with **Zero-Busy Response Architecture**, Call Waiting, Group Call Merging, and System AudioFocus / WhatsApp Interruption handling.

## ✨ Key Features
- **Unique Caller ID:** Every user gets a 6-digit ID (e.g. `842-195`) without requiring user registration.
- **Audio & Video Calling:** Direct one-click 📹 Video Call or 🎙️ Audio-only Call.
- **Never USER_BUSY:** If a receiver is on WhatsApp, a phone call, or another active call in this app, callers always receive `RINGING...` (never `USER_BUSY`).
- **Call Waiting & Group Merge:** Receivers get a non-intrusive Call Waiting HUD with options to merge incoming calls into a group conference or switch calls.
- **Interruption Handling:** Resilient against Android/iOS audio focus loss (e.g. WhatsApp or cellular calls).
- **UNAVAILABLE Only on Offline / Timeout:** Server only emits `UNAVAILABLE` if the receiver is unreachable or fails to answer after 35 seconds.

## 🚀 Quick Start
```bash
# 1. Install dependencies
npm install

# 2. Start the calling server
node server.js
```
Open [http://localhost:3000](http://localhost:3000) in your browser.
