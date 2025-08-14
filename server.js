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

// Cartella pubblica
app.use(express.static(path.join(__dirname, "public")));

// ======== Lettura CSV ========
let exportData = [];
let products = new Set();
let years = new Set();
let countries = new Set();

fs.createReadStream(path.join(__dirname, "FAOSTAT_data_en_8-10-2025.csv"))
  .pipe(csv())
  .on("data", (row) => {
    const area = row.Area?.trim();
    const item = row.Item?.trim();
    const element = row.Element?.trim();
    const year = row.Year?.trim();
    const value = parseFloat(row.Value) || 0;

    if (element?.toLowerCase().includes("export")) {
      exportData.push({ area, item, year, value });
      products.add(item);
      years.add(year);
      countries.add(area);
    }
  })
  .on("end", () => {
    console.log(`✅ CSV caricato con ${exportData.length} righe`);
    console.log(`Prodotti: ${products.size} | Anni: ${years.size} | Paesi: ${countries.size}`);
  });

// ======== Gestione stanze ========
let rooms = {};

io.on("connection", (socket) => {
  console.log(`🔌 Nuova connessione: ${socket.id}`);

  socket.on("createRoom", ({ roomId, product, year, numCountries }) => {
    rooms[roomId] = {
      players: {},
      status: "waiting",
      product,
      year,
      numCountries,
    };
    socket.join(roomId);
    console.log(`🛠️ Stanza creata: ${roomId}`);
    socket.emit("roomCreated", roomId);
  });

  socket.on("getProducts", () => {
    socket.emit("productsList", Array.from(products).sort());
  });

  socket.on("joinRoom", ({ roomId, name }) => {
    const room = rooms[roomId];
    if (room && room.status === "waiting") {
      room.players[socket.id] = { name, countries: [] };
      socket.join(roomId);
      io.to(roomId).emit("playerList", Object.values(room.players));
      socket.emit("countriesList", Array.from(countries).sort());
      console.log(`👤 ${name} è entrato nella stanza ${roomId}`);
    } else {
      socket.emit("errorMsg", "Stanza non trovata o partita già iniziata");
    }
  });

  socket.on("startGame", (roomId) => {
    const room = rooms[roomId];
    if (room) {
      room.status = "started";
      io.to(roomId).emit("gameStarted", {
        product: room.product,
        year: room.year,
        numCountries: room.numCountries,
      });
      console.log(`▶️ Partita iniziata in stanza ${roomId}`);
    }
  });

  socket.on("submitCountry", ({ roomId, country }) => {
    const room = rooms[roomId];
    if (!room || room.status !== "started") return;

    const player = room.players[socket.id];
    if (!player) return;

    if (player.countries.length < room.numCountries && countries.has(country)) {
      if (!player.countries.includes(country)) {
        player.countries.push(country);
        socket.emit("countryAccepted", country);
        io.to(roomId).emit("playerList", Object.values(room.players));
      } else {
        socket.emit("errorMsg", "Hai già scelto questo paese");
      }
    } else {
      socket.emit("errorMsg", "Limite di paesi raggiunto o paese non valido");
    }
  });

  socket.on("disconnect", () => {
    for (const roomId in rooms) {
      const room = rooms[roomId];
      if (room.players[socket.id]) {
        console.log(`❌ ${room.players[socket.id].name} ha lasciato ${roomId}`);
        delete room.players[socket.id];
        io.to(roomId).emit("playerList", Object.values(room.players));
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`🌐 Server in ascolto su http://localhost:${PORT}`);
});
