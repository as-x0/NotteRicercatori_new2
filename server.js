import express from "express";
import http from "http";
import { Server } from "socket.io";
import fs from "fs";
import csv from "csv-parser";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// Servire file statici
app.use(express.static(path.join(__dirname, "/public")));

// ======================
// Lettura CSV
// ======================
const productsData = [];
const csvPath = path.join(__dirname, "FAOSTAT_data_en_8-10-2025.csv");

fs.createReadStream(csvPath)
  .on("error", (err) => {
    console.error("Errore apertura CSV:", err);
  })
  .pipe(csv({ separator: ";" }))
  .on("data", (row) => {
    productsData.push({
      Product: row["Item"],
      Country: row["Area"],
      Year: row["Year"],
      Value: parseFloat(row["Value"]) || 0
    });
  })
  .on("end", () => {
    console.log("CSV caricato, righe:", productsData.length);
  });

// ======================
// Endpoint API
// ======================
app.get("/api/products", (req, res) => {
  const products = [...new Set(productsData.map((p) => p.Product))];
  res.json(products);
});

app.get("/api/countries", (req, res) => {
  const countries = [...new Set(productsData.map((p) => p.Country))];
  res.json(countries);
});

app.get("/api/years", (req, res) => {
  const years = [...new Set(productsData.map((p) => p.Year))];
  res.json(years);
});

// ======================
// Gestione stanze di gioco
// ======================
const rooms = {};

io.on("connection", (socket) => {
  console.log("Nuovo client connesso:", socket.id);

  // Creazione stanza
  socket.on("createRoom", () => {
    const roomId = Math.random().toString(36).substring(2, 7).toUpperCase();
    rooms[roomId] = {
      manager: socket.id,
      players: [],
      settings: null,
      started: false
    };
    socket.join(roomId);

    const products = [...new Set(productsData.map((p) => p.Product))];
    const years = [...new Set(productsData.map((p) => p.Year))];

    socket.emit("roomCreated", { roomId, products, years });
  });

  // Join stanza
  socket.on("joinRoom", ({ roomId, name }) => {
    const room = rooms[roomId];
    if (!room) {
      socket.emit("errorMsg", "Stanza non trovata");
      return;
    }
    const player = { id: socket.id, name, countries: [], score: 0 };
    room.players.push(player);
    socket.join(roomId);

    io.to(roomId).emit("playerList", room.players);
  });

  // Imposta settaggi
  socket.on("setSettings", ({ roomId, product, year, numCountries }) => {
    const room = rooms[roomId];
    if (!room) return;

    room.settings = { product, year, numCountries };
    io.to(roomId).emit("settingsUpdated", room.settings);

    const availableCountries = [
      ...new Set(
        productsData
          .filter((p) => p.Product === product && p.Year === year)
          .map((p) => p.Country)
      )
    ];
    io.to(roomId).emit("countriesList", availableCountries);
  });

  // Avvio partita
  socket.on("startGame", (roomId) => {
    const room = rooms[roomId];
    if (!room) return;

    room.started = true;
    io.to(roomId).emit("gameStarted", room.settings);
  });

  // Scelta paese
  socket.on("selectCountry", ({ roomId, country }) => {
    const room = rooms[roomId];
    if (!room) return;

    const player = room.players.find((p) => p.id === socket.id);
    if (!player) return;

    if (!player.countries.includes(country)) {
      player.countries.push(country);
    }
    io.to(roomId).emit("playerList", room.players);
  });

  // Fine partita
  socket.on("endGame", (roomId) => {
    const room = rooms[roomId];
    if (!room) return;

    // Calcola punteggi
    if (room.settings) {
      room.players.forEach((player) => {
        let score = 0;
        player.countries.forEach((c) => {
          const match = productsData.find(
            (p) =>
              p.Product === room.settings.product &&
              p.Year === room.settings.year &&
              p.Country === c
          );
          if (match) score += match.Value;
        });
        player.score = score;
      });
    }

    const leaderboard = [...room.players].sort((a, b) => b.score - a.score);
    io.to(roomId).emit("gameEnded", leaderboard);
  });

  // Disconnessione
  socket.on("disconnect", () => {
    console.log("Client disconnesso:", socket.id);
    for (const roomId in rooms) {
      const room = rooms[roomId];
      room.players = room.players.filter((p) => p.id !== socket.id);
      io.to(roomId).emit("playerList", room.players);
    }
  });
});

// ======================
// Avvio server
// ======================
server.listen(PORT, () => {
  console.log(`Server attivo su http://localhost:${PORT}`);
});
