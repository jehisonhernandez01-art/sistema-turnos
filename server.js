const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// Estado global de la aplicación
let users = {}; // { socketId: { id, name, shiftsToday, consecutiveMisses, isTimeout, isTurn } }
let currentTurnIndex = 0;
let userOrder = [];
let turnTimer = null;
let turnTimeRemaining = 60;

// Reiniciar contadores de turnos diarios a la medianoche (00:00)
function setupDailyReset() {
  const now = new Date();
  const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0);
  const timeToMidnight = nextMidnight - now;

  setTimeout(() => {
    Object.keys(users).forEach(id => {
      users[id].shiftsToday = 0;
    });
    io.emit('stateUpdate', { users, userOrder, currentTurnIndex });
    setupDailyReset(); // Reprogramar para el siguiente día
  }, timeToMidnight);
}
setupDailyReset();

// Gestión de tiempos para el turno activo
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

  // Limpiar bandera de turno activo anterior
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
  console.log('Usuario conectado:', socket.id);

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
      users[socket.id].consecutiveMisses = 0; // Reiniciar faltas tras tomar el turno
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
      
      // Si entra en tiempo fuera en medio de su turno, pasa al siguiente
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

      if (currentTurnIndex >= userOrder.length) {
        currentTurnIndex = 0;
      }

      io.to(targetUserId).emit('kicked');
      io.emit('stateUpdate', { users, userOrder, currentTurnIndex });
    }
  });

  socket.on('disconnect', () => {
    const wasActive = users[socket.id] && users[socket.id].isTurn;
    delete users[socket.id];
    userOrder = userOrder.filter(id => id !== socket.id);

    if (userOrder.length > 0) {
      if (currentTurnIndex >= userOrder.length) {
        currentTurnIndex = 0;
      }
      if (wasActive) {
        nextTurn();
      } else {
        io.emit('stateUpdate', { users, userOrder, currentTurnIndex });
      }
    } else {
      clearInterval(turnTimer);
      io.emit('stateUpdate', { users: {}, userOrder: [], currentTurnIndex: 0 });
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor ejecutándose en puerto ${PORT}`);
});
