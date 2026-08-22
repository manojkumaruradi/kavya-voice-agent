const express = require("express");
const cors = require("cors");
const expressWs = require("express-ws");
const path = require("path");

require("dotenv").config();

const { setupExotelSocket } = require("./exotelSocket");

const app = express();

expressWs(app);

app.use(express.static(path.join(__dirname, "public")));

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {

    res.sendFile(
        path.join(__dirname, "public", "index.html")
    );

});

/*
=========================================
NEW API
Creates OpenAI Realtime Session
=========================================
*/

app.post("/session", async (req, res) => {

    try {

        const response = await fetch(
            "https://api.openai.com/v1/realtime/sessions",
            {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    model: "gpt-realtime-2.1",
                    voice: "marin"
                })
            }
        );

        const data = await response.json();

        res.json(data);

    } catch (err) {

        console.log(err);

        res.status(500).json({
            error: err.message
        });

    }

});

/*
=========================================
Existing WebSocket
=========================================
*/

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

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {

    console.log(`Server running on port ${PORT}`);

});