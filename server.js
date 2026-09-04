const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const mongoose = require('mongoose');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Servir archivos estáticos directamente desde la raíz del proyecto
app.use(express.static(__dirname));

// Servir el archivo index.html cuando entren a la ruta raíz '/'
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Obtener la URL de conexión desde la variable de entorno de Render
const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
  console.error('ERROR: No se ha definido la variable de entorno MONGO_URI.');
} else {
  mongoose.connect(MONGO_URI)
    .then(() => console.log('Conectado exitosamente a MongoDB Atlas'))
    .catch((err) => console.error('Error al conectar a MongoDB:', err));
}

// Esquema de datos para los usuarios en MongoDB
const usuarioSchema = new mongoose.Schema({
  clave: { type: String, required: true, unique: true },
  nombre: { type: String, required: true },
  color: { type: String, required: true },
  enTurno: { type: Boolean, default: false }
});

const Usuario = mongoose.model('Usuario', usuarioSchema);

const colores = ['#e74c3c', '#3498db', '#2ecc71', '#f1c40f', '#9b59b6', '#e67e22', '#1abc9c', '#d35400'];

function obtenerColorAleatorio() {
  return colores[Math.floor(Math.random() * colores.length)];
}

// Función auxiliar para obtener todos los usuarios formateados como objeto
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
    console.error('Error al consultar usuarios:', error);
    return {};
  }
}

io.on('connection', async (socket) => {
  // Enviar el estado actual apenas se conecta cualquier pantalla
  socket.emit('actualizar-lista', await obtenerUsuarios());

  // Registrar o Reconectar usuario mediante su nombre
  socket.on('registrar-usuario', async (nombre) => {
    if (!nombre) return;
    const claveNombre = nombre.trim().toLowerCase();

    try {
      let usuario = await Usuario.findOne({ clave: claveNombre });

      if (!usuario) {
        // Usuario nuevo: se crea en MongoDB
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
      console.error('Error al registrar usuario:', error);
    }
  });

  // Cambiar a columna izquierda (En Turno)
  socket.on('iniciar-turno', async (nombre) => {
    const clave = (nombre || socket.nombreUsuario)?.trim().toLowerCase();
    if (clave) {
      try {
        await Usuario.updateOne({ clave }, { enTurno: true });
        io.emit('actualizar-lista', await obtenerUsuarios());
      } catch (error) {
        console.error('Error al iniciar turno:', error);
      }
    }
  });

  // Cambiar a columna derecha (Finalizado / Disponible)
  socket.on('finalizar-turno', async (nombre) => {
    const clave = (nombre || socket.nombreUsuario)?.trim().toLowerCase();
    if (clave) {
      try {
        await Usuario.updateOne({ clave }, { enTurno: false });
        io.emit('actualizar-lista', await obtenerUsuarios());
      } catch (error) {
        console.error('Error al finalizar turno:', error);
      }
    }
  });
});

// Render asigna dinámicamente un puerto en process.env.PORT
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor escuchando en el puerto ${PORT}`);
});
