// server.js
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

// Lettura CSV
const productsData = [];
const csvPath = path.join(__dirname, "FAOSTAT_data_en_8-10-2025.csv");

fs.createReadStream(csvPath)
  .on("error", (err) => {
    console.error("Errore apertura CSV:", err);
  })
  .pipe(csv())
  .on("data", (row) => {
    // row dovrebbe avere: Product, Country, ExportValue
    productsData.push(row);
  })
  .on("end", () => {
    console.log("CSV caricato, righe:", productsData.length);
  });

// Endpoint API per il manager: lista prodotti unici
app.get("/api/products", (req, res) => {
  const products = [...new Set(productsData.map((p) => p.Product))];
  res.json(products);
});

// Endpoint API per il player: autocomplete dei paesi
app.get("/api/countries", (req, res) => {
  const countries = [...new Set(productsData.map((p) => p.Country))];
  res.json(countries);
});

// Socket.IO gestione gioco
io.on("connection", (socket) => {
  console.log("Nuovo client connesso:", socket.id);

  socket.on("playerAnswer", (data) => {
    // data: { product, country, value }
    console.log("Risposta ricevuta:", data);
    // Puoi implementare logica punteggio qui
    io.emit("updateScore", data);
  });

  socket.on("disconnect", () => {
    console.log("Client disconnesso:", socket.id);
  });
});

// Avvio server
server.listen(PORT, () => {
  console.log(`Server attivo su http://localhost:${PORT}`);
});
