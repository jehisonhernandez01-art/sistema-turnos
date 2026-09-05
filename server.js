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

// Esquema de usuario con orden de llegada
const usuarioSchema = new mongoose.Schema({
  clave: { type: String, required: true, unique: true },
  nombre: { type: String, required: true },
  color: { type: String, required: true },
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
  return '#' + Math.floor(Math.random()*16777215).toString(16);
}

// Retorna los usuarios ordenados por llegada
async function obtenerEstadoRuleta() {
  const usuarios = await Usuario.find().sort({ fechaRegistro: 1 });
  return usuarios.map(u => ({
    clave: u.clave,
    nombre: u.nombre,
    color: u.color
  }));
}

// Contraseña para reiniciar el sistema
const ADMIN_PASSWORD = '20262026'; // Puedes cambiar '123' por la clave que quieras

io.on('connection', async (socket) => {
  // Enviar estado inicial al conectar
  socket.emit('actualizar-ruleta', await obtenerEstadoRuleta());

  // Registrar usuario
  socket.on('registrar-usuario', async (nombreIngresado, callback) => {
    if (!nombreIngresado) return;
    const nombreLimpio = nombreIngresado.trim();
    const claveNombre = nombreLimpio.toLowerCase();

    try {
      let usuario = await Usuario.findOne({ clave: claveNombre });

      if (!usuario) {
        const colorUnico = await obtenerColorUnico();
        usuario = new Usuario({
          clave: claveNombre,
          nombre: nombreLimpio,
          color: colorUnico
        });
        await usuario.save();
      }

      socket.nombreUsuario = claveNombre;

      if (typeof callback === 'function') {
        callback({ exito: true, usuario: { nombre: usuario.nombre, clave: usuario.clave } });
      }

      io.emit('actualizar-ruleta', await obtenerEstadoRuleta());
    } catch (error) {
      console.error('Error al registrar:', error);
      if (typeof callback === 'function') {
        callback({ exito: false, mensaje: 'Error al registrar el usuario.' });
      }
    }
  });

  // Avanzar turno (El primer usuario pasa al final de la cola)
  socket.on('siguiente-turno', async () => {
    try {
      const lista = await Usuario.find().sort({ fechaRegistro: 1 });
      if (lista.length > 0) {
        const primerUsuario = lista[0];
        primerUsuario.fechaRegistro = new Date();
        await primerUsuario.save();

        io.emit('actualizar-ruleta', await obtenerEstadoRuleta());
      }
    } catch (error) {
      console.error('Error al avanzar turno:', error);
    }
  });

  // Reiniciar sistema con validación de contraseña
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
      console.log('Sistema de turnos reiniciado correctamente.');
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
