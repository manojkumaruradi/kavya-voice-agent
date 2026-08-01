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

        const sessionConfig = {
            type: "session.update",
            session: {
                instructions:
                    "You are Kavya, a friendly AI Voice Assistant. Speak naturally and briefly.",
                output_modalities: ["audio"]
            }
        };

        console.log("====================================");
        console.log("Sending Session Update");
        console.log(JSON.stringify(sessionConfig, null, 2));
        console.log("====================================");

        openAiSocket.send(JSON.stringify(sessionConfig));

    });

    openAiSocket.on("message", (message) => {

        try {

            const data = JSON.parse(message.toString());

            console.log("====================================");
            console.log("OpenAI Response");
            console.log(JSON.stringify(data, null, 2));
            console.log("====================================");

        } catch (err) {

            console.log("Raw Message:");
            console.log(message.toString());

        }

    });

    openAiSocket.on("close", () => {

        console.log("❌ OpenAI disconnected");

    });

    openAiSocket.on("error", (err) => {

        console.log("❌ OpenAI Error");
        console.log(err);

    });

    return openAiSocket;

}

module.exports = {
    connectOpenAI
};