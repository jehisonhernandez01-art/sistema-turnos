const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Servir archivos de la raíz
app.use(express.static(__dirname));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

let users = {}; // { socketId: { id, name, shiftsToday, consecutiveMisses, isTimeout, isTurn } }
let currentTurnIndex = 0;
let userOrder = [];
let turnTimer = null;
let turnTimeRemaining = 60;

// Reset diario a la medianoche
function setupDailyReset() {
  const now = new Date();
  const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0);
  setTimeout(() => {
    Object.keys(users).forEach(id => { users[id].shiftsToday = 0; });
    io.emit('stateUpdate', { users, userOrder, currentTurnIndex });
    setupDailyReset();
  }, nextMidnight - now);
}
setupDailyReset();

function startTurnTimer() {
  clearInterval(turnTimer);
  turnTimeRemaining = 60;
  
  const activeUserId = userOrder[currentTurnIndex];
  if (!activeUserId || !users[activeUserId]) return;

  io.emit('turnTimerTick', { timeRemaining: turnTimeRemaining, userId: activeUserId });

  turnTimer = setInterval(() => {
    turnTimeRemaining--;
    io.emit('turnTimerTick', { timeRemaining: turnTimeRemaining, userId: activeUserId });

    if (turnTimeRemaining <= 0) {
      clearInterval(turnTimer);
      handleTurnAbsence(activeUserId);
    }
  }, 1000);
}

function handleTurnAbsence(userId) {
  if (users[userId]) {
    users[userId].consecutiveMisses += 1;
    users[userId].isTurn = false;
  }
  nextTurn();
}

function nextTurn() {
  clearInterval(turnTimer);
  if (userOrder.length === 0) return;

  userOrder.forEach(id => { if (users[id]) users[id].isTurn = false; });

  let attempts = 0;
  do {
    currentTurnIndex = (currentTurnIndex + 1) % userOrder.length;
    attempts++;
  } while (
    users[userOrder[currentTurnIndex]] &&
    users[userOrder[currentTurnIndex]].isTimeout &&
    attempts < userOrder.length
  );

  const nextUserId = userOrder[currentTurnIndex];
  if (nextUserId && users[nextUserId] && !users[nextUserId].isTimeout) {
    users[nextUserId].isTurn = true;
    startTurnTimer();
  }

  io.emit('stateUpdate', { users, userOrder, currentTurnIndex });
}

io.on('connection', (socket) => {
  socket.on('joinRoom', (username) => {
    users[socket.id] = {
      id: socket.id,
      name: username,
      shiftsToday: 0,
      consecutiveMisses: 0,
      isTimeout: false,
      isTurn: false
    };
    userOrder.push(socket.id);

    if (userOrder.length === 1) {
      users[socket.id].isTurn = true;
      currentTurnIndex = 0;
      startTurnTimer();
    }

    io.emit('stateUpdate', { users, userOrder, currentTurnIndex });
  });

  socket.on('acceptTurn', () => {
    if (users[socket.id] && users[socket.id].isTurn) {
      users[socket.id].shiftsToday += 1;
      users[socket.id].consecutiveMisses = 0;
      users[socket.id].isTurn = false;
      nextTurn();
    }
  });

  socket.on('busyTurn', () => {
    if (users[socket.id] && users[socket.id].isTurn) {
      handleTurnAbsence(socket.id);
    }
  });

  socket.on('toggleTimeout', () => {
    if (users[socket.id]) {
      users[socket.id].isTimeout = !users[socket.id].isTimeout;
      if (users[socket.id].isTimeout && users[socket.id].isTurn) {
        users[socket.id].isTurn = false;
        nextTurn();
      } else {
        io.emit('stateUpdate', { users, userOrder, currentTurnIndex });
      }
    }
  });

  socket.on('kickUser', (targetUserId) => {
    if (users[targetUserId] && users[targetUserId].consecutiveMisses >= 2) {
      delete users[targetUserId];
      userOrder = userOrder.filter(id => id !== targetUserId);
      if (currentTurnIndex >= userOrder.length) currentTurnIndex = 0;
      io.to(targetUserId).emit('kicked');
      io.emit('stateUpdate', { users, userOrder, currentTurnIndex });
    }
  });

  socket.on('disconnect', () => {
    const wasActive = users[socket.id] && users[socket.id].isTurn;
    delete users[socket.id];
    userOrder = userOrder.filter(id => id !== socket.id);

    if (userOrder.length > 0) {
      if (currentTurnIndex >= userOrder.length) currentTurnIndex = 0;
      if (wasActive) nextTurn();
      else io.emit('stateUpdate', { users, userOrder, currentTurnIndex });
    } else {
      clearInterval(turnTimer);
      io.emit('stateUpdate', { users: {}, userOrder: [], currentTurnIndex: 0 });
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor activo en el puerto ${PORT}`);
});
