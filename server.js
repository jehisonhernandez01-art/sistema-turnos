const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const mongoose = require('mongoose');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

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

// Esquema de usuario en MongoDB
const usuarioSchema = new mongoose.Schema({
  clave: { type: String, required: true, unique: true },
  nombre: { type: String, required: true },
  color: { type: String, required: true, unique: true },
  enTurno: { type: Boolean, default: false }
});

const Usuario = mongoose.model('Usuario', usuarioSchema);

// Paleta de colores distintivos y llamativos
const PALETA_COLORES = [
  '#e74c3c', '#3498db', '#2ecc71', '#f1c40f', '#9b59b6',
  '#e67e22', '#1abc9c', '#e84393', '#00cec9', '#6c5ce7',
  '#fdcb6e', '#d63031', '#00b894', '#2d3436', '#ff7675'
];

// Obtener un color que NO esté en uso por ningún usuario registrado
async function obtenerColorUnico() {
  const usuariosExistentes = await Usuario.find({}, 'color');
  const coloresUsados = usuariosExistentes.map(u => u.color);
  
  const coloresDisponibles = PALETA_COLORES.filter(c => !coloresUsados.includes(c));
  if (coloresDisponibles.length > 0) {
    return coloresDisponibles[Math.floor(Math.random() * coloresDisponibles.length)];
  }
  // Color aleatorio dinámico en caso de agotar la paleta predefinida
  return '#' + Math.floor(Math.random()*16777215).toString(16);
}

// Obtener estado completo de usuarios
async function obtenerUsuariosMap() {
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
  // Enviar lista actualizada al momento de conectarse
  socket.emit('actualizar-lista', await obtenerUsuariosMap());

  // Evento 1: Registrar o validar usuario
  socket.on('registrar-usuario', async (nombreIngresado, callback) => {
    if (!nombreIngresado || typeof nombreIngresado !== 'string') return;
    
    const nombreLimpio = nombreIngresado.trim();
    const claveNombre = nombreLimpio.toLowerCase();

    if (!nombreLimpio) return;

    try {
      let usuario = await Usuario.findOne({ clave: claveNombre });

      if (!usuario) {
        // Verificar si ya existe un usuario con la misma clave (insensible a mayúsculas)
        const colorUnico = await obtenerColorUnico();
        usuario = new Usuario({
          clave: claveNombre,
          nombre: nombreLimpio,
          color: colorUnico,
          enTurno: false
        });
        await usuario.save();
      }

      socket.nombreUsuario = claveNombre;
      
      // Confirmar al cliente que el registro fue exitoso
      if (typeof callback === 'function') {
        callback({ exito: true, usuario: { nombre: usuario.nombre, color: usuario.color } });
      }

      // Notificar a todos los dispositivos conectados
      io.emit('actualizar-lista', await obtenerUsuariosMap());
    } catch (error) {
      console.error('Error al registrar usuario:', error);
      if (typeof callback === 'function') {
        callback({ exito: false, mensaje: 'Error al registrar el usuario en el servidor.' });
      }
    }
  });

  // Evento 2: Iniciar Turno (Mueve a columna izquierda: Turno con Técnico Activo)
  socket.on('iniciar-turno', async (nombre) => {
    const clave = (nombre || socket.nombreUsuario)?.trim().toLowerCase();
    if (clave) {
      try {
        await Usuario.updateOne({ clave }, { enTurno: true });
        io.emit('actualizar-lista', await obtenerUsuariosMap());
      } catch (error) {
        console.error('Error al iniciar turno:', error);
      }
    }
  });

  // Evento 3: Finalizar Turno (Mueve a columna derecha: Usuario sin Técnico / sin Turno)
  socket.on('finalizar-turno', async (nombre) => {
    const clave = (nombre || socket.nombreUsuario)?.trim().toLowerCase();
    if (clave) {
      try {
        await Usuario.updateOne({ clave }, { enTurno: false });
        io.emit('actualizar-lista', await obtenerUsuariosMap());
      } catch (error) {
        console.error('Error al finalizar turno:', error);
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor activo escuchando en puerto ${PORT}`);
});
