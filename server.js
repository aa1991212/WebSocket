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

// ====== 你可以改這裡：管理員密碼（也可用 Render 環境變數 ADMIN_PASSWORD） ======
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "123456";

// ====== 上傳檔存放（Render 上是暫存，重啟會消失；現場活動通常足夠）=====
const UPLOAD_DIR = path.join("/tmp", "uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ====== 靜態目錄 ======
app.use(express.static(path.join(__dirname, "public")));
app.use("/uploads", express.static(UPLOAD_DIR));

// ====== 上傳：memory -> 落地到 /tmp/uploads =====
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
    if (!isImage && !isVideo) {
      return res.status(400).json({ ok: false, error: "只允許圖片或影片" });
    }

    const ext = safeExt(mime, req.file.originalname);
    const id = crypto.randomBytes(10).toString("hex");
    const filename = `${Date.now()}_${id}${ext}`;
    const filepath = path.join(UPLOAD_DIR, filename);

    fs.writeFileSync(filepath, req.file.buffer);

    const publicUrl = `/uploads/${filename}`;
    res.json({ ok: true, url: publicUrl, kind: isVideo ? "video" : "image" });
  } catch (e) {
    res.status(500).json({ ok: false, error: "上傳失敗" });
  }
});

// ====== 全域狀態（同步給所有人）=====
let settings = {
  barrageSpeed: 6,      // px/frame（大概）
  barrageDensity: 1,    // 每則訊息生成幾條（1~10）
  lanes: 10,            // 軌道數（平均分佈）
  bg: { type: "none", url: "" } // none | image | video
};

let bannedWords = [];
let laneCursor = 0;

function containsBanned(text) {
  if (!text) return false;
  return bannedWords.some(w => w && text.includes(w));
}

io.on("connection", (socket) => {
  socket.data.isAdmin = false;

  // 新連線：先給目前狀態
  socket.emit("state", { settings, bannedWords });

  // ===== 管理員登入 =====
  socket.on("adminLogin", (payload) => {
    const pwd = (payload?.password || "").toString();
    if (pwd === ADMIN_PASSWORD) {
      socket.data.isAdmin = true;
      socket.emit("adminLoginResult", { ok: true });
    } else {
      socket.emit("adminLoginResult", { ok: false, error: "密碼錯誤" });
    }
  });

  // ===== 送彈幕 =====
  socket.on("sendDanmaku", (payload) => {
    const text = (payload?.text || "").toString().trim();
    const color = (payload?.color || "#ffffff").toString();

    if (!text) return;

    if (containsBanned(text)) {
      socket.emit("bannedAlert", { ok: false, error: "包含禁止詞" });
      return;
    }

    // 平均分佈：軌道輪詢
    const lane = laneCursor % settings.lanes;
    laneCursor += 1;

    io.emit("danmaku", { text, color, lane });
  });

  // ===== 管理員：更新設定 =====
  socket.on("adminUpdateSettings", (payload) => {
    if (!socket.data.isAdmin) return;

    const next = { ...settings };
    if (typeof payload?.barrageSpeed === "number") next.barrageSpeed = Math.max(1, Math.min(20, payload.barrageSpeed));
    if (typeof payload?.barrageDensity === "number") next.barrageDensity = Math.max(1, Math.min(10, payload.barrageDensity));
    if (typeof payload?.lanes === "number") next.lanes = Math.max(4, Math.min(20, payload.lanes));

    settings = next;
    io.emit("state", { settings, bannedWords });
  });

  // ===== 管理員：設定背景（URL 或 /uploads/...）=====
  socket.on("adminSetBackground", (payload) => {
    if (!socket.data.isAdmin) return;

    const type = payload?.type; // none | image | video
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

  // ===== 管理員：禁詞 =====
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

// ====== Render 必須用 process.env.PORT ======
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log("Server running on port:", PORT);
});
