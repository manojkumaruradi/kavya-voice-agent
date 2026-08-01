const WebSocket = require("ws");

let openAiSocket = null;

function connectOpenAI() {

    openAiSocket = new WebSocket(
        "wss://api.openai.com/v1/realtime?model=gpt-realtime",
        {
            headers: {
                Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
            }
        }
    );

    openAiSocket.on("open", () => {

        console.log("✅ Connected to OpenAI Realtime");

        openAiSocket.send(JSON.stringify({
            type: "session.update",
            session: {
                modalities: ["audio", "text"],
                instructions:
                    "You are Kavya, a friendly AI Voice Assistant. Speak naturally and briefly.",
                voice: "alloy"
            }
        }));

    });

    openAiSocket.on("message", (message) => {

        try {

            const data = JSON.parse(message);

            console.log("OpenAI:", data.type);

        } catch {

            console.log(message.toString());

        }

    });

    openAiSocket.on("close", () => {

        console.log("❌ OpenAI disconnected");

    });

    openAiSocket.on("error", (err) => {

        console.log("OpenAI Error:", err.message);

    });

    return openAiSocket;

}

module.exports = {
    connectOpenAI
};