const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

// Lista para almacenar los usuarios
let usuarios = [];

io.on('connection', (socket) => {
    console.log('Un usuario se ha conectado:', socket.id);

    // Enviar la lista actual al nuevo usuario
    socket.emit('actualizar_usuarios', usuarios);

    // Registrar usuario
    socket.on('registrar_usuario', (data) => {
        const nuevoUsuario = {
            id: socket.id,
            nombre: data.nombre,
            color: data.color,
            estado: 'espera' // 'espera', 'turno', 'finalizado'
        };
        usuarios.push(nuevoUsuario);
        io.emit('actualizar_usuarios', usuarios);
    });

    // Cambiar estado a "turno"
    socket.on('dar_turno', () => {
        const usuario = usuarios.find(u => u.id === socket.id);
        if (usuario) {
            usuario.estado = 'turno';
            io.emit('actualizar_usuarios', usuarios);
        }
    });

    // Cambiar estado a "finalizado"
    socket.on('finalizar_turno', () => {
        const usuario = usuarios.find(u => u.id === socket.id);
        if (usuario) {
            usuario.estado = 'finalizado';
            io.emit('actualizar_usuarios', usuarios);
        }
    });

    // Desconexión del usuario
    socket.on('disconnect', () => {
        usuarios = usuarios.filter(u => u.id !== socket.id);
        io.emit('actualizar_usuarios', usuarios);
        console.log('Usuario desconectado:', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
});
