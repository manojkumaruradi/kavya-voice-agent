const express = require("express");
const cors = require("cors");
const expressWs = require("express-ws");
const path = require("path");

require("dotenv").config();

const { setupExotelSocket } = require("./exotelSocket");

const app = express();

expressWs(app);


// ========================================
// MIDDLEWARE
// ========================================

// IMPORTANT:
// Realtime WebRTC sends raw SDP text to /session.
app.use(
    express.text({
        type: ["application/sdp", "text/plain"]
    })
);

app.use(cors());

app.use(express.json());

app.use(
    express.static(
        path.join(__dirname, "public")
    )
);


// ========================================
// HOME PAGE
// ========================================

app.get("/", (req, res) => {

    res.sendFile(
        path.join(
            __dirname,
            "public",
            "index.html"
        )
    );

});


// ========================================
// OPENAI REALTIME WEBRTC SESSION
// ========================================
//
// Browser
//     ↓
// Raw SDP
//     ↓
// /session
//     ↓
// OpenAI /v1/realtime/calls
//     ↓
// SDP Answer
//     ↓
// Browser
//
// ========================================

app.post("/session", async (req, res) => {

    try {

        console.log("====================================");
        console.log("🌐 WEBRTC SESSION REQUEST");
        console.log("====================================");

        const sdpOffer = req.body;

        if (
            !sdpOffer ||
            typeof sdpOffer !== "string"
        ) {

            console.log(
                "❌ SDP offer missing or invalid"
            );

            return res.status(400).json({
                error: "SDP offer is required"
            });

        }

        console.log(
            "✅ SDP offer received"
        );

        console.log(
            "SDP length:",
            sdpOffer.length
        );


        // ========================================
        // CREATE MULTIPART FORM
        // ========================================

        const formData = new FormData();


        // IMPORTANT:
        // SDP must be a STRING field.
        // Do NOT send it as a Blob/file.
        formData.set(
            "sdp",
            sdpOffer
        );


        // ========================================
        // REALTIME SESSION CONFIGURATION
        // ========================================

        const sessionConfig = {
            type: "realtime",

            model: "gpt-realtime-2.1",

            instructions:
                "You are Kavya, a friendly AI Voice Assistant. Speak naturally and briefly. Keep your answers concise and conversational.",

            audio: {

                output: {

                    voice: "marin"

                }

            }

        };


        formData.set(
            "session",
            JSON.stringify(sessionConfig)
        );


        console.log(
            "📤 Sending SDP to OpenAI..."
        );


        // ========================================
        // SEND TO OPENAI
        // ========================================

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


        const answer =
            await response.text();


        console.log(
            "OpenAI Status:",
            response.status
        );


        // ========================================
        // HANDLE OPENAI ERROR
        // ========================================

        if (!response.ok) {

            console.log(
                "❌ OPENAI WEBRTC ERROR"
            );

            console.log(answer);

            return res
                .status(response.status)
                .send(answer);

        }


        // ========================================
        // SUCCESS
        // ========================================

        console.log(
            "✅ OpenAI SDP answer received"
        );

        console.log(
            "SDP answer length:",
            answer.length
        );


        res
            .type("application/sdp")
            .send(answer);


    } catch (error) {

        console.log(
            "===================================="
        );

        console.log(
            "❌ WEBRTC SESSION ERROR"
        );

        console.log(
            "===================================="
        );

        console.error(error);


        res.status(500).json({

            error:
                "Failed to create WebRTC session",

            details:
                error.message

        });

    }

});


// ========================================
// EXOTEL WEBSOCKET
// ========================================
//
// KEEPING THIS FOR LATER.
// We are NOT using Exotel for the
// browser voice test.
//
// ========================================

app.ws(
    "/media-stream",
    (ws, req) => {

        console.log(
            "📞 Incoming Exotel WebSocket"
        );

        setupExotelSocket({

            on: (
                event,
                callback
            ) => {

                if (
                    event ===
                    "connection"
                ) {

                    callback(ws);

                }

            }

        });

    }
);


// ========================================
// START SERVER
// ========================================

const PORT =
    process.env.PORT || 3000;


app.listen(
    PORT,
    () => {

        console.log(
            `🚀 Server running on port ${PORT}`
        );

    }
);