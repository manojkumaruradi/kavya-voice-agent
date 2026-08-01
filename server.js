const express = require("express");
const cors = require("cors");
const http = require("http");
const WebSocket = require("ws");
require("dotenv").config();

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
    res.send("Kavya Voice Agent is Running 🚀");
});

// HTTP endpoint (testing)
app.post("/voice", (req, res) => {
    console.log("Incoming HTTP request");
    res.json({
        message: "Voice endpoint working"
    });
});

const server = http.createServer(app);

// WebSocket Server
const wss = new WebSocket.Server({
    server,
    path: "/stream"
});

wss.on("connection", (ws) => {
    console.log("✅ Exotel Stream Connected");

    ws.on("message", (message) => {
        console.log("Received:", message.toString());
    });

    ws.on("close", () => {
        console.log("❌ Stream Disconnected");
    });

    ws.send(JSON.stringify({
        event: "connected"
    }));
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});