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

// dizionario traduzioni prodotti (esempio base, estendilo con il tuo CSV reale)
const productTranslations = {
  "Coffee, green": "Caffè verde",
  "Maize": "Mais",
  "Rice, paddy": "Riso",
  "Wheat": "Grano",
  "Soybeans": "Soia"
};

fs.createReadStream(csvPath)
  .on("error", (err) => {
    console.error("Errore apertura CSV:", err);
  })
  .pipe(csv({ separator: ";" }))
  .on("data", (row) => {
    productsData.push({
      Product: row["Item"],
      ProductIT: productTranslations[row["Item"]] || row["Item"],
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
  const products = [...new Set(productsData.map((p) => p.ProductIT))];
  res.json(products);
});

app.get("/api/countries", (req, res) => {
  const countries = [...new Set(productsData.map((p) => p.Country))];
  res.json(countries);
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

    const products = [...new Set(productsData.map((p) => p.ProductIT))];

    socket.emit("roomCreated", { roomId, products });
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
  socket.on("setSettings", ({ roomId, product, numCountries }) => {
    const room = rooms[roomId];
    if (!room) return;

    room.settings = { product, year: 2023, numCountries };
    io.to(roomId).emit("settingsUpdated", room.settings);

    const availableCountries = [
      ...new Set(
        productsData
          .filter((p) => p.ProductIT === product && p.Year === "2023")
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

  // Scelta paesi (player invia array di paesi)
  socket.on("submitCountries", ({ roomId, countries }) => {
    const room = rooms[roomId];
    if (!room) return;

    const player = room.players.find((p) => p.id === socket.id);
    if (!player) return;

    player.countries = countries;
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
              p.ProductIT === room.settings.product &&
              p.Year === "2023" &&
              p.Country === c
          );
          if (match) score += match.Value;
        });
        player.score = score;
      });
    }

    const leaderboard = [...room.players].sort((a, b) => b.score - a.score);

    // calcola top5 paesi esportatori
    const productRows = productsData.filter(
      (p) => p.ProductIT === room.settings.product && p.Year === "2023"
    );
    const aggByCountry = {};
    productRows.forEach((r) => {
      aggByCountry[r.Country] = (aggByCountry[r.Country] || 0) + r.Value;
    });
    const top5 = Object.entries(aggByCountry)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([country, value]) => ({ country, value }));

    io.to(roomId).emit("gameEnded", { leaderboard, top5, product: room.settings.product });
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
