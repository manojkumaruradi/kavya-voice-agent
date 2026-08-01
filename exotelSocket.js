const { connectOpenAI } = require("./openaiRealtime");

function setupExotelSocket(wss) {

    wss.on("connection", (ws) => {

        console.log("📞 Exotel Connected");

        const openAiSocket = connectOpenAI();

        ws.on("message", (message) => {

            console.log("================================");
            console.log("📩 RAW MESSAGE FROM EXOTEL");
            console.log(message.toString());
            console.log("================================");

            try {

                const data = JSON.parse(message.toString());

                console.log("📌 Event:", data.event);

                switch (data.event) {

                    case "connected":
                        console.log("✅ Call Connected");
                        break;

                    case "start":
                        console.log("▶️ Call Started");
                        console.log(JSON.stringify(data, null, 2));
                        break;

                    case "media":
                        console.log("🎤 Audio Packet Received");

                        console.log(
                            "Payload Length:",
                            data.media?.payload?.length || 0
                        );

                        // Next step:
                        // We'll send data.media.payload to OpenAI here.

                        break;

                    case "stop":
                        console.log("⛔ Call Ended");
                        console.log(JSON.stringify(data, null, 2));
                        break;

                    default:
                        console.log("📦 Unknown Event");
                        console.log(JSON.stringify(data, null, 2));

                }

            } catch (err) {

                console.log("❌ JSON Parse Error");
                console.log(err.message);

            }

        });

        ws.on("close", () => {

            console.log("📴 Exotel Disconnected");

        });

        ws.on("error", (err) => {

            console.log("❌ WebSocket Error");
            console.log(err);

        });

    });

}

module.exports = {
    setupExotelSocket
};