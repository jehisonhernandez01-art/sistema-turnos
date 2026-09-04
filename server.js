const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const mongoose = require('mongoose');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Servir archivos estáticos directamente desde la raíz
app.use(express.static(__dirname));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Conexión a MongoDB Atlas
const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
  console.error('CRÍTICO: No se ha configurado la variable MONGO_URI en Render.');
} else {
  mongoose.connect(MONGO_URI)
    .then(() => console.log('Conectado exitosamente a MongoDB Atlas'))
    .catch((err) => console.error('Error al conectar a MongoDB:', err));
}

// Modelo de datos para MongoDB
const usuarioSchema = new mongoose.Schema({
  clave: { type: String, required: true, unique: true },
  nombre: { type: String, required: true },
  color: { type: String, required: true },
  enTurno: { type: Boolean, default: false }
});

const Usuario = mongoose.model('Usuario', usuarioSchema);

const colores = ['#3498db', '#2ecc71', '#f1c40f', '#9b59b6', '#e67e22', '#1abc9c', '#e74c3c', '#34495e'];

function obtenerColorAleatorio() {
  return colores[Math.floor(Math.random() * colores.length)];
}

async function obtenerUsuarios() {
  try {
    const lista = await Usuario.find();
    const mapaUsuarios = {};
    lista.forEach((u) => {
      mapaUsuarios[u.clave] = {
        nombre: u.nombre,
        color: u.color,
        enTurno: u.enTurno
      };
    });
    return mapaUsuarios;
  } catch (error) {
    console.error('Error obteniendo usuarios:', error);
    return {};
  }
}

io.on('connection', async (socket) => {
  // Enviar la lista de usuarios al conectar
  socket.emit('actualizar-lista', await obtenerUsuarios());

  // Registrar usuario nuevo o existente
  socket.on('registrar-usuario', async (nombre) => {
    if (!nombre) return;
    const claveNombre = nombre.trim().toLowerCase();

    try {
      let usuario = await Usuario.findOne({ clave: claveNombre });

      if (!usuario) {
        usuario = new Usuario({
          clave: claveNombre,
          nombre: nombre.trim(),
          color: obtenerColorAleatorio(),
          enTurno: false
        });
        await usuario.save();
      }

      socket.nombreUsuario = claveNombre;
      io.emit('actualizar-lista', await obtenerUsuarios());
    } catch (error) {
      console.error('Error en registrar-usuario:', error);
    }
  });

  // Mover a la columna de "En Turno" (Izquierda)
  socket.on('iniciar-turno', async (nombre) => {
    const clave = (nombre || socket.nombreUsuario)?.trim().toLowerCase();
    if (clave) {
      try {
        await Usuario.updateOne({ clave }, { enTurno: true });
        io.emit('actualizar-lista', await obtenerUsuarios());
      } catch (error) {
        console.error('Error en iniciar-turno:', error);
      }
    }
  });

  // Mover a la columna de "Espera y Finalizados" (Derecha)
  socket.on('finalizar-turno', async (nombre) => {
    const clave = (nombre || socket.nombreUsuario)?.trim().toLowerCase();
    if (clave) {
      try {
        await Usuario.updateOne({ clave }, { enTurno: false });
        io.emit('actualizar-lista', await obtenerUsuarios());
      } catch (error) {
        console.error('Error en finalizar-turno:', error);
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor activo en el puerto ${PORT}`);
});
