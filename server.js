const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

let settings = {
  barrageSpeed: 2,
  barrageDensity: 1,
  backgroundType: 'video'
};

let bannedWords = [];

io.on('connection', (socket) => {
  console.log('a user connected');

  // 發送彈幕
  socket.on('sendDanmaku', (msg) => {
    // 檢查禁詞
    if(bannedWords.some(word => msg.includes(word))){
      socket.emit('bannedAlert', msg);
      return;
    }
    io.emit('receiveDanmaku', msg);
  });

  // 更新管理員設定
  socket.on('updateSettings', data => {
    settings = {...settings, ...data};
    io.emit('updateSettings', {settings, bannedWords});
  });

  // 新增禁詞
  socket.on('addBannedWord', word => {
    if(!bannedWords.includes(word)){
      bannedWords.push(word);
      io.emit('updateSettings', {settings, bannedWords});
    }
  });

  // 刪除禁詞
  socket.on('removeBannedWord', word => {
    bannedWords = bannedWords.filter(w => w!==word);
    io.emit('updateSettings', {settings, bannedWords});
  });

  socket.on('disconnect', () => {
    console.log('user disconnected');
  });
});

server.listen(3000, () => {
  console.log('Server running at http://localhost:3000');
});
