import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { v4 as uuidv4 } from "uuid";

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

app.use(express.static("public"));

// Stato delle partite
let rooms = {};

// Gestione connessioni
io.on("connection", (socket) => {
  console.log("Nuovo utente connesso:", socket.id);

  // Gestore crea stanza
  socket.on("createRoom", (settings) => {
    const roomId = uuidv4().slice(0, 6); // codice breve
    rooms[roomId] = {
      manager: socket.id,
      players: {},
      settings,
      status: "waiting"
    };
    socket.join(roomId);
    socket.emit("roomCreated", roomId);
    console.log(`Stanza creata: ${roomId}`);
  });

  // Giocatore entra nella stanza
  socket.on("joinRoom", ({ roomId, playerName }) => {
    const room = rooms[roomId];
    if (room && room.status === "waiting") {
      room.players[socket.id] = {
        name: playerName,
        countries: []
      };
      socket.join(roomId);
      socket.emit("joinedRoom", { roomId, settings: room.settings });
      io.to(room.manager).emit("playerList", Object.values(room.players));
    } else {
      socket.emit("errorMsg", "Codice stanza non valido o partita già avviata");
    }
  });

  // Gestore avvia partita
  socket.on("startGame", (roomId) => {
    if (rooms[roomId] && socket.id === rooms[roomId].manager) {
      rooms[roomId].status = "playing";
      io.to(roomId).emit("gameStarted");
    }
  });

  // Giocatore invia paesi
  socket.on("submitCountries", ({ roomId, countries }) => {
    const room = rooms[roomId];
    if (room && room.status === "playing" && room.players[socket.id]) {
      room.players[socket.id].countries = countries;
      io.to(room.manager).emit("playerList", Object.values(room.players));
    }
  });

  // Gestore termina partita
  socket.on("endGame", (roomId) => {
    const room = rooms[roomId];
    if (room && socket.id === room.manager) {
      room.status = "ended";
      // Qui puoi aggiungere il calcolo punteggi reale
      const leaderboard = Object.values(room.players).map(p => ({
        name: p.name,
        score: Math.floor(Math.random() * 100) // simulazione
      }));
      io.to(roomId).emit("gameEnded", leaderboard);
    }
  });

  // Disconnessione
  socket.on("disconnect", () => {
    console.log("Utente disconnesso:", socket.id);
    for (let roomId in rooms) {
      const room = rooms[roomId];
      if (room.manager === socket.id) {
        delete rooms[roomId];
        io.to(roomId).emit("errorMsg", "Il gestore ha chiuso la stanza");
      }
      if (room.players[socket.id]) {
        delete room.players[socket.id];
        io.to(room.manager).emit("playerList", Object.values(room.players));
      }
    }
  });
});

httpServer.listen(3000, () => {
  console.log("Server avviato su http://localhost:3000");
});
