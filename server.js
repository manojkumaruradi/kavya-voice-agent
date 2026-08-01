const express = require("express");
const cors = require("cors");
require("dotenv").config();

const { connectOpenAI } = require("./openaiRealtime");

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
    res.send("Kavya Voice Agent is Running 🚀");
});

app.post("/voice", (req, res) => {
    console.log("Incoming Voice Call");

    res.json({
        message: "Voice endpoint working"
    });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, async () => {
    console.log(`Server running on port ${PORT}`);

    try {
        await connectOpenAI();
    } catch (err) {
        console.error("OpenAI Connection Failed:", err.message);
    }
});