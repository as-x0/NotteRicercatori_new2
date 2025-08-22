import express from "express";
socket.on("selectCountry", ({ roomId, country }) => {
const room = rooms[roomId];
if (!room) return socket.emit("errorMsg", "Stanza non trovata");


const player = room.players.find((p) => p.id === socket.id);
if (!player) return socket.emit("errorMsg", "Giocatore non in stanza");


if (!room.settings.product || !room.settings.year) return socket.emit("errorMsg", "Il gestore non ha ancora impostato le impostazioni");


const available = countriesFor(room.settings.product, room.settings.year).filter((c) => !room.usedCountries.has(c));


if (!available.includes(country)) return socket.emit("errorMsg", "Paese non disponibile");


const limit = Number(room.settings.numCountries) || 3;
if (player.countries.length >= limit) return socket.emit("errorMsg", `Hai già selezionato ${limit} paesi`);


player.countries.push(country);
room.usedCountries.add(country);


emitPlayerList(roomId);
emitCountriesList(roomId);
});


socket.on("endGame", (roomId) => {
const room = rooms[roomId];
if (!room) return socket.emit("errorMsg", "Stanza non trovata");
if (room.manager !== socket.id) return socket.emit("errorMsg", "Solo il gestore può terminare la partita");


const { product, year } = room.settings;
const leaderboard = room.players.map((p) => {
const score = p.countries.reduce((sum, c) => sum + getExportValue(product, c, year), 0);
p.score = score;
return { name: p.name, score };
});


leaderboard.sort((a, b) => b.score - a.score);
io.to(roomId).emit("gameEnded", leaderboard);
});


socket.on("disconnect", () => {
// Rimuovi il player da eventuale stanza
for (const [roomId, room] of Object.entries(rooms)) {
const idx = room.players.findIndex((p) => p.id === socket.id);
if (idx !== -1) {
room.players.splice(idx, 1);
emitPlayerList(roomId);
}
if (room.manager === socket.id) {
// Se si disconnette il manager, chiudi stanza
io.to(roomId).emit("errorMsg", "Il gestore si è disconnesso. Stanza chiusa.");
delete rooms[roomId];
}
}
console.log("👋 Client disconnesso:", socket.id);
});
});


// Avvio server
server.listen(PORT, async () => {
try { await loadCSV(); } catch (e) {}
console.log(`Server attivo su http://localhost:${PORT}`);
});
