/**
 * Polytrack Replay Tool – Reverse Engineering & API Toolkit
 *
 * This file is the result of extensive reverse engineering work on the game "Polytrack,"
 * focused on understanding how replays are serialized, how user data is handled,
 * and how the game communicates with its backend server via HTTP API.
 *
 * ✅ Goals and Features Implemented:
 * 
 * • Reverse engineered the minified/obfuscated game code to understand:
 *   – The replay format: how movement data is stored (up/right/down/left/reset)
 *   – Use of Deflate compression and Base64 URL-safe encoding
 *   – API calls to the server at `vps.kodub.com:43273`
 *
 * • Implemented in Node.js and browser-compatible JS:
 *   – Replay serializer and deserializer that match the game’s binary format
 *   – `User` class for generating and saving valid users (with SHA256 token + car colors)
 *   – `YgDeflatePort` class to compress/decompress binary data using Pako
 *   – `MovementSerializer` to convert Base64-encoded data into readable frame arrays
 *   – `PolytrackApi` class for interacting with the API (get user, leaderboard, recordings, and submit)
 *
 * ✅ Supports:
 *   – Creating and registering a new user on the server
 *   – Cloning and modifying another player's replay (e.g., to fake a finish)
 *   – Running and testing all features directly in the browser console or Node.js
 *
 * 🛠 Debugging Steps Taken:
 *   – Compared server-generated replays with manually crafted ones
 *   – Fixed malformed Uint8Array JSON conversions
 *   – Reconstructed `encodeFrames` logic and custom binary parsing
 *   – Replaced original `Yg.Deflate` with Pako for server-side compression
 *
 * ⚠️ Disclaimer:
 *   – This file was created for technical learning and research purposes only.
 *   – Misuse may violate the game’s terms of service.
 *
 * Author: Carlo Pezzotti
 * Year: 2025
 */
const pako = require('pako');

class User {
    constructor(token, name, carColors) {
        if (!User.isValidToken(token)) {
            throw new Error("Invalid token");
        }
        this.token = token;
        this.name = name;
        this.carColors = carColors;
    }

    static createToken() {
        let entropy = "";
        try {
            const buf = new Uint8Array(32);
            crypto.getRandomValues(buf);
            entropy += Array.from(buf).join(",");
        } catch (_) { }
        try {
            entropy += crypto.randomUUID();
        } catch (_) { }
        if (!entropy) {
            throw new Error("Failed to generate user token");
        }
        return crypto.subtle.digest("SHA-256", new TextEncoder().encode(entropy))
            .then(hashBuf => {
                const hashArray = Array.from(new Uint8Array(hashBuf));
                return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
            });
    }

    static isValidToken(token) {
        return /^[0-9a-f]{64}$/.test(token);
    }

    static randomHex(length) {
        const chars = [];
        const bytes = new Uint8Array(length / 2);
        crypto.getRandomValues(bytes);
        for (let b of bytes) {
            chars.push(b.toString(16).padStart(2, "0"));
        }
        return chars.join("").slice(0, length);
    }

    static async randomUser() {
        const token = await User.createToken();
        // random nickname: user_ + 6 hex chars
        const name = "user_" + User.randomHex(6);
        // carColors: 24‐char hex string
        const carColors = User.randomHex(24);
        return new User(token, name, carColors);
    }
}

class YgDeflatePort {
    constructor(opts = {}) {
        this.opts = {
            level: 9,
            windowBits: 15,
            memLevel: 8,
            strategy: 0,
            ...opts
        };
    }

    static objectToUint8Array(obj) {
        const keys = Object.keys(obj)
            .filter(k => /^\d+$/.test(k))
            .map(k => parseInt(k, 10));
        if (!keys.length) return new Uint8Array();
        const max = Math.max(...keys);
        const arr = new Uint8Array(max + 1);
        for (const i of keys) {
            arr[i] = obj[i] & 0xFF;
        }
        return arr;
    }

    deflateToBase64Url(input) {
        let raw;
        if (input instanceof Uint8Array) {
            raw = input;
        } else if (Buffer.isBuffer(input)) {
            raw = new Uint8Array(input);
        } else {
            raw = YgDeflatePort.objectToUint8Array(input);
        }
        const compressed = pako.deflate(raw, {
            level: this.opts.level,
            windowBits: this.opts.windowBits,
            memLevel: this.opts.memLevel,
            strategy: this.opts.strategy
        });
        return Buffer.from(compressed).toString('base64')
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/, '');
    }

    inflateFromBase64Url(b64url) {
        let b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
        while (b64.length % 4) b64 += '=';
        const buf = Buffer.from(b64, 'base64');
        return pako.inflate(buf, {
            windowBits: this.opts.windowBits
        });
    }
}

class MovementSerializer {
    static _parseFrames(buf, offset) {
        const N = buf[offset] | (buf[offset + 1] << 8) | (buf[offset + 2] << 16);
        const frames = new Array(N);
        let ptr = offset + 3;
        let prev = 0;
        for (let i = 0; i < N; i++) {
            const delta = buf[ptr] | (buf[ptr + 1] << 8) | (buf[ptr + 2] << 16);
            ptr += 3;
            const val = (i === 0 ? delta : prev + delta);
            frames[i] = val;
            prev = val;
        }
        return { frames, nextOffset: ptr };
    }

    static deserialize(b64url) {
        const compressor = new YgDeflatePort();
        let raw;
        try {
            raw = compressor.inflateFromBase64Url(b64url);
        } catch (err) {
            return null;
        }
        let offset = 0;
        const upRes = MovementSerializer._parseFrames(raw, offset);
        offset = upRes.nextOffset;
        const rightRes = MovementSerializer._parseFrames(raw, offset);
        offset = rightRes.nextOffset;
        const downRes = MovementSerializer._parseFrames(raw, offset);
        offset = downRes.nextOffset;
        const leftRes = MovementSerializer._parseFrames(raw, offset);
        offset = leftRes.nextOffset;
        const resetRes = MovementSerializer._parseFrames(raw, offset);
        return {
            up: upRes.frames,
            right: rightRes.frames,
            down: downRes.frames,
            left: leftRes.frames,
            reset: resetRes.frames
        };
    }
}

class PolytrackApi {
    constructor({ baseUrl = 'https://vps.kodub.com:43273', version = '0.5.0' } = {}) {
        this.baseUrl = baseUrl;
        this.version = version;
    }

    _headers() {
        return {
            'Accept': '*/*',
            'Accept-Language': 'it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7',
            'Content-Type': 'application/x-www-form-urlencoded',
        };
    }

    async submitUser(user, version = "0.5.0") {
        const body = new URLSearchParams({
            version,
            userToken: user.token,
            name: user.name,
            carColors: user.carColors
        }).toString();

        const url = new URL(`${this.baseUrl}/user`);
        return await fetch(url.toString(), {
            method: "POST",
            headers: {
                "Accept": "*/*",
                "Content-Type": "application/x-www-form-urlencoded"
            },
            body
        });
    }

    async getUser(userToken) {
        const url = new URL(`${this.baseUrl}/user`);
        url.searchParams.set('version', this.version);
        url.searchParams.set('userToken', userToken);
        let res = await fetch(url.toString(), {
            method: 'GET',
            headers: this._headers(),
        })
        if (!res.ok) {
            throw new Error(`getUser failed: ${res.status}`);
        }
        let data = await res.json();
        return data;
    }

    async getLeaderboard({ trackId, skip = 0, amount = 20, onlyVerified = true }) {
        const url = new URL(`${this.baseUrl}/leaderboard`);
        url.searchParams.set('version', this.version);
        url.searchParams.set('trackId', trackId);
        url.searchParams.set('skip', skip);
        url.searchParams.set('amount', amount);
        url.searchParams.set('onlyVerified', onlyVerified);
        let res = await fetch(url.toString(), {
            method: 'GET',
            headers: this._headers(),
        });
        if (!res.ok) {
            throw new Error(`getLeaderboard failed: ${res.status}`);
        }
        let data = await res.json();
        return data;
    }

    async getRecordings(recordingIds) {
        const idsParam = Array.isArray(recordingIds)
            ? recordingIds.join(',')
            : recordingIds;

        const url = new URL(`${this.baseUrl}/recordings`);
        url.searchParams.set('version', this.version);
        url.searchParams.set('recordingIds', idsParam);

        let res = await fetch(url.toString(), {
            method: 'GET',
            headers: this._headers(),
        });
        if (!res.ok) {
            throw new Error(`getRecordings failed: ${res.status}`);
        }
        let data = await res.json();
        return data;
    }

    async submitLeaderboard({ userToken, name, carColors, trackId, frames, recording }) {
        const url = `${this.baseUrl}/leaderboard`
        const body = new URLSearchParams({
            version: this.version,
            userToken: userToken,
            name: name,
            carColors: carColors,
            trackId: trackId,
            frames: String(frames),
            recording: recording,
        }).toString()

        const res = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                ...this._headers()
            },
            body
        })
        if (!res.ok) {
            throw new Error(`submitLeaderboard failed: ${res.status}`)
        }
        const text = await res.text()
        let parsed
        try {
            parsed = JSON.parse(text)
        } catch (err) {
            throw new Error(`Error parsing response JSON: ${err.message}`)
        }
        const uploadId = Number.parseInt(parsed, 10)
        if (!Number.isSafeInteger(uploadId)) {
            throw new Error(`Invalid uploadId: ${parsed}`)
        }
        return { uploadId }
    }
}


function encodeFrames(frames) {
    const N = frames.length;
    const buf = new Uint8Array(3 + 3 * N);
    buf[0] = N & 0xFF;
    buf[1] = (N >>> 8) & 0xFF;
    buf[2] = (N >>> 16) & 0xFF;
    for (let i = 0; i < N; i++) {
        const delta = i === 0 ? frames[i] : frames[i] - frames[i - 1];
        const off = 3 + 3 * i;
        buf[off] = delta & 0xFF;
        buf[off + 1] = (delta >>> 8) & 0xFF;
        buf[off + 2] = (delta >>> 16) & 0xFF;
    }
    return buf;
}


function serializeMovement(m) {
    const parts = [
        encodeFrames(m.up),
        encodeFrames(m.right),
        encodeFrames(m.down),
        encodeFrames(m.left),
        encodeFrames(m.reset),
    ];
    const total = parts.reduce((sum, p) => sum + p.length, 0);
    const out = new Uint8Array(total);
    let off = 0;
    for (const p of parts) {
        out.set(p, off);
        off += p.length;
    }
    return out;
}

function serializeAndCompress(movement) {
    const raw = serializeMovement(movement);
    const compressor = new YgDeflatePort({ level: 9 });
    return compressor.deflateToBase64Url(raw);
}


async function main() {
    let trackID = "7a0e04bfe09e1bead36ddd2f7e61d32fd6c1e55e907d60edc6ccd3e17532e1f7"
    let name = "[put your name here]";

    const polytrackApi = new PolytrackApi();
    let leaderboard = (await polytrackApi.getLeaderboard({
        trackId: trackID,
        ammount: 1,
    })).entries;
    let time = leaderboard[0].frames;
    const recording = await polytrackApi.getRecordings(leaderboard[0].id);
    let serializedMovement = recording[0].recording;
    const movement = MovementSerializer.deserialize(serializedMovement);
    movement.down.push(time - 100, time - 50);
    const reSerialized = serializeAndCompress(movement);
    const user = await User.randomUser();
    user.name = name;
    console.log("Generated user:", user);
    const userData = await polytrackApi.submitUser(user);
    if (userData.ok) {
        console.log("User successfully created on server");
    } else {
        console.error("Server error:", res.status);
    }

    try {
        const result = await polytrackApi.submitLeaderboard({
            userToken: user.token,
            name: user.name,
            carColors: user.carColors,
            trackId: trackID,
            frames: time + 1,
            recording: reSerialized
        });
        console.log("Upload ID:", result.uploadId);
    } catch (error) {
        console.error("Errore durante l'invio alla leaderboard:", error.message);
    }
}

main()