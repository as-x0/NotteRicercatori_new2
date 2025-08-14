// server.js
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import fs from "fs";
import csv from "csv-parser";
import { v4 as uuidv4 } from "uuid";

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

app.use(express.static("public"));

// === Lettura CSV all'avvio ===
let exportData = [];
let products = new Set();
let years = new Set();

fs.createReadStream("FAOSTAT_data_en_8.10-2025.csv")
  .pipe(csv())
  .on("data", (row) => {
    // Normalizza nomi colonne in base al CSV FAOSTAT
    const area = row.Area?.trim();
    const item = row.Item?.trim();
    const element = row.Element?.trim();
    const year = row.Year?.trim();
    const value = parseFloat(row.Value) || 0;

    // Salva riga se è un dato di esportazione
    if (element?.toLowerCase().includes("export")) {
      exportData.push({ area, item, year, value });
      products.add(item);
      years.add(year);
    }
  })
  .on("end", () => {
    console.log(`✅ CSV caricato con ${exportData.length} righe`);
    console.log(`Prodotti: ${products.size} | Anni: ${years.size}`);
  });

// === Gestione stanze di gioco ===
let rooms = {};

io.on("connection", (socket) => {
  console.log("🔌 Nuovo client connesso:", socket.id);

  // Creazione stanza (gestore)
  socket.on("createRoom", () => {
    const roomId = uuidv4().slice(0, 6);
    rooms[roomId] = {
      manager: socket.id,
      players: {},
      settings: { product: null, year: null, numCountries: 0 },
      status: "waiting"
    };
    socket.join(roomId);
    socket.emit("roomCreated", {
      roomId,
      products: Array.from(products),
      years: Array.from(years).sort()
    });
    console.log(`📦 Stanza creata: ${roomId}`);
  });

  // Unione a stanza (giocatori)
  socket.on("joinRoom", ({ roomId, name }) => {
    const room = rooms[roomId];
    if (room && room.status === "waiting") {
      room.players[socket.id] = { name, countries: [] };
      socket.join(roomId);
      io.to(roomId).emit("playerList", Object.values(room.players));
      console.log(`👤 ${name} è entrato nella stanza ${roomId}`);
    } else {
      socket.emit("errorMsg", "Stanza non trovata o partita già iniziata");
    }
  });

  // Impostazione parametri di gioco
  socket.on("setSettings", ({ roomId, product, year, numCountries }) => {
    const room = rooms[roomId];
    if (room && socket.id === room.manager) {
      room.settings = { product, year, numCountries };
      io.to(roomId).emit("settingsUpdated", room.settings);
      console.log(`⚙️ Impostazioni stanza ${roomId}:`, room.settings);
    }
  });

  // Inizio partita
  socket.on("startGame", (roomId) => {
    const room = rooms[roomId];
    if (room && socket.id === room.manager) {
      room.status = "playing";
      io.to(roomId).emit("gameStarted", room.settings);
      console.log(`▶️ Partita iniziata in ${roomId}`);
    }
  });

  // Selezione paese da parte di un giocatore
  socket.on("selectCountry", ({ roomId, country }) => {
    const room = rooms[roomId];
    if (room && room.players[socket.id]) {
      const player = room.players[socket.id];
      if (!player.countries.includes(country)) {
        player.countries.push(country);
      }
      io.to(roomId).emit("playerList", Object.values(room.players));
    }
  });

  // Fine partita e calcolo punteggi
  socket.on("endGame", (roomId) => {
    const room = rooms[roomId];
    if (room && socket.id === room.manager) {
      room.status = "ended";

      const { product, year } = room.settings;

      const leaderboard = Object.values(room.players).map(player => {
        let score = 0;
        player.countries.forEach(country => {
          const match = exportData.find(row =>
            row.item === product &&
            row.year === year &&
            row.area.toLowerCase() === country.toLowerCase()
          );
          if (match) score += match.value;
        });
        return { name: player.name, score };
      });

      leaderboard.sort((a, b) => b.score - a.score);

      io.to(roomId).emit("gameEnded", leaderboard);
      console.log(`🏁 Partita ${roomId} terminata. Classifica:`, leaderboard);
    }
  });

  // Disconnessione
  socket.on("disconnect", () => {
    console.log("❌ Client disconnesso:", socket.id);
    for (const [roomId, room] of Object.entries(rooms)) {
      if (room.manager === socket.id) {
        io.to(roomId).emit("errorMsg", "Il gestore ha chiuso la partita");
        delete rooms[roomId];
      } else if (room.players[socket.id]) {
        delete room.players[socket.id];
        io.to(roomId).emit("playerList", Object.values(room.players));
      }
    }
  });
});

// Avvio server
const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`🚀 Server avviato su porta ${PORT}`);
});
