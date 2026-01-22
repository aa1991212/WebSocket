const path = require("path");
const fs = require("fs");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const multer = require("multer");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "123456";

const UPLOAD_DIR = path.join("/tmp", "uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

app.use(express.static(path.join(__dirname, "public")));
app.use("/uploads", express.static(UPLOAD_DIR));

const upload = multer({ storage: multer.memoryStorage() });

function safeExt(mime, originalName) {
  const extFromName = path.extname(originalName || "").toLowerCase();
  const mimeMap = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "video/mp4": ".mp4",
    "video/webm": ".webm",
    "video/ogg": ".ogv",
    "video/quicktime": ".mov"
  };
  return mimeMap[mime] || extFromName || "";
}

app.post("/api/upload", upload.single("file"), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: "沒有收到檔案" });

    const mime = req.file.mimetype || "";
    const isImage = mime.startsWith("image/");
    const isVideo = mime.startsWith("video/");
    if (!isImage && !isVideo) return res.status(400).json({ ok: false, error: "只允許圖片或影片" });

    const ext = safeExt(mime, req.file.originalname);
    const id = crypto.randomBytes(10).toString("hex");
    const filename = `${Date.now()}_${id}${ext}`;
    fs.writeFileSync(path.join(UPLOAD_DIR, filename), req.file.buffer);

    res.json({ ok: true, url: `/uploads/${filename}`, kind: isVideo ? "video" : "image" });
  } catch (e) {
    res.status(500).json({ ok: false, error: "上傳失敗" });
  }
});

let settings = {
  barrageSpeed: 6,
  barrageDensity: 1,
  lanes: 10,
  bg: { type: "none", url: "" } // none | image | video
};
let bannedWords = [];
let laneCursor = 0;

function containsBanned(text) {
  return bannedWords.some(w => w && text.includes(w));
}

io.on("connection", (socket) => {
  socket.data.isAdmin = false;

  socket.emit("state", { settings, bannedWords });

  socket.on("adminLogin", (payload) => {
    const pwd = (payload?.password || "").toString();
    if (pwd === ADMIN_PASSWORD) {
      socket.data.isAdmin = true;
      socket.emit("adminLoginResult", { ok: true });
    } else {
      socket.emit("adminLoginResult", { ok: false, error: "密碼錯誤" });
    }
  });

  socket.on("sendDanmaku", (payload) => {
    const text = (payload?.text || "").toString().trim();
    const color = (payload?.color || "#ffffff").toString();
    if (!text) return;

    if (containsBanned(text)) {
      socket.emit("bannedAlert", { ok: false, error: "包含禁止詞" });
      return;
    }

    const lane = laneCursor % settings.lanes;
    laneCursor += 1;

    io.emit("danmaku", { text, color, lane });
  });

  socket.on("adminUpdateSettings", (payload) => {
    if (!socket.data.isAdmin) return;

    const next = { ...settings };
    if (typeof payload?.barrageSpeed === "number") next.barrageSpeed = Math.max(1, Math.min(20, payload.barrageSpeed));
    if (typeof payload?.barrageDensity === "number") next.barrageDensity = Math.max(1, Math.min(10, payload.barrageDensity));
    if (typeof payload?.lanes === "number") next.lanes = Math.max(4, Math.min(20, payload.lanes));

    settings = next;
    io.emit("state", { settings, bannedWords });
  });

  socket.on("adminSetBackground", (payload) => {
    if (!socket.data.isAdmin) return;

    const type = payload?.type;
    const url = (payload?.url || "").toString().trim();

    if (type === "none") {
      settings = { ...settings, bg: { type: "none", url: "" } };
      io.emit("state", { settings, bannedWords });
      return;
    }

    if ((type === "image" || type === "video") && url) {
      settings = { ...settings, bg: { type, url } };
      io.emit("state", { settings, bannedWords });
    }
  });

  socket.on("adminAddBanned", (payload) => {
    if (!socket.data.isAdmin) return;
    const word = (payload?.word || "").toString().trim();
    if (!word) return;
    if (!bannedWords.includes(word)) bannedWords.push(word);
    io.emit("state", { settings, bannedWords });
  });

  socket.on("adminRemoveBanned", (payload) => {
    if (!socket.data.isAdmin) return;
    const word = (payload?.word || "").toString().trim();
    bannedWords = bannedWords.filter(w => w !== word);
    io.emit("state", { settings, bannedWords });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log("Server running on port:", PORT));
