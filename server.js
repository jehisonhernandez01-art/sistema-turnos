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
  console.error('CRÍTICO: No se ha configurado MONGO_URI.');
} else {
  mongoose.connect(MONGO_URI)
    .then(() => console.log('Conectado a MongoDB Atlas'))
    .catch((err) => console.error('Error en MongoDB:', err));
}

// Lista de nombres autorizados (insensible a mayúsculas)
const NOMBRES_PERMITIDOS = [
  'javier',
  'andy',
  'omar',
  'obed',
  'jehison',
  'leo',
  'alejandra',
  'ale',
  'jose'
];

// Esquema de usuario
const usuarioSchema = new mongoose.Schema({
  clave: { type: String, required: true, unique: true },
  nombre: { type: String, required: true },
  color: { type: String, required: true },
  enTiempoFuera: { type: Boolean, default: false },
  turnosAtendidos: { type: Number, default: 0 },
  saltosOcupado: { type: Number, default: 0 },
  fechaRegistro: { type: Date, default: Date.now }
});

const Usuario = mongoose.model('UsuarioRuleta', usuarioSchema);

const PALETA_COLORES = [
  '#e74c3c', '#3498db', '#2ecc71', '#f1c40f', '#9b59b6',
  '#e67e22', '#1abc9c', '#e84393', '#00cec9', '#6c5ce7'
];

async function obtenerColorUnico() {
  const registrados = await Usuario.find({}, 'color');
  const usados = registrados.map(u => u.color);
  const disponibles = PALETA_COLORES.filter(c => !usados.includes(c));
  if (disponibles.length > 0) {
    return disponibles[Math.floor(Math.random() * disponibles.length)];
  }
  return '#' + Math.floor(Math.random() * 16777215).toString(16);
}

async function obtenerEstadoRuleta() {
  const usuarios = await Usuario.find().sort({ fechaRegistro: 1 });
  return usuarios.map(u => ({
    clave: u.clave,
    nombre: u.nombre,
    color: u.color,
    enTiempoFuera: u.enTiempoFuera || false,
    turnosAtendidos: u.turnosAtendidos || 0,
    saltosOcupado: u.saltosOcupado || 0
  }));
}

const ADMIN_PASSWORD = '123';

io.on('connection', async (socket) => {

  socket.emit('actualizar-ruleta', await obtenerEstadoRuleta());

  socket.on('registrar-usuario', async (nombreIngresado, callback) => {
    if (!nombreIngresado) {
      if (typeof callback === 'function') callback({ exito: false, mensaje: 'Debes ingresar un nombre.' });
      return;
    }

    const nombreLimpio = nombreIngresado.trim();
    const claveNombre = nombreLimpio.toLowerCase();

    if (!NOMBRES_PERMITIDOS.includes(claveNombre)) {
      if (typeof callback === 'function') {
        callback({
          exito: false,
          mensaje: `El nombre "${nombreLimpio}" no está autorizado en la lista de usuarios.`
        });
      }
      return;
    }

    try {
      let usuarioExistente = await Usuario.findOne({ clave: claveNombre });
      
      if (usuarioExistente) {
        socket.nombreUsuario = claveNombre;
        if (typeof callback === 'function') {
          callback({ exito: true, usuario: { nombre: usuarioExistente.nombre, clave: usuarioExistente.clave } });
        }
        io.emit('actualizar-ruleta', await obtenerEstadoRuleta());
        return;
      }

      const colorUnico = await obtenerColorUnico();
      const nuevoUsuario = new Usuario({
        clave: claveNombre,
        nombre: nombreLimpio,
        color: colorUnico,
        enTiempoFuera: false,
        turnosAtendidos: 0,
        saltosOcupado: 0
      });

      await nuevoUsuario.save();
      socket.nombreUsuario = claveNombre;

      if (typeof callback === 'function') {
        callback({ exito: true, usuario: { nombre: nuevoUsuario.nombre, clave: nuevoUsuario.clave } });
      }

      io.emit('actualizar-ruleta', await obtenerEstadoRuleta());

    } catch (error) {
      console.error('Error al registrar:', error);
      if (typeof callback === 'function') {
        callback({ exito: false, mensaje: 'Error al registrar el usuario en la base de datos.' });
      }
    }
  });

  // Avance de turno
  socket.on('siguiente-turno', async (tipoAccion) => {
    try {
      // Buscar el primer usuario que NO esté en tiempo fuera
      const usuariosActivos = await Usuario.find({ enTiempoFuera: false }).sort({ fechaRegistro: 1 });
      
      if (usuariosActivos.length > 0) {
        const primerUsuario = usuariosActivos[0];

        if (tipoAccion === 'atendido') {
          primerUsuario.turnosAtendidos = (primerUsuario.turnosAtendidos || 0) + 1;
        } else if (tipoAccion === 'ocupado') {
          primerUsuario.saltosOcupado = (primerUsuario.saltosOcupado || 0) + 1;
        }

        primerUsuario.fechaRegistro = new Date();
        await primerUsuario.save();

        io.emit('girar-ruleta');
        io.emit('actualizar-ruleta', await obtenerEstadoRuleta());
      }
    } catch (error) {
      console.error('Error al avanzar turno:', error);
    }
  });

  socket.on('toggle-tiempo-fuera', async (claveUsuario) => {
    if (!claveUsuario) return;
    try {
      const usuario = await Usuario.findOne({ clave: claveUsuario });
      if (usuario) {
        usuario.enTiempoFuera = !usuario.enTiempoFuera;
        await usuario.save();
        io.emit('actualizar-ruleta', await obtenerEstadoRuleta());
      }
    } catch (error) {
      console.error('Error en tiempo fuera:', error);
    }
  });

  socket.on('expulsar-usuario', async (claveUsuario, callback) => {
    if (!claveUsuario) return;
    try {
      await Usuario.deleteOne({ clave: claveUsuario });
      io.emit('actualizar-ruleta', await obtenerEstadoRuleta());
      if (typeof callback === 'function') callback({ exito: true });
    } catch (error) {
      console.error('Error al expulsar usuario:', error);
      if (typeof callback === 'function') callback({ exito: false });
    }
  });

  socket.on('finalizar-conexion', async (claveUsuario, callback) => {
    if (!claveUsuario) return;
    try {
      await Usuario.deleteOne({ clave: claveUsuario });
      io.emit('actualizar-ruleta', await obtenerEstadoRuleta());
      if (typeof callback === 'function') {
        callback({ exito: true });
      }
    } catch (error) {
      console.error('Error al finalizar conexión:', error);
      if (typeof callback === 'function') {
        callback({ exito: false, mensaje: 'Error al salir de la lista.' });
      }
    }
  });

  socket.on('reiniciar-sistema', async (passwordIngresada, callback) => {
    if (passwordIngresada !== ADMIN_PASSWORD) {
      if (typeof callback === 'function') {
        callback({ exito: false, mensaje: 'Contraseña incorrecta. No se borrarán los usuarios.' });
      }
      return;
    }
    try {
      await Usuario.deleteMany({});
      io.emit('actualizar-ruleta', []);
      if (typeof callback === 'function') {
        callback({ exito: true, mensaje: 'Sistema reiniciado exitosamente.' });
      }
    } catch (error) {
      console.error('Error al reiniciar:', error);
      if (typeof callback === 'function') {
        callback({ exito: false, mensaje: 'Error interno en el servidor al intentar reiniciar.' });
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Servidor escuchando en el puerto ${PORT}`));
