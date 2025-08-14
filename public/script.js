const socket = io();

function createRoom() {
  const product = document.getElementById("product").value;
  const numCountries = parseInt(document.getElementById("numCountries").value);
  socket.emit("createRoom", { product, numCountries });
}

function joinRoom() {
  const roomId = document.getElementById("joinRoomId").value.trim();
  const playerName = document.getElementById("playerName").value.trim();
  socket.emit("joinRoom", { roomId, playerName });
}

function startGame() {
  const roomId = document.getElementById("roomId").textContent;
  socket.emit("startGame", roomId);
}

function submitCountries() {
  const countries = document.getElementById("countries").value.split(",").map(c => c.trim());
  const roomId = window.currentRoom;
  socket.emit("submitCountries", { roomId, countries });
}

function endGame() {
  const roomId = document.getElementById("roomId").textContent;
  socket.emit("endGame", roomId);
}

// Eventi Socket.IO
socket.on("roomCreated", (roomId) => {
  document.getElementById("setup").style.display = "none";
  document.getElementById("room").style.display = "block";
  document.getElementById("roomId").textContent = roomId;
});

socket.on("playerList", (players) => {
  const list = document.getElementById("players");
  list.innerHTML = "";
  players.forEach(p => {
    const li = document.createElement("li");
    li.textContent = p.name;
    list.appendChild(li);
  });
});

socket.on("joinedRoom", ({ roomId }) => {
  window.currentRoom = roomId;
  document.getElementById("join").style.display = "none";
  document.getElementById("game").style.display = "block";
});

socket.on("gameStarted", () => {
  document.getElementById("game").style.display = "block";
});

socket.on("gameEnded", (leaderboard) => {
  document.getElementById("game").style.display = "none";
  document.getElementById("results").style.display = "block";
  const lb = document.getElementById("leaderboard");
  lb.innerHTML = "";
  leaderboard.forEach(player => {
    const li = document.createElement("li");
    li.textContent = `${player.name}: ${player.score} punti`;
    lb.appendChild(li);
  });
});

socket.on("errorMsg", (msg) => {
  alert(msg);
});
