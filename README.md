# 🏎️ Polytrack Replay Toolkit

A Node.js and browser-compatible toolkit for interacting with the **Polytrack** racing game's backend.  
Supports reverse-engineered replay serialization, deserialization, user generation, and leaderboard submission.

---

## 📦 Features

- 🔧 **Reverse engineered** replay format (`up`, `right`, `down`, `left`, `reset`)
- 🧩 **Deflate compression** and Base64 URL-safe encoding (fully compatible with game's `Yg.Deflate`)
- 👤 **User system**: generate valid SHA-256 tokens, random nicknames, and car color codes
- 🌐 **API client**: supports all official endpoints:
  - `GET /user`
  - `GET /leaderboard`
  - `GET /recordings`
  - `POST /leaderboard` (submit ghost run)
- 🔁 Modify replays (e.g., inject new frames) and resubmit them

---

## 🚀 Getting Started

### 1. Install Dependencies

```bash
npm install pako
````

### 2. Run the Script

```bash
node your-script.js
```

Or open the code in browser console after defining `Yg` in-game.

---

## 📄 Usage Example

```js
const user = await User.randomUser();
await polytrackApi.submitUser(user);

const recording = await api.getRecordings("123456");
const movement = MovementSerializer.deserialize(recording[0].recording);

// Modify and reserialize
movement.down.push(10000);
const serialized = serializeAndCompress(movement);

await api.submitLeaderboard({
  userToken: user.token,
  name: user.name,
  carColors: user.carColors,
  trackId: "...",
  frames: 1234,
  recording: serialized,
});
```

---

## 📚 Project Structure

* `User`: Handles token generation, user creation, and car colors
* `YgDeflatePort`: Compatible Deflate wrapper using `pako`
* `MovementSerializer`: Decodes and encodes replay binary format
* `PolytrackApi`: Wrapper for all backend API calls
* `serializeAndCompress`: Utility to compress replay frames
* `main()`: Example automation of getting a ghost, editing it, and re-uploading

---

## ⚠️ Disclaimer

This project is for **educational and research purposes only**.
Misuse of the code or submission of falsified records may violate the game’s terms of service.
