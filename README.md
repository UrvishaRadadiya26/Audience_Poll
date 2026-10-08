# KUP Live Poll — Real-Time Audience Poll Web Application
**Inspired by the KBC-Style Live Audience Poll**  
*Application Name:* **KUP Live Poll** (*Kairavi + Urvisha + Purva*)

---

## 🌟 Overview

**KUP Live Poll** is a production-ready, real-time audience polling application built with **Node.js, Express.js, Socket.IO, HTML5, CSS3, Vanilla JavaScript, and Chart.js**.

It replicates the thrilling experience of a **Kaun Banega Crorepati (KBC)** live audience poll:
1. **Admin creates/edits questions** with 2 to 4 options (A, B, C, D).
2. **Admin starts the poll**, generating a session link (e.g., `http://localhost:3000/audience/KUP-4821`) and an instant **mobile QR code**.
3. **Audience joins** concurrently via phone, tablet, or browser by entering their name.
4. **Synchronized 2-Minute (120s) Timer** runs on the server, ensuring everyone shares the exact same deadline.
5. **Audience votes** for one option. Submissions are instantly locked to prevent double voting.
6. **Live Response Feed** streams votes in real time to the Admin dashboard.
7. **Poll Concludes**: Once the 2-minute timer ends, Chart.js displays the results on a **KBC-style bar chart** showing counts and percentages.
8. **Create New Poll**: Admin can reset and launch fresh questions with new session IDs.

No external databases (MongoDB, MySQL, PostgreSQL) are used. All state is maintained efficiently in server-side memory.

---

## 📂 Project Structure

```text
KUP-Live-Poll/
│
├── server.js                  # Main Express & Socket.IO server + Timer logic
├── package.json               # Project manifest and dependencies
├── README.md                  # Comprehensive documentation
│
├── data/
│   └── pollData.js            # In-memory store for polls, participants, and stats
│
└── public/
    ├── index.html             # Landing portal & quick audience join
    ├── admin.html             # Admin Dashboard (Editor, QR, Live Feed, Chart)
    ├── audience.html          # Mobile-friendly audience voting interface
    ├── result.html            # Studio / Big-screen TV projector presentation
    │
    ├── css/
    │   └── style.css          # KBC TV Quiz show theme & responsive design
    │
    └── js/
        ├── admin.js           # Admin panel Socket.IO & Chart.js logic
        ├── audience.js        # Audience client voting & countdown sync
        └── result.js          # Big screen presentation & celebration
```

---

## 🚀 Quick Start & Installation

### 1. Requirements
- Node.js (v16+ recommended; tested on Node.js v22+)
- npm (Node Package Manager)

### 2. Install Dependencies
In the project directory (`d:\my\pool`), run:
```bash
npm install
```
*(On Windows PowerShell if scripts are restricted, run `npm.cmd install`)*

### 3. Required npm Packages
- `express` (^4.19.2) — Web server & static file delivery
- `socket.io` (^4.7.5) — Real-time bidirectional WebSocket communication
- `qrcode` (^1.5.3) — Dynamic QR code generator for instant mobile audience scanning

### 4. Start the Application
```bash
npm start
```
or directly:
```bash
node server.js
```

### 5. Access URLs
- **Landing Page / Portal**: [http://localhost:3000](http://localhost:3000)
- **Admin Dashboard**: [http://localhost:3000/admin](http://localhost:3000/admin)
- **Audience Join**: [http://localhost:3000/audience](http://localhost:3000/audience)
- **Direct Audience Link with Poll ID**: `http://localhost:3000/audience/KUP-XXXX`
- **Big Screen / Projector View**: [http://localhost:3000/result](http://localhost:3000/result)

---

## ⚙️ How It Works: Technical Deep Dive

### 1. Server-Side Synchronized 2-Minute Timer
- When the Admin clicks **START POLL**, the server marks `startTime = Date.now()` and `endTime = startTime + (120 * 1000)`.
- A 1-second interval (`setInterval`) calculates the remaining time:
  $$\text{remainingSeconds} = \max\left(0, \left\lfloor \frac{\text{poll.endTime} - \text{Date.now()}}{1000} \right\rfloor\right)$$
- The server emits `timerUpdate` every second to all connected audience members and the admin.
- **Client Synchronization & Refresh Resilience**: If an audience member refreshes their browser or connects midway (e.g., at second 45), the server immediately calculates their remaining time based on `endTime - Date.now()`, preventing client timer tampering.
- When `remainingSeconds <= 0`, the timer automatically triggers the `pollEnded` event and seals the poll from any further submissions.

### 2. Real-Time Response Collection & Counting
- Each audience member is assigned a persistent `participantId` stored in their browser's `localStorage`.
- When an audience member clicks **SUBMIT ANSWER**, the server validates:
  1. Is the poll currently `active`?
  2. Is remaining time $> 0$?
  3. Has this participant already submitted?
  4. Is the option valid (A, B, C, or D)?
- If valid:
  - Participant is marked as `submitted = true`.
  - The response counter for that option is incremented: `responses[optionId]++`.
  - The server emits `responseSubmitted` to the voter, locking their UI.
  - The server broadcasts `updateResponseCount` in real time to the Admin dashboard and big-screen displays.

### 3. Chart.js Bar Chart & Statistical Results
- When the poll closes (or upon request), the server calculates:
  - **Total Audience Joined**: Number of participants registered in `poll.audience`.
  - **Total Responses**: Sum of all votes cast.
  - **Unanswered**: $\text{Total Audience} - \text{Total Responses}$.
  - **Option Percentage**: $\frac{\text{Count for Option}}{\text{Total Responses}} \times 100\%$.
- The Admin dashboard and the `/result` page instantiate a Chart.js **Bar Chart**:
  - Distinct KBC theme colors: Option A (Gold), Option B (Cyan), Option C (Electric Blue), Option D (Neon Pink).
  - Smooth 1200ms ease-out animations.
  - Hover tooltips displaying exact vote count and percentage.
  - Accompanying metric badges showing Unanswered participants.

---

## 📡 Socket.IO Event Reference

### Admin Events
| Event Name | Direction | Payload | Description |
|---|---|---|---|
| `adminConnect` | Client $\to$ Server | None | Admin connects and requests active poll state |
| `adminState` | Server $\to$ Client | `{ poll, results, remainingSeconds }` | Sends complete current state to Admin |
| `adminCreatePoll` | Client $\to$ Server | `{ question, options, duration }` | Creates a new poll session |
| `adminUpdatePoll` | Client $\to$ Server | `{ question, options }` | Updates question & options before starting |
| `startPoll` | Client $\to$ Server | None | Starts 2-minute countdown and opens voting |
| `endPoll` | Client $\to$ Server | `{ pollId }` | Manually stops the poll before 2 minutes |
| `createNewPoll` | Client $\to$ Server | `{ question, options, duration }` | Resets for the next question |
| `requestPollResults` | Client $\to$ Server | `{ pollId }` | Requests final results |

### Audience Events
| Event Name | Direction | Payload | Description |
|---|---|---|---|
| `joinPoll` | Client $\to$ Server | `{ pollId, participantId, name }` | Audience member joins with name |
| `audienceJoined` | Server $\to$ Client | `{ success, pollId, question, options, status, remainingSeconds, participant }` | Confirms join and delivers initial poll state |
| `pollStarted` | Server $\to$ Client | `{ pollId, question, options, duration, remainingSeconds, formattedTime }` | Broadcast to all when poll starts |
| `submitResponse` | Client $\to$ Server | `{ pollId, participantId, optionId }` | Audience member submits vote (A, B, C, or D) |
| `responseSubmitted` | Server $\to$ Client | `{ success, optionId, message }` | Confirms vote and locks options |
| `pollEnded` | Server $\to$ Client | `{ pollId, message, results }` | Broadcast to all when timer reaches 00:00 |

### Real-Time Synchronization Events
| Event Name | Direction | Payload | Description |
|---|---|---|---|
| `timerUpdate` | Server $\to$ All | `{ pollId, remainingSeconds, formattedTime }` | Broadcast every 1s |
| `updateAudienceCount` | Server $\to$ Admin | `{ pollId, totalAudience }` | Broadcast when new participant connects |
| `updateResponseCount` | Server $\to$ Admin | `{ pollId, responses, totalResponses, totalAudience, breakdown }` | Broadcast whenever a vote is cast |
| `pollResult` | Server $\to$ Admin/TV | Full statistical results object | Emitted when poll ends or requested |

---

## 🧪 Testing Multiple Audience Members

To test with multiple participants on a single computer or local network:

1. **Start the server**:
   ```bash
   node server.js
   ```
2. **Open Admin Dashboard**:
   Open Chrome: `http://localhost:3000/admin`
   - Notice the generated Poll ID (e.g. `KUP-4821`).
   - Edit the question if desired, or keep the default.
   - Click the **📱 QR Code** button or copy the link: `http://localhost:3000/audience/KUP-4821`.
3. **Open Multiple Audience Members**:
   - **Tab 1 (Incognito Chrome)**: Open `http://localhost:3000/audience/KUP-4821`, enter name "Kairavi", click **JOIN LIVE POLL**.
   - **Tab 2 (Edge Browser)**: Open `http://localhost:3000/audience/KUP-4821`, enter name "Urvisha", click **JOIN LIVE POLL**.
   - **Tab 3 (Firefox or 2nd Incognito)**: Open `http://localhost:3000/audience/KUP-4821`, enter name "Purva", click **JOIN LIVE POLL**.
   - **Mobile Phone (Same Wi-Fi)**: Open `http://<your-local-ip>:3000/audience/KUP-4821` or scan the QR code!
4. **Observe Admin Dashboard**:
   - Total Audience counter increments to **3** (or however many joined) in real time!
5. **Click "START POLL" on Admin Dashboard**:
   - The 2-minute countdown timer synchronizes across all tabs (`02:00` $\to$ `01:59`...).
   - Each audience tab reveals the question and options A, B, C, D.
6. **Cast Votes**:
   - Kairavi votes Option **C**.
   - Urvisha votes Option **C**.
   - Purva votes Option **B**.
   - As each person clicks **SUBMIT ANSWER**, their response locks immediately, and the Admin live bar updates in real time!
7. **Wait for 2-Minute Timer or Click "End Poll"**:
   - Final results calculate automatically.
   - Admin and Big Screen display the **Bar Chart** with percentages, counts, and unanswered metrics!
8. **Click "CREATE NEW POLL"**:
   - Admin prepares the next question with a new session code.

---

## 👑 Credits
Designed and developed for **KUP Live Poll** (*Kairavi + Urvisha + Purva*).
KBC-style television quiz experience with zero database dependencies.
