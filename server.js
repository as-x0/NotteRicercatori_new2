import express from "express";
import http from "http";
import { Server } from "socket.io";
import fs from "fs";
import csv from "csv-parser";

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

// Caricamento CSV FAOSTAT
let productsData = [];
fs.createReadStream("FAOSTAT_data_it.csv")
  .pipe(csv({ separator: "," }))
  .on("data", (row) => {
    productsData.push({
      Country: row["Area"],
      ProductEN: row["Item"],
      Year: parseInt(row["Year"]),
      Value: parseFloat(row["Value"]) || 0
    });
  })
  .on("end", () => {
    console.log("✅ CSV caricato, prodotti disponibili:", productsData.length);
  });

// Stanze di gioco
let rooms = {};

io.on("connection", (socket) => {
  console.log("🔗 Nuovo client connesso:", socket.id);

  // Creazione stanza
  socket.on("createRoom", () => {
    if (productsData.length === 0) {
      socket.emit("errorMsg", "⚠️ I dati non sono pronti, attendi qualche secondo.");
      return;
    }

    const roomId = Math.random().toString(36).substring(2, 7).toUpperCase();
    rooms[roomId] = { manager: socket.id, players: [], settings: null, started: false };
    socket.join(roomId);

    const products = [...new Set(productsData.map(p => p.Product))].filter(Boolean);
    socket.emit("roomCreated", { roomId, products });
  });

  // Salvataggio impostazioni
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

  // Giocatore richiede lista paesi
  socket.on("requestCountries", () => {
    if (!productsData.length) return;
    const countries = [...new Set(productsData.map(p => p.Country))].sort();
    socket.emit("countryList", countries);
  });

  // Giocatore sceglie i paesi
  socket.on("chooseCountries", ({ roomId, countries }) => {
    const player = rooms[roomId]?.players.find(p => p.id === socket.id);
    if (player) {
      player.countries = countries;
    }
    io.to(roomId).emit("playerList", rooms[roomId].players);
  });

  // Avvio gioco
  socket.on("startGame", (roomId) => {
    const room = rooms[roomId];
    if (!room) return;

    if (!room.settings) {
      socket.emit("errorMsg", "⚠️ Salva prima le impostazioni del gioco prima di avviarlo!");
      return;
    }

    room.started = true;
    io.to(roomId).emit("gameStarted", room.settings);
  });

  // Fine gioco
  socket.on("endGame", (roomId) => {
    const room = rooms[roomId];
    if (!room) return;

    if (!room.settings) {
      socket.emit("errorMsg", "⚠️ Salva prima le impostazioni del gioco prima di terminarlo!");
      return;
    }

    const { product, year } = room.settings;

    // Calcolo punteggi
    room.players.forEach(player => {
      let score = 0;
      player.countries.forEach(country => {
        const record = productsData.find(r =>
          r.Country === country && r.Product === product && r.Year === year
        );
        if (record) score += record.Value;
      });
      player.score = Math.round(score);
    });

    room.players.sort((a, b) => b.score - a.score);

    // Top 5 paesi per grafico
    const topCountries = productsData
      .filter(r => r.Product === product && r.Year === year)
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

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Server attivo su http://localhost:${PORT}`);
});
