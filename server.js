const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const fs = require("fs");
const csv = require("csv-parser");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

// --- Traduzioni prodotti in italiano ---
const productTranslations = {
  "Wheat": "Grano",
  "Rice": "Riso",
  "Maize": "Mais",
  "Soybeans": "Soia",
  "Barley": "Orzo",
  "Coffee": "Caffè",
  "Cocoa": "Cacao",
  "Sugar": "Zucchero",
  "Cotton": "Cotone",
  "Potatoes": "Patate",
  "Tomatoes": "Pomodori",
  "Apples": "Mele",
  "Bananas": "Banane"
};

// --- Caricamento CSV FAOSTAT ---
let productsData = [];
fs.createReadStream("data/FAOSTAT_data.csv")
  .pipe(csv())
  .on("data", (row) => {
    productsData.push({
      Country: row["Country"],
      ProductEN: row["Item"],
      ProductIT: productTranslations[row["Item"]] || row["Item"], // fallback se manca traduzione
      Year: parseInt(row["Year"]),
      Value: parseFloat(row["Value"]) || 0
    });
  })
  .on("end", () => {
    console.log("✅ CSV caricato, prodotti disponibili:", productsData.length);
  });

// --- Stanze e stato gioco ---
let rooms = {};

// --- Socket.IO ---
io.on("connection", (socket) => {
  console.log("🔗 Nuovo client connesso:", socket.id);

  // Creazione stanza (solo se CSV caricato)
  socket.on("createRoom", () => {
    if (productsData.length === 0) {
      socket.emit("errorMsg", "⚠️ I dati non sono ancora pronti, attendi qualche secondo e riprova.");
      return;
    }

    const roomId = Math.random().toString(36).substring(2, 7).toUpperCase();
    rooms[roomId] = { manager: socket.id, players: [], settings: null, started: false };
    socket.join(roomId);

    const products = [...new Set(productsData.map((p) => p.ProductIT))].filter(Boolean);

    socket.emit("roomCreated", { roomId, products });
  });

  // Impostazioni gioco
  socket.on("setSettings", ({ roomId, product, year, numCountries }) => {
    if (!rooms[roomId]) return;
    rooms[roomId].settings = { product, year, numCountries };
    io.to(roomId).emit("settingsUpdated", rooms[roomId].settings);
  });

  // Giocatore si unisce
  socket.on("joinRoom", ({ roomId, name }) => {
    if (!rooms[roomId]) {
      socket.emit("errorMsg", "❌ Stanza inesistente");
      return;
    }

    rooms[roomId].players.push({ id: socket.id, name, countries: [], score: 0 });
    socket.join(roomId);
    io.to(roomId).emit("playerList", rooms[roomId].players);
  });

  // Giocatore sceglie i paesi
  socket.on("chooseCountries", ({ roomId, countries }) => {
    const player = rooms[roomId]?.players.find(p => p.id === socket.id);
    if (player) {
      player.countries = countries;
    }
    io.to(roomId).emit("playerList", rooms[roomId].players);
  });

  // Avvio partita
  socket.on("startGame", (roomId) => {
    if (rooms[roomId]) {
      rooms[roomId].started = true;
      io.to(roomId).emit("gameStarted", rooms[roomId].settings);
    }
  });

  // Fine partita e calcolo punteggi
  socket.on("endGame", (roomId) => {
    const room = rooms[roomId];
    if (!room) return;

    const { product, year } = room.settings;
    room.players.forEach(player => {
      let score = 0;
      player.countries.forEach(country => {
        const record = productsData.find(r =>
          r.Country === country && r.ProductIT === product && r.Year === year
        );
        if (record) score += record.Value;
      });
      player.score = Math.round(score);
    });

    room.players.sort((a, b) => b.score - a.score);

    // Top 5 paesi per grafico
    const topCountries = productsData
      .filter(r => r.ProductIT === product && r.Year === year)
      .sort((a, b) => b.Value - a.Value)
      .slice(0, 5);

    io.to(roomId).emit("gameEnded", {
      players: room.players,
      topCountries
    });
  });

  // Disconnessione
  socket.on("disconnect", () => {
    console.log("❌ Disconnesso:", socket.id);
    for (const roomId in rooms) {
      rooms[roomId].players = rooms[roomId].players.filter(p => p.id !== socket.id);
      io.to(roomId).emit("playerList", rooms[roomId].players);
    }
  });
});

// --- Avvio server ---
const PORT = 3000;
server.listen(PORT, () => {
  console.log(`🚀 Server avviato su http://localhost:${PORT}`);
});
