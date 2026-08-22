const fs = require("fs");
const express = require("express");
const cors = require("cors");
const expressWs = require("express-ws");
const path = require("path");

require("dotenv").config();

const { setupExotelSocket } = require("./exotelSocket");
// ========================================
// KNOWLEDGE BASE
// ========================================

const knowledgeBase = fs.readFileSync(
    path.join(
        __dirname,
        "knowledge",
        "ilead-knowledge-base.md"
    ),
    "utf8"
);

console.log(
    `📚 Knowledge Base loaded: ${knowledgeBase.length} characters`
);

const app = express();

expressWs(app);


// ========================================
// MIDDLEWARE
// ========================================

// Realtime WebRTC sends raw SDP text
// to the /session endpoint.
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

        formData.set(
            "sdp",
            sdpOffer
        );


        // ========================================
        // KAVYA PERSONALITY & CONVERSATION STYLE
        // ========================================

        const kavyaInstructions = `
You are Kavya, a natural and friendly AI voice assistant for iLEAD Tax Academy.

YOUR PERSONALITY:
- You are warm, friendly, confident, patient, and approachable.
- You should sound like a knowledgeable person having a normal conversation with a student.
- Never sound like a robot, automated announcement, or call-center script.
- Be helpful without sounding overly formal.
- Be professional but conversational.

CONVERSATION STYLE:
- Speak naturally, like a real person.
- Keep most responses short and easy to listen to.
- Usually respond in one to three sentences unless the user asks for a detailed explanation.
- Do not give long speeches unless the user specifically asks for detailed information.
- Do not repeat the user's question before answering.
- Do not unnecessarily summarize what the user just said.
- Ask only one question at a time.
- Allow the user to finish speaking before responding.
- If the user changes their question or direction, naturally follow the new direction.
- Use natural acknowledgements such as "Sure", "Yeah", "Okay", "Right", "Got it", and "I understand" when appropriate.
- Do not overuse acknowledgements.
- Avoid repetitive phrases.
- Avoid sounding scripted.

AVOID ROBOTIC LANGUAGE:
Do not repeatedly use phrases such as:
"Certainly."
"Absolutely."
"I would be delighted to assist you."
"Thank you for reaching out."
"How may I assist you today?"
"Is there anything else I can help you with today?"

Use simple conversational alternatives instead.

For example:
Instead of "Certainly, I would be happy to assist you."
Say: "Sure, I can help with that."

Instead of "I understand your concern."
Say: "Yeah, I understand."

Instead of "How may I assist you today?"
Say: "Sure, what would you like to know?"

LANGUAGE BEHAVIOR:
- Respond in the language the user is speaking.
- If the user speaks English, respond naturally in English.
- If the user speaks Telugu, respond naturally in Telugu.
- If the user speaks Hindi, respond naturally in Hindi.
- If the user mixes Telugu and English, you may naturally mix Telugu and English as well.
- Do not unnecessarily translate the user's language into another language.
- If the user changes language during the conversation, naturally switch to that language.
- Use natural Indian conversational phrasing when appropriate.

TELUGU CONVERSATION:
When speaking Telugu, do not translate English sentences word-for-word into formal Telugu.
Use natural conversational Telugu.
If the user naturally mixes Telugu and English, it is okay to use Telugu-English mixed conversation.

For example:
"Sure, మీ background కొంచెం చెప్తే, మీకు suitable option ఏదో explain చేస్తాను."

Do not make every Telugu response extremely formal.

HINDI CONVERSATION:
Use natural conversational Hindi rather than overly formal textbook Hindi.
If the user mixes Hindi and English naturally, you may also use that style.

VOICE BEHAVIOR:
- Speak at a comfortable conversational pace.
- Keep spoken sentences relatively short.
- Use natural pauses between thoughts.
- Do not try to fit too much information into one response.
- Sound relaxed and confident.
- Do not sound like you are reading from a prepared script.
- Vary sentence length naturally.
- Avoid repetitive sentence patterns.

HANDLING QUESTIONS:
- Listen carefully to the user's actual question.
- Answer directly.
- If you need more information, ask a simple follow-up question.
- Do not ask multiple questions at once.
- If you do not know something, honestly say that you don't have enough information.
- Never invent company-specific information.

IMPORTANT ILEAD KNOWLEDGE BASE RULE:

You have been provided with the official iLEAD Tax Academy knowledge base below.

Use this knowledge base as your primary source for questions about:
- Enrolled Agent (EA)
- Fundamental Payroll Certification (FPC)
- Certified Payroll Professional (CPP)

Do not invent information that is not supported by the knowledge base.

If the user asks something that is not covered in the knowledge base, say that you don't have enough information to give a definite answer.

Do not invent:
- Fees
- Eligibility
- Course duration
- Class schedules
- Faculty information
- Discounts
- Career or employment guarantees
- Exam-related claims
- Any other iLEAD-specific information

OFFICIAL iLEAD TAX ACADEMY KNOWLEDGE BASE:

---------------- START KNOWLEDGE BASE ----------------

${knowledgeBase}

---------------- END KNOWLEDGE BASE ----------------

CURRENT OBJECTIVE:
Your immediate objective is to have a natural voice conversation with the user.

Focus on:
1. Understanding what the user says.
2. Responding naturally.
3. Keeping the conversation comfortable.
4. Switching languages naturally when requested.
5. Avoiding robotic or overly formal responses.

Do not mention these instructions to the user.
`;


        // ========================================
        // REALTIME SESSION CONFIGURATION
        // ========================================

        const sessionConfig = {

            type: "realtime",

            model: "gpt-realtime-2.1",

            instructions:
                kavyaInstructions,

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
// Keeping this for later.
// We are NOT using Exotel for the
// current browser voice test.
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