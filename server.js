const express = require("express");
const cors = require("cors");
const expressWs = require("express-ws");
const path = require("path");

require("dotenv").config();

const { setupExotelSocket } = require("./exotelSocket");

const app = express();

expressWs(app);

app.use(cors());
app.use(express.json());

app.use(express.static(path.join(__dirname, "public")));

// ========================================
// HOME PAGE
// ========================================

app.get("/", (req, res) => {

    res.sendFile(
        path.join(__dirname, "public", "index.html")
    );

});

// ========================================
// OPENAI REALTIME WEBRTC SESSION
// ========================================
//
// Browser sends SDP offer here.
// Server sends it to OpenAI.
// OpenAI returns SDP answer.
// Server returns that answer to browser.
//
// ========================================

app.post("/session", async (req, res) => {

    try {

        console.log("====================================");
        console.log("🌐 WebRTC Session Request");
        console.log("====================================");

        const sdpOffer = req.body.sdp;

        if (!sdpOffer) {

            console.log("❌ No SDP offer received");

            return res.status(400).json({
                error: "Missing SDP offer"
            });

        }

        console.log("✅ SDP offer received");

        const formData = new FormData();

        formData.append(
            "sdp",
            new Blob([sdpOffer], {
                type: "application/sdp"
            })
        );

        formData.append(
            "session",
            JSON.stringify({
                type: "realtime",
                model: "gpt-realtime-2.1",
                instructions:
                    "You are Kavya, a friendly AI Voice Assistant. Speak naturally and briefly. Keep your answers concise and conversational.",
                audio: {
                    output: {
                        voice: "marin"
                    }
                }
            })
        );

        console.log("📤 Sending SDP offer to OpenAI...");

        const response = await fetch(
            "https://api.openai.com/v1/realtime/calls",
            {
                method: "POST",

                headers: {
                    Authorization:
                        `Bearer ${process.env.OPENAI_API_KEY}`
                },

                body: formData
            }
        );

        const answer = await response.text();

        console.log(
            "OpenAI Status:",
            response.status
        );

        if (!response.ok) {

            console.log("❌ OpenAI WebRTC Error:");
            console.log(answer);

            return res.status(response.status).send(answer);

        }

        console.log("✅ OpenAI SDP Answer Received");

        res.type("application/sdp");

        res.send(answer);

    } catch (error) {

        console.log("====================================");
        console.log("❌ WebRTC Session Error");
        console.log("====================================");

        console.log(error);

        res.status(500).json({
            error: error.message
        });

    }

});

// ========================================
// EXISTING EXOTEL WEBSOCKET
// ========================================
//
// We are NOT using Exotel now.
// Keep this code for later.
//
// ========================================

app.ws("/media-stream", (ws, req) => {

    console.log("📞 Incoming Exotel WebSocket");

    setupExotelSocket({
        on: (event, callback) => {

            if (event === "connection") {

                callback(ws);

            }

        }

    });

});

// ========================================
// START SERVER
// ========================================

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {

    console.log(
        `🚀 Server running on port ${PORT}`
    );

});