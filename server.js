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
    console.error("âŒ OPENAI_API_KEY is missing in .env");
}

if (!process.env.SUPABASE_URL) {
    console.error("âŒ SUPABASE_URL is missing in .env");
}

if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error("âŒ SUPABASE_SERVICE_ROLE_KEY is missing in .env");
}

if (!process.env.ELEVENLABS_API_KEY) {
    console.error("âŒ ELEVENLABS_API_KEY is missing in .env");
}

if (!process.env.ELEVENLABS_VOICE_ID) {
    console.error("âŒ ELEVENLABS_VOICE_ID is missing in .env");
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

console.log("ðŸ—„ï¸ Supabase client initialized");


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
        `ðŸ“š Local Knowledge Base available: ${knowledgeBase.length} characters`
    );

} catch (error) {

    console.log(
        "âš ï¸ Local knowledge base file not found. Supabase RAG will be used."
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
            "âŒ OpenAI embedding error:",
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
        `ðŸ§  Supabase RAG search: ${query}`
    );

    const queryEmbedding =
        await createEmbedding(query);

    console.log(
        `âœ… Query embedding created: ${queryEmbedding.length} dimensions`
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
            "âŒ Supabase vector search error:",
            error
        );

        throw error;
    }

    if (!data || data.length === 0) {

        console.log(
            "âš ï¸ No matching EA chunks found"
        );

        return "";
    }

    console.log(
        `ðŸ”Ž Found ${data.length} relevant chunks`
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
            "âš ï¸ Supabase returned no result. Using local fallback."
        );

        return searchLocalKnowledgeBase(
            query
        );

    } catch (error) {

        console.error(
            "âŒ Supabase knowledge search failed:",
            error.message
        );

        console.log(
            "â†©ï¸ Falling back to local knowledge base"
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
                "ðŸŽ™ï¸ Starting ElevenLabs streaming TTS..."
            );


const modelId = "eleven_v3_conversational";

console.log(
    "ðŸŽ™ï¸ ElevenLabs TTS model:",
    modelId
);

console.log(
    "ðŸ“ TTS text:",
    text
);


            // ==================================================
            // ELEVENLABS STREAMING ENDPOINT
            // ==================================================

            const response =
                await fetch(

`https://api.elevenlabs.io/v1/text-to-speech/${process.env.ELEVENLABS_VOICE_ID}/stream?output_format=pcm_16000`,                    {

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
    modelId
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
                    "âŒ ElevenLabs streaming error:",
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
                "audio/pcm"
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



            res.end();


        } catch (error) {

            console.error(
                "âŒ Manoj streaming TTS error:",
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
                    "âŒ Failed to close TTS response:",
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
                `ðŸ”Ž Knowledge search request: ${query}`
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
                "âŒ Knowledge search API error:",
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
                "ðŸŒ WEBRTC SESSION REQUEST"
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
                    "âŒ SDP offer missing or invalid"
                );

                return res
                    .status(400)
                    .json({

                        error:
                            "SDP offer is required"

                    });
            }


            console.log(
                "âœ… SDP offer received"
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

TELUGU VOICE STYLE:

When speaking Telugu, use natural everyday conversational Telugu,
especially Telangana-style conversational Telugu.

IMPORTANT FOR SPEECH:

- Write Telugu words only in Telugu Unicode script.
- NEVER write Telugu words using English/Roman letters.
- Do NOT transliterate Telugu into English letters.
- Use Telugu script because the response will be sent to a Telugu TTS voice.
- Avoid unnecessary symbols, emojis, decorative characters, and special punctuation.
- Do not use markdown formatting in spoken responses.
- Do not use bullet points, numbered lists, headings, brackets, or quotation marks unless absolutely necessary.
- Keep spoken sentences short and natural.
- Use simple conversational Telugu that is easy for a voice assistant to pronounce.
- Common English words can remain in English when naturally used in Telugu conversation.
- Avoid overly formal, literary, textbook, translated, or news-reader Telugu.
- Do not translate English sentences word-for-word into Telugu.
- Avoid long sentences with many clauses.
- Use natural pauses through normal punctuation such as commas and full stops.

Examples:

WRONG:
"Sare, meeku help chestanu."

CORRECT:
"సరే, మీకు హెల్ప్ చేస్తాను."

WRONG:
"Naaku ardham ayyindi."

CORRECT:
"నాకు అర్థం అయింది."

WRONG:
"Meeru cheppandi, nenu solution chepthanu."

CORRECT:
"మీరు చెప్పండి, నేను సొల్యూషన్ చెప్తాను."

VOICE OUTPUT RULE:

The response must be clean text suitable for direct text-to-speech.

Do not include emojis.
Do not include decorative symbols.
Do not include markdown.
Do not include meta commentary.
Do not include pronunciation instructions.
Do not include English/Roman transliteration of Telugu.

Keep Telugu responses concise, usually 1–3 short sentences.
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
            //   â†“
            // OpenAI
            //   â†“
            // Text
            //   â†“
            // ElevenLabs
            //   â†“
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
                "ðŸ“¤ Sending SDP to OpenAI..."
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
                    "âŒ OPENAI WEBRTC ERROR"
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
                "âœ… OpenAI SDP answer received"
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
                "âŒ WEBRTC SESSION ERROR"
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
            "ðŸ“ž Incoming Exotel WebSocket"
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
            `ðŸš€ Server running on port ${PORT}`
        );

        console.log(
            `ðŸ§  Supabase RAG: ENABLED`
        );

        console.log(
            `ðŸ”Ž Knowledge API: http://localhost:${PORT}/knowledge-search`
        );

        console.log(
            `ðŸŽ™ï¸ ElevenLabs TTS: ENABLED`
        );

        console.log(
            `ðŸ—£ï¸ Voice ID: ${process.env.ELEVENLABS_VOICE_ID}`
        );

    }
);
