const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// 初始設定
let settings = {
  barrageSpeed: 3,
  barrageDensity: 1,
  backgroundType: 'video'
};
let bannedWords = [];

// 靜態目錄
app.use(express.static(path.join(__dirname, 'public')));

// Socket.IO
io.on('connection', (socket) => {
  console.log('a user connected');

  // 新連線就發設定
  socket.emit('updateSettings', {settings, bannedWords});

  socket.on('sendDanmaku', (msg) => {
    // 禁詞檢查
    if(bannedWords.some(word => msg.includes(word))){
      socket.emit('bannedAlert', msg);
      return;
    }
    io.emit('receiveDanmaku', msg); // 廣播給所有人
  });

  socket.on('updateSettings', data => {
    settings = {...settings, ...data};
    io.emit('updateSettings', {settings, bannedWords});
  });

  socket.on('addBannedWord', word => {
    bannedWords.push(word);
    io.emit('updateSettings', {settings, bannedWords});
  });

  socket.on('disconnect', () => {
    console.log('user disconnected');
  });
});

server.listen(process.env.PORT || 3000, () => {
  console.log('Server running');
});
