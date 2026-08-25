const fs = require("fs");
const express = require("express");
const cors = require("cors");
const expressWs = require("express-ws");
const path = require("path");

require("dotenv").config();

const { createClient } = require("@supabase/supabase-js");
const { setupExotelSocket } = require("./exotelSocket");


// ============================================================
// ENVIRONMENT CHECK
// ============================================================

if (!process.env.OPENAI_API_KEY) {
    console.error("❌ OPENAI_API_KEY is missing in .env");
}

if (!process.env.SUPABASE_URL) {
    console.error("❌ SUPABASE_URL is missing in .env");
}

if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error("❌ SUPABASE_SERVICE_ROLE_KEY is missing in .env");
}

if (!process.env.ELEVENLABS_API_KEY) {
    console.error("❌ ELEVENLABS_API_KEY is missing in .env");
}

if (!process.env.ELEVENLABS_VOICE_ID) {
    console.error("❌ ELEVENLABS_VOICE_ID is missing in .env");
}


// ============================================================
// SUPABASE
// ============================================================

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    {
        auth: {
            autoRefreshToken: false,
            persistSession: false
        }
    }
);

console.log("🗄️ Supabase client initialized");


// ============================================================
// LOCAL KNOWLEDGE BASE FALLBACK
// ============================================================

const knowledgeBasePath = path.join(
    __dirname,
    "knowledge",
    "ilead-knowledge-base.md"
);

let knowledgeBase = "";

try {

    knowledgeBase = fs.readFileSync(
        knowledgeBasePath,
        "utf8"
    );

    console.log(
        `📚 Local Knowledge Base available: ${knowledgeBase.length} characters`
    );

} catch (error) {

    console.log(
        "⚠️ Local knowledge base file not found. Supabase RAG will be used."
    );

}


// ============================================================
// LOCAL KNOWLEDGE SEARCH FALLBACK
// ============================================================

function searchLocalKnowledgeBase(query) {

    if (!query || typeof query !== "string") {
        return "";
    }

    if (!knowledgeBase) {
        return "";
    }

    const cleanQuery = query
        .toLowerCase()
        .replace(/[^\w\s]/g, " ")
        .split(/\s+/)
        .filter(Boolean);

    if (cleanQuery.length === 0) {
        return "";
    }

    const sections = knowledgeBase
        .split(/\n(?=#)/)
        .map(section => section.trim())
        .filter(Boolean);

    const scoredSections = sections.map(section => {

        const lowerSection =
            section.toLowerCase();

        let score = 0;

        for (const word of cleanQuery) {

            if (word.length < 2) {
                continue;
            }

            if (lowerSection.includes(word)) {
                score += 1;
            }

        }

        // EA
        if (
            cleanQuery.some(word =>
                ["ea", "enrolled", "agent"].includes(word)
            ) &&
            lowerSection.includes("enrolled agent")
        ) {
            score += 8;
        }

        // FPC
        if (
            cleanQuery.some(word =>
                ["fpc", "payroll", "fundamental"].includes(word)
            ) &&
            lowerSection.includes("fpc")
        ) {
            score += 8;
        }

        // CPP
        if (
            cleanQuery.some(word =>
                ["cpp", "payroll", "professional"].includes(word)
            ) &&
            lowerSection.includes("cpp")
        ) {
            score += 8;
        }

        // Fees
        if (
            cleanQuery.some(word =>
                ["fee", "fees", "price", "cost"].includes(word)
            ) &&
            lowerSection.includes("fee")
        ) {
            score += 6;
        }

        // Eligibility
        if (
            cleanQuery.some(word =>
                [
                    "eligibility",
                    "eligible",
                    "qualification"
                ].includes(word)
            ) &&
            lowerSection.includes("eligib")
        ) {
            score += 6;
        }

        // Duration
        if (
            cleanQuery.some(word =>
                [
                    "duration",
                    "months",
                    "month",
                    "days"
                ].includes(word)
            ) &&
            lowerSection.includes("duration")
        ) {
            score += 6;
        }

        // Exam
        if (
            cleanQuery.some(word =>
                [
                    "exam",
                    "examination",
                    "test"
                ].includes(word)
            ) &&
            lowerSection.includes("exam")
        ) {
            score += 6;
        }

        // Career / Placement
        if (
            cleanQuery.some(word =>
                [
                    "career",
                    "job",
                    "placement",
                    "support"
                ].includes(word)
            ) &&
            (
                lowerSection.includes("career") ||
                lowerSection.includes("placement") ||
                lowerSection.includes("job")
            )
        ) {
            score += 6;
        }

        return {
            section,
            score
        };

    });

    const bestSections = scoredSections
        .filter(item => item.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);

    if (bestSections.length === 0) {
        return "";
    }

    const result = bestSections
        .map(item => item.section)
        .join("\n\n");

    return result.slice(0, 12000);
}


// ============================================================
// OPENAI EMBEDDING
// ============================================================

async function createEmbedding(text) {

    if (!text || typeof text !== "string") {
        throw new Error(
            "Text is required for embedding"
        );
    }

    const response = await fetch(
        "https://api.openai.com/v1/embeddings",
        {
            method: "POST",

            headers: {
                "Content-Type":
                    "application/json",

                "Authorization":
                    `Bearer ${process.env.OPENAI_API_KEY}`
            },

            body: JSON.stringify({
                model:
                    "text-embedding-3-small",

                input:
                    text
            })
        }
    );

    const data =
        await response.json();

    if (!response.ok) {

        console.error(
            "❌ OpenAI embedding error:",
            data
        );

        throw new Error(
            data?.error?.message ||
            "Failed to create embedding"
        );
    }

    if (
        !data.data ||
        !data.data[0] ||
        !data.data[0].embedding
    ) {

        throw new Error(
            "Embedding was not returned by OpenAI"
        );
    }

    return data.data[0].embedding;
}


// ============================================================
// SUPABASE VECTOR SEARCH
// ============================================================

async function searchSupabaseKnowledge(query) {

    console.log(
        `🧠 Supabase RAG search: ${query}`
    );

    const queryEmbedding =
        await createEmbedding(query);

    console.log(
        `✅ Query embedding created: ${queryEmbedding.length} dimensions`
    );

    const { data, error } =
        await supabase.rpc(
            "match_ea_chunks",
            {
                query_embedding:
                    queryEmbedding,

                match_count:
                    3
            }
        );

    if (error) {

        console.error(
            "❌ Supabase vector search error:",
            error
        );

        throw error;
    }

    if (!data || data.length === 0) {

        console.log(
            "⚠️ No matching EA chunks found"
        );

        return "";
    }

    console.log(
        `🔎 Found ${data.length} relevant chunks`
    );

    const context = data
        .map((item, index) => {

            return `
[Knowledge Result ${index + 1}]

${item.content || ""}
`;

        })
        .join("\n");

    return context.slice(
        0,
        12000
    );
}


// ============================================================
// PRIMARY KNOWLEDGE SEARCH
// ============================================================

async function searchKnowledge(query) {

    try {

        const supabaseResult =
            await searchSupabaseKnowledge(
                query
            );

        if (supabaseResult) {
            return supabaseResult;
        }

        console.log(
            "⚠️ Supabase returned no result. Using local fallback."
        );

        return searchLocalKnowledgeBase(
            query
        );

    } catch (error) {

        console.error(
            "❌ Supabase knowledge search failed:",
            error.message
        );

        console.log(
            "↩️ Falling back to local knowledge base"
        );

        return searchLocalKnowledgeBase(
            query
        );
    }
}


// ============================================================
// EXPRESS APP
// ============================================================

const app = express();

expressWs(app);


// ============================================================
// MIDDLEWARE
// ============================================================

app.use(
    express.text({
        type: [
            "application/sdp",
            "text/plain"
        ]
    })
);

app.use(cors());

app.use(express.json());

app.use(
    express.static(
        path.join(
            __dirname,
            "public"
        )
    )
);


// ============================================================
// ELEVENLABS MANOJ VOICE - STREAMING TTS
// ============================================================

app.post(
    "/tts",
    async (req, res) => {

        try {

            const text =
                req.body?.text;

            if (
                !text ||
                typeof text !== "string"
            ) {

                return res.status(400).json({

                    success:
                        false,

                    error:
                        "text is required"

                });
            }


            if (
                !process.env.ELEVENLABS_API_KEY
            ) {

                return res.status(500).json({

                    success:
                        false,

                    error:
                        "ELEVENLABS_API_KEY is missing"

                });
            }


            if (
                !process.env.ELEVENLABS_VOICE_ID
            ) {

                return res.status(500).json({

                    success:
                        false,

                    error:
                        "ELEVENLABS_VOICE_ID is missing"

                });
            }


            console.log(
                "🎙️ Starting ElevenLabs streaming TTS..."
            );


            const startTime =
                Date.now();


            // ==================================================
            // ELEVENLABS STREAMING ENDPOINT
            // ==================================================

            const response =
                await fetch(

                    `https://api.elevenlabs.io/v1/text-to-speech/${process.env.ELEVENLABS_VOICE_ID}/stream?output_format=mp3_44100_128`,

                    {

                        method:
                            "POST",

                        headers: {

                            "Content-Type":
                                "application/json",

                            "xi-api-key":
                                process.env.ELEVENLABS_API_KEY

                        },

                        body:
                            JSON.stringify({

                                text:
                                    text,

                                model_id:
                                    "eleven_flash_v2_5"

                            })

                    }

                );


            // ==================================================
            // CHECK ELEVENLABS RESPONSE
            // ==================================================

            if (
                !response.ok
            ) {

                const errorText =
                    await response.text();


                console.error(
                    "❌ ElevenLabs streaming error:",
                    errorText
                );


                return res
                    .status(
                        response.status
                    )
                    .send(
                        errorText
                    );

            }


            // ==================================================
            // STREAM AUDIO DIRECTLY TO BROWSER
            // ==================================================

            res.status(200);

            res.setHeader(
                "Content-Type",
                "audio/mpeg"
            );

            res.setHeader(
                "Transfer-Encoding",
                "chunked"
            );

            res.setHeader(
                "Cache-Control",
                "no-cache"
            );

            res.setHeader(
                "Connection",
                "keep-alive"
            );


            if (
                !response.body
            ) {

                throw new Error(
                    "ElevenLabs returned no audio stream"
                );

            }


            // ==================================================
            // READ STREAM
            // ==================================================

            const reader =
                response.body.getReader();


            let firstChunk =
                true;


            let totalBytes =
                0;


            while (true) {

                const {
                    done,
                    value
                } =
                    await reader.read();


                if (
                    done
                ) {

                    break;

                }


                if (
                    value
                ) {

                    totalBytes +=
                        value.length;


                    // ------------------------------------------
                    // FIRST AUDIO CHUNK
                    // ------------------------------------------

                    if (
                        firstChunk
                    ) {

                        console.log(
                            `⚡ First ElevenLabs audio chunk received in ${Date.now() - startTime}ms`
                        );


                        firstChunk =
                            false;

                    }


                    // ------------------------------------------
                    // SEND CHUNK TO BROWSER
                    // ------------------------------------------

                    res.write(
                        Buffer.from(
                            value
                        )
                    );

                }

            }


            console.log(
                `✅ ElevenLabs stream completed: ${totalBytes} bytes`
            );


            res.end();


        } catch (error) {

            console.error(
                "❌ Manoj streaming TTS error:",
                error
            );


            if (
                !res.headersSent
            ) {

                return res
                    .status(500)
                    .json({

                        success:
                            false,

                        error:
                            "Manoj streaming TTS failed",

                        details:
                            error.message

                    });

            }


            try {

                res.end();

            } catch (endError) {

                console.error(
                    "❌ Failed to close TTS response:",
                    endError
                );

            }

        }

    }
);

// ============================================================
// HOME PAGE
// ============================================================

app.get(
    "/",
    (req, res) => {

        res.sendFile(
            path.join(
                __dirname,
                "public",
                "index.html"
            )
        );

    }
);


// ============================================================
// KNOWLEDGE SEARCH API
// ============================================================

app.post(
    "/knowledge-search",
    async (req, res) => {

        try {

            const query =
                req.body?.query;

            if (
                !query ||
                typeof query !== "string"
            ) {

                return res
                    .status(400)
                    .json({

                        success:
                            false,

                        error:
                            "query is required"

                    });
            }


            console.log(
                `🔎 Knowledge search request: ${query}`
            );


            const result =
                await searchKnowledge(
                    query
                );


            return res.json({

                success:
                    true,

                query,

                context:
                    result

            });


        } catch (error) {

            console.error(
                "❌ Knowledge search API error:",
                error
            );


            return res
                .status(500)
                .json({

                    success:
                        false,

                    error:
                        "Knowledge search failed",

                    details:
                        error.message

                });

        }

    }
);


// ============================================================
// OPENAI REALTIME WEBRTC SESSION
// ============================================================

app.post(
    "/session",
    async (req, res) => {

        try {

            console.log(
                "===================================="
            );

            console.log(
                "🌐 WEBRTC SESSION REQUEST"
            );

            console.log(
                "===================================="
            );


            // ==================================================
            // RECEIVE SDP
            // ==================================================

            const sdpOffer =
                req.body;

            if (
                !sdpOffer ||
                typeof sdpOffer !== "string"
            ) {

                console.log(
                    "❌ SDP offer missing or invalid"
                );

                return res
                    .status(400)
                    .json({

                        error:
                            "SDP offer is required"

                    });
            }


            console.log(
                "✅ SDP offer received"
            );

            console.log(
                "SDP length:",
                sdpOffer.length
            );


            // ==================================================
            // CREATE MULTIPART FORM
            // ==================================================

            const formData =
                new FormData();


            formData.set(
                "sdp",
                sdpOffer
            );


            // ==================================================
            // MANOJ INSTRUCTIONS
            // ==================================================

            const manojInstructions = `

You are Manoj.

You are a friendly, natural conversational AI assistant.

Have a normal conversation with the user.

Respond in the same language the user speaks:

LANGUAGE RULES — VERY IMPORTANT:

First identify the language of the user's latest message.

If the user speaks Telugu:
- Respond ONLY in natural conversational Telugu.
- Do NOT respond in Hindi.
- Do NOT respond in Tamil.
- English professional terms can be used naturally.
- If Telugu contains English words, it is still Telugu.

If the user speaks Hindi:
- Respond ONLY in natural conversational Hindi.
- Do NOT respond in Telugu.
- Do NOT respond in Tamil.
- English professional terms can be used naturally.

If the user speaks English:
- Respond ONLY in natural conversational English.

NEVER change the response language unless the user changes their
language.

Examples:

User:
"EA course gurinchi cheppu"

Response:
Natural conversational Telugu.

User:
"Naaku eligibility enti?"

Response:
Natural conversational Telugu.

User:
"EA course ke baare mein batao"

Response:
Natural conversational Hindi.

User:
"Tell me about the EA course."

Response:
Natural conversational English.

IMPORTANT:
Telugu must never be automatically converted into Hindi or Tamil.
The user's latest spoken language determines the response language.

TELUGU VOICE STYLE:

When speaking Telugu, use natural everyday conversational Telugu,
especially Telangana-style conversational Telugu.

Do not use formal, literary, textbook, news-reader, or translated Telugu.

Speak like a normal person having a friendly conversation.

Use Telugu naturally mixed with commonly used English words.

Keep sentences short and easy to speak.

Use casual conversational words such as:
"okay", "sare", "avunu", "ledu", "cheppandi", "chuddam",
"mee background enti?", "meeku em kavali?", "adi okay",
when they naturally fit the conversation.

Do not translate English sentences word-for-word into Telugu.

Avoid formal phrases such as:
"మీకు అవసరమైన సమాచారాన్ని అందించగలను"
"మీరు ఈ కోర్సును అభ్యసించుటకు"
"దయచేసి మీ వివరాలను తెలియజేయండి"

Prefer natural conversational wording such as:
"Meeku information kavali ante cheptha."
"Meeru mee background cheppandi."
"Okay, adi chuddam."
"Meeku exact ga em telusukovali?"

The response should sound like a normal human conversation,
not like a presentation or news reading.

Keep Telugu responses concise, usually 1–3 sentences.

`;
            // ==================================================
            // REALTIME SESSION CONFIGURATION
            // ==================================================

            // IMPORTANT:
            // Knowledge lookup is temporarily DISABLED.
            //
            // We are testing only:
            //
            // User
            //   ↓
            // OpenAI
            //   ↓
            // Text
            //   ↓
            // ElevenLabs
            //   ↓
            // Manoj Voice
            //
            // The existing knowledge-base files, Supabase data,
            // embedding functions and /knowledge-search API
            // are NOT deleted.
            //
            // They are simply not attached as a Realtime tool
            // during this temporary voice-only test.

            const sessionConfig = {

                type:
                    "realtime",

                model:
                    "gpt-realtime-2.1-mini",

                instructions:
                    manojInstructions,

                output_modalities: [
                    "text"
                ]

            };


            // ==================================================
            // ADD SESSION CONFIG
            // ==================================================

            formData.set(
                "session",
                JSON.stringify(
                    sessionConfig
                )
            );


            console.log(
                "📤 Sending SDP to OpenAI..."
            );


            // ==================================================
            // SEND TO OPENAI
            // ==================================================

            const response =
                await fetch(
                    "https://api.openai.com/v1/realtime/calls",
                    {

                        method:
                            "POST",

                        headers: {

                            Authorization:
                                `Bearer ${process.env.OPENAI_API_KEY}`

                        },

                        body:
                            formData

                    }
                );


            // ==================================================
            // READ RESPONSE
            // ==================================================

            const answer =
                await response.text();


            console.log(
                "OpenAI Status:",
                response.status
            );


            // ==================================================
            // HANDLE ERROR
            // ==================================================

            if (!response.ok) {

                console.log(
                    "❌ OPENAI WEBRTC ERROR"
                );

                console.log(
                    answer
                );

                return res
                    .status(
                        response.status
                    )
                    .send(
                        answer
                    );
            }


            // ==================================================
            // SUCCESS
            // ==================================================

            console.log(
                "✅ OpenAI SDP answer received"
            );

            console.log(
                "SDP answer length:",
                answer.length
            );


            res
                .type(
                    "application/sdp"
                )
                .send(
                    answer
                );


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

            console.error(
                error
            );


            res
                .status(500)
                .json({

                    error:
                        "Failed to create WebRTC session",

                    details:
                        error.message

                });

        }

    }
);


// ============================================================
// EXOTEL WEBSOCKET
// ============================================================

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

                    callback(
                        ws
                    );

                }

            }

        });

    }
);


// ============================================================
// START SERVER
// ============================================================

const PORT =
    process.env.PORT || 3000;


app.listen(
    PORT,
    () => {

        console.log(
            `🚀 Server running on port ${PORT}`
        );

        console.log(
            `🧠 Supabase RAG: ENABLED`
        );

        console.log(
            `🔎 Knowledge API: http://localhost:${PORT}/knowledge-search`
        );

        console.log(
            `🎙️ ElevenLabs TTS: ENABLED`
        );

        console.log(
            `🗣️ Voice ID: ${process.env.ELEVENLABS_VOICE_ID}`
        );

    }
);