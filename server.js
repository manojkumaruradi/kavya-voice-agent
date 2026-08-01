const express = require("express");
const cors = require("cors");
const expressWs = require("express-ws");

require("dotenv").config();

const { setupExotelSocket } = require("./exotelSocket");

const app = express();

expressWs(app);

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
    res.send("Kavya Voice Agent Running 🚀");
});

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