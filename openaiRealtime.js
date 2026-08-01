const WebSocket = require("ws");

let openAiSocket = null;

function connectOpenAI() {

    openAiSocket = new WebSocket(
        "wss://api.openai.com/v1/realtime?model=gpt-realtime",
        {
            headers: {
                Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
                "OpenAI-Beta": "realtime=v1"
            }
        }
    );

    openAiSocket.on("open", () => {

        console.log("✅ Connected to OpenAI Realtime");

    });

    openAiSocket.on("message", (message) => {

        console.log("OpenAI:", message.toString());

    });

    openAiSocket.on("close", () => {

        console.log("❌ OpenAI disconnected");

    });

    openAiSocket.on("error", (err) => {

        console.log(err);

    });

    return openAiSocket;

}

module.exports = {

    connectOpenAI

};