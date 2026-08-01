const { connectOpenAI } = require("./openaiRealtime");

function setupExotelSocket(wss) {

    wss.on("connection", (ws) => {

        console.log("📞 Exotel Connected");

        const openAiSocket = connectOpenAI();

        ws.on("message", (message) => {

            try {

                const data = JSON.parse(message);

                console.log("Exotel Event:", data.event);

                switch (data.event) {

                    case "connected":
                        console.log("✅ Call Connected");
                        break;

                    case "start":
                        console.log("▶️ Call Started");
                        break;

                    case "media":
                        console.log("🎤 Audio Packet Received");

                        // We'll forward this audio to OpenAI
                        break;

                    case "stop":
                        console.log("⛔ Call Ended");
                        break;

                    default:
                        console.log(data);

                }

            } catch (err) {

                console.log("Raw:", message.toString());

            }

        });

        ws.on("close", () => {

            console.log("📴 Exotel Disconnected");

        });

    });

}

module.exports = {
    setupExotelSocket
};