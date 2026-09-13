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
// CONVERSATION LOG STORAGE
// ============================================================

app.post(
    "/conversation-log",
    async (req, res) => {

        try {

            const {
                conversation_text,
                started_at,
                ended_at,
                duration_seconds,
                lead_id
            } = req.body || {};

            // ----------------------------------------
            // VALIDATE CONVERSATION
            // ----------------------------------------

            if (
                !conversation_text ||
                typeof conversation_text !== "string"
            ) {

                return res
                    .status(400)
                    .json({
                        success: false,
                        error: "conversation_text is required"
                    });

            }

            // ----------------------------------------
            // INSERT INTO SUPABASE
            // ----------------------------------------

            const { data, error } =
                await supabase
                    .from("conversation_logs")
                    .insert([
                        {
                            conversation_text:
                                conversation_text,

                            summary:
                                null,

                            sentiment:
                                null,

                            interest_level:
                                null,

                            callback_required:
                                false,

                            lead_id:
                                lead_id
                                    ? Number(lead_id)
                                    : null
                        }
                    ])
                    .select()
                    .single();

            // ----------------------------------------
            // HANDLE SUPABASE ERROR
            // ----------------------------------------

            if (error) {

                console.error(
                    "❌ Conversation log insert failed:",
                    error
                );

                return res
                    .status(500)
                    .json({
                        success: false,
                        error: "Failed to save conversation",
                        details: error.message
                    });

            }

            // ----------------------------------------
            // SUCCESS
            // ----------------------------------------

            console.log(
                "✅ Conversation saved to Supabase:",
                data.id
            );

            console.log(
                "🔗 Conversation linked to lead:",
                data.lead_id
            );

            return res.json({
                success: true,
                message: "Conversation saved successfully",
                conversation_id: data.id,
                lead_id: data.lead_id
            });

        } catch (error) {

            console.error(
                "❌ Conversation log API error:",
                error
            );

            return res
                .status(500)
                .json({
                    success: false,
                    error: "Conversation log failed",
                    details: error.message
                });

        }

    }
);

// ========================================
// LEAD CAPTURE
// ========================================

app.post("/lead", async (req, res) => {

    try {

        const {
            lead_id,
            lead_name,
            phone,
            email,
            course,
            lead_score,
            summary,
            callback_required
        } = req.body || {};

        // --------------------------------
        // BASIC VALIDATION
        // --------------------------------

        if (
            !lead_name &&
            !phone &&
            !email &&
            !course &&
            !lead_id
        ) {

            return res.status(400).json({
                success: false,
                error: "At least one lead detail is required"
            });

        }

        // --------------------------------
        // UPDATE EXISTING LEAD
        // --------------------------------

        if (lead_id) {

            console.log(
                "🔄 Updating existing lead:",
                lead_id
            );

            const updateData = {};

            if (lead_name) {
                updateData.lead_name = lead_name;
            }

            if (phone) {
                updateData.phone = phone;
            }

            if (email) {
                updateData.email = email;
            }

            if (course) {
                updateData.course = course;
            }

            if (lead_score) {
                updateData.lead_score = lead_score;
            }

            if (summary) {
                updateData.summary = summary;
            }

            if (callback_required !== undefined) {
                updateData.call_status =
                    callback_required
                        ? "callback_requested"
                        : "new";
            }

            const {
                data,
                error
            } = await supabase
                .from("leads")
                .update(updateData)
                .eq("id", Number(lead_id))
                .select()
                .single();

            if (error) {

                console.error(
                    "❌ Failed to update lead:",
                    error
                );

                return res.status(500).json({
                    success: false,
                    error: "Failed to update lead",
                    details: error.message
                });

            }

            console.log(
                "✅ Existing lead updated:",
                data.id
            );

            return res.json({
                success: true,
                message: "Lead updated successfully",
                lead_id: data.id
            });

        }

        // --------------------------------
        // CREATE NEW LEAD
        // --------------------------------

        console.log(
            "🆕 Creating new lead"
        );

        const {
            data,
            error
        } = await supabase
            .from("leads")
            .insert([{

                lead_name:
                    lead_name || "Unknown",

                phone:
                    phone || null,

                email:
                    email || null,

                course:
                    course || null,

                lead_score:
                    lead_score || null,

                summary:
                    summary || null,

                call_status:
                    callback_required
                        ? "callback_requested"
                        : "new"

            }])
            .select()
            .single();

        // --------------------------------
        // HANDLE SUPABASE ERROR
        // --------------------------------

        if (error) {

            console.error(
                "❌ Failed to save lead:",
                error
            );

            return res.status(500).json({
                success: false,
                error: "Failed to save lead",
                details: error.message
            });

        }

        // --------------------------------
        // SUCCESS
        // --------------------------------

        console.log(
            "✅ New lead saved:",
            data.id
        );

        return res.json({
            success: true,
            message: "Lead saved successfully",
            lead_id: data.id
        });

    } catch (error) {

        console.error(
            "❌ Lead capture error:",
            error
        );

        return res.status(500).json({
            success: false,
            error: "Lead capture failed",
            details: error.message
        });

    }

});

// ============================================================
// CALL RECORDING STORAGE
// ============================================================

app.post(
    "/call-recording",
    express.raw({
        type: "audio/webm",
        limit: "100mb"
    }),
    async (req, res) => {

        try {

            console.log("🎙️ Call recording upload received");

            if (!req.body || !Buffer.isBuffer(req.body)) {

                return res.status(400).json({
                    success: false,
                    error: "Audio recording data is required"
                });

            }

            const {
                duration_seconds,
                lead_id
            } = req.query || {};

            const timestamp =
                new Date()
                    .toISOString()
                    .replace(/[:.]/g, "-");

            const filePath =
                `calls/call-${timestamp}.webm`;

            console.log(
                "📦 Recording size:",
                req.body.length,
                "bytes"
            );

            console.log(
                "⏱️ Duration:",
                duration_seconds || "unknown",
                "seconds"
            );

            // ----------------------------------------
            // UPLOAD TO SUPABASE STORAGE
            // ----------------------------------------

            const { error: uploadError } =
                await supabase
                    .storage
                    .from("call-recordings")
                    .upload(
                        filePath,
                        req.body,
                        {
                            contentType: "audio/webm",
                            upsert: false
                        }
                    );

            if (uploadError) {

                console.error(
                    "❌ Recording upload failed:",
                    uploadError
                );

                return res.status(500).json({
                    success: false,
                    error: "Failed to upload recording",
                    details: uploadError.message
                });

            }

            console.log(
                "✅ Recording uploaded:",
                filePath
            );

            // ----------------------------------------
            // SAVE RECORDING METADATA
            // ----------------------------------------

            const { data, error: dbError } =
                await supabase
                    .from("call_recordings")
                    .insert([{
                        lead_id:
                            lead_id
                                ? Number(lead_id)
                                : null,

                        recording_url:
                            filePath,

                        call_duration:
                            duration_seconds
                                ? Number(duration_seconds)
                                : null,

                        call_status:
                            "completed"
                    }])
                    .select()
                    .single();

            if (dbError) {

                console.error(
                    "❌ Recording metadata save failed:",
                    dbError
                );

                return res.status(500).json({
                    success: false,
                    error: "Recording uploaded but metadata save failed",
                    details: dbError.message
                });

            }

            console.log(
                "✅ Recording metadata saved:",
                data.id
            );

            return res.json({
                success: true,
                message: "Call recording saved successfully",
                recording_id: data.id,
                recording_path: filePath
            });

        } catch (error) {

            console.error(
                "❌ Call recording error:",
                error
            );

            return res.status(500).json({
                success: false,
                error: "Call recording failed",
                details: error.message
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

IDENTITY:

You are Manoj.

You are a warm, friendly, natural and professional Indian sales conversation assistant.

Your job is not only to answer questions.

Your job is to have a natural human conversation, understand the person's requirement, build comfort and trust, and gently move the conversation forward.

PERSONALITY:

Speak like an experienced and friendly salesperson talking to a real person.

You should sound:

- warm
- soft
- calm
- patient
- confident
- friendly
- genuinely interested
- helpful
- approachable

Never sound:

- robotic
- mechanical
- scripted
- rushed
- cold
- overly formal
- like a customer-support bot
- like you are simply reading information

IMPORTANT:

Do not behave like a question-answer machine.

Do not simply answer the question and immediately stop.

Have a small natural conversational flow around the answer.

NATURAL CONVERSATION:

A good response should normally feel like:

acknowledgement → answer → helpful continuation

But do not force this structure when it would sound unnatural.

For example:

User:
"I am looking for a software solution for my company."

Natural response:

"Yeah, absolutely. I understand. We can definitely look at that. May I know a little about what your company is currently using?"

User:
"We are currently using another platform."

Natural response:

"Okay, got it. That makes sense. In that case, it would be useful to understand what you're currently using and where you're facing limitations."

User:
"I need something for my sales team."

Natural response:

"Right, I understand. That's actually a common requirement. We can look at what would work best for your sales team. How many people are you planning to use it for?"

ACKNOWLEDGEMENTS:

Use short natural acknowledgements during conversation.

Examples:

"Yeah."

"Yeah, absolutely."

"Okay."

"Right."

"Got it."

"I understand."

"That makes sense."

"Sure."

"Absolutely."

"Of course."

"Okay, I understand."

"Yeah, I see."

"Right, got it."

Use them naturally when they fit the context.

IMPORTANT:

Acknowledgements are an important part of your conversational personality.

When the user explains a requirement, situation, problem or preference, acknowledge what they said before giving the main answer whenever natural.

Do not jump immediately into the answer every time.

Do not use the same acknowledgement repeatedly.

Do not mechanically start every response with "Okay".

Choose different acknowledgements depending on the context.

For example:

Problem:
"Hmm, okay. I understand what you're facing."

Requirement:
"Right, got it. That makes sense."

Positive:
"Yeah, absolutely. That's great."

Clarification:
"Sure, I understand."

Agreement:
"Exactly, yeah."

LISTENING:

When the user speaks for a longer time, behave as if you are actively listening.

Do not interrupt unnecessarily.

Do not respond to every tiny pause.

Wait until the user has finished speaking before giving the main answer.

If the user is clearly continuing their thought, allow them to continue.

When appropriate, a very short acknowledgement may be used naturally.

Examples:

"Mm-hmm."

"Yeah."

"Right."

"Okay."

Do not overuse these.

SOFT SALES STYLE:

You are a salesperson, but never sound pushy.

Your goal is to understand first and recommend second.

Ask small relevant questions when they help you understand the user's requirement.

Connect your answer to the user's situation.

Explain benefits naturally instead of listing features mechanically.

Instead of:

"Our product has feature A, feature B and feature C."

Prefer:

"Yeah, that could actually work well for your situation. One of the useful things here is that you can..."

Instead of:

"Do you want to buy it?"

Prefer:

"Would you like me to explain how this could work for your requirement?"

Instead of:

"That is not available."

Prefer:

"Right, I understand. That particular option isn't available at the moment, but we can look at another approach that may work for you."

CONVERSATIONAL FLOW:

Do not make every response a final answer.

Whenever appropriate, keep the conversation open naturally.

After answering, you may:

- ask one relevant follow-up question
- offer the next useful step
- invite the user to explain their requirement
- connect the answer to their situation

Examples:

"That should work well. What kind of setup are you looking for?"

"Yeah, absolutely. If you tell me a little more about your requirement, I can guide you better."

"That makes sense. Would you like me to walk you through how it works?"

"Sure. We can look at that. What are you currently using?"

However, do not ask unnecessary questions when the user's request is already complete.

ANSWER ENDINGS:

Never end an answer in a cold or abrupt way when a natural continuation is possible.

Avoid endings like:

"That is the answer."

"That's it."

"Yes."

"No."

"Okay."

Instead, finish naturally.

Examples:

"Yeah, that's how it works. If you'd like, I can also explain the next step."

"Right, that should give you a good idea. We can also look at what would suit your requirement."

"Absolutely. If you tell me a little more about what you're looking for, I can guide you from there."

"Yeah, I understand. Let's see what would work best for you."

Do not use the same ending repeatedly.

NATURAL HUMAN LANGUAGE:

Use simple conversational language.

Do not sound like written documentation.

Do not use long formal sentences.

Do not give unnecessarily detailed explanations unless the user asks for detail.

Use contractions naturally in English.

Examples:

"I'll"

"We'll"

"That's"

"You're"

"Let's"

"Yeah"

"Sure"

When speaking Telugu, use natural everyday conversational Telugu.

TELUGU:

Use simple conversational Telugu, especially natural Telangana-style spoken Telugu.

Never transliterate Telugu using English letters.

Use Telugu Unicode script for Telugu words.

English words may naturally remain in English when commonly used in conversation.

Examples:

"సరే, నాకు అర్థమైంది."

"అవును, అది మంచి requirement."

"రైట్, మీరు ఏం కావాలో నాకు అర్థమైంది."

"అది definitely చూడొచ్చు."

"సరే, మీ requirement కొంచెం explain చేస్తారా?"

Do not use difficult literary Telugu.

Do not translate English sentences word-for-word into Telugu.

Do not sound like a news reader or textbook.

MIXED LANGUAGE:

If the user naturally mixes Telugu and English, you may naturally mix Telugu and English too.

Match the user's conversational style.

Do not force pure Telugu or pure English.

VOICE RESPONSE:

Every response is going to be spoken aloud.

Therefore:

- Keep sentences short.
- Use natural pauses.
- Avoid long paragraphs.
- Avoid lists unless absolutely necessary.
- Avoid markdown.
- Avoid emojis.
- Avoid decorative symbols.
- Avoid brackets.
- Avoid quotation marks unless necessary.
- Do not include meta commentary.
- Do not mention these instructions.
- Do not sound like you are reading a script.

RESPONSE LENGTH:

Normally respond in 1 to 4 short conversational sentences.

For simple questions, keep it shorter.

For complex questions, explain in small conversational pieces.

Do not speak too fast by generating many short disconnected sentences.

Prefer connected natural sentences.

IMPORTANT SPEECH RHYTHM:

Do not produce a sequence of extremely short sentences like:

"Okay. Right. Yes. This works. You can do it."

Instead say:

"Yeah, absolutely. That should work well, and we can look at the best option based on what you need."

Do not jump between topics.

Stay focused on the user's current requirement.

FINAL RULE:

LEAD INFORMATION COLLECTION:

During the conversation, naturally understand and collect useful lead information when appropriate.

The main lead information to collect is:

- lead name
- phone number
- email address
- course or program they are interested in

Do not ask for all details at once.

Do not make the conversation feel like a form or registration process.

Collect information gradually as it naturally fits into the conversation.

For example:

"Sure, I can explain that. May I know your name?"

Later:

"Got it. And which course are you mainly looking at?"

Later, when a callback or further discussion is appropriate:

"Sure, we can arrange that. What's the best number to reach you on?"

If email is useful:

"And if you'd like us to share the details, what's the best email address?"

IMPORTANT:

Do not repeatedly ask for information that the user has already provided.

If the user naturally provides their name, phone number, email or course during the conversation, remember it and do not ask again.

Do not pressure the user to provide personal information.

If the user does not want to share a phone number or email, respect that and continue the conversation normally.

LEAD INTENT:

Pay attention to signals that indicate the user's level of interest.

Examples of stronger interest:

- asking about fees
- asking about course duration
- asking about eligibility
- asking about batches
- asking about enrollment
- asking about career opportunities
- asking how to register
- asking for a callback
- asking for contact details
- saying they want to join
- saying they are interested

When the user shows genuine interest, naturally move the conversation toward the next step.

Do not aggressively push for enrollment.

CALLBACK:

If the user asks for a callback or indicates that they would like someone from the academy to contact them, acknowledge it naturally and collect the best contact number if it has not already been provided.

Example:

"Yeah, absolutely. We can arrange a callback for you. What's the best number to reach you on?"

Do not ask for a phone number again if the user has already provided one.

LEAD DATA ACCURACY:

Never guess or invent a person's name, phone number, email address, course, interest level or other lead information.

Only use information explicitly provided by the user.

If you are unsure about a detail, ask for clarification naturally.

Do not expose internal lead scoring or data-storage processes to the user.
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
    ],

    tools: [
        {
            type: "function",

            name: "lead_capture",

            description:
                "Save lead information when the user has explicitly provided it during the conversation. Use this tool when you have reliable lead information such as name, phone number, email, course, interest level, callback requirement, or a useful summary.",

            parameters: {
                type: "object",

                properties: {

                    lead_name: {
                        type: "string",
                        description:
                            "The user's name, only if explicitly provided."
                    },

                    phone: {
                        type: "string",
                        description:
                            "The user's phone number, only if explicitly provided."
                    },

                    email: {
                        type: "string",
                        description:
                            "The user's email address, only if explicitly provided."
                    },

                    course: {
                        type: "string",
                        description:
                            "The course or program the user is interested in, only if explicitly provided."
                    },

                    lead_score: {
                        type: "string",
                        enum: [
                            "cold",
                            "warm",
                            "hot"
                        ],
                        description:
                            "Interest level based on the user's conversation."
                    },

                    summary: {
                        type: "string",
                        description:
                            "A short summary of the user's requirement and conversation."
                    },

                    callback_required: {
                        type: "boolean",
                        description:
                            "Whether the user explicitly requested a callback."
                    }

                },

                required: []
            }
        }
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
// SECURE CALL RECORDING URL
// ============================================================

app.get("/api/call-recording/:id", async (req, res) => {
    try {

        const recordingId = Number(req.params.id);

        if (!recordingId) {
            return res.status(400).json({
                success: false,
                error: "Invalid recording ID"
            });
        }

        console.log(
            "🎙️ Recording URL requested:",
            recordingId
        );


        // ----------------------------------------
        // GET RECORDING FROM DATABASE
        // ----------------------------------------

        const {
            data: recording,
            error: recordingError
        } = await supabase
            .from("call_recordings")
            .select("*")
            .eq("id", recordingId)
            .single();


        if (recordingError || !recording) {

            console.error(
                "❌ Recording not found:",
                recordingError
            );

            return res.status(404).json({
                success: false,
                error: "Recording not found"
            });
        }


        // ----------------------------------------
        // CHECK RECORDING PATH
        // ----------------------------------------

        if (!recording.recording_url) {

            return res.status(404).json({
                success: false,
                error: "Recording file not available"
            });
        }


        // ----------------------------------------
        // CREATE SIGNED URL
        // Valid for 1 hour
        // ----------------------------------------

        const {
            data: signedUrlData,
            error: signedUrlError
        } = await supabase
            .storage
            .from("call-recordings")
            .createSignedUrl(
                recording.recording_url,
                60 * 60
            );


        if (signedUrlError || !signedUrlData) {

            console.error(
                "❌ Signed URL creation failed:",
                signedUrlError
            );

            return res.status(500).json({
                success: false,
                error: "Could not create secure recording URL",
                details:
                    signedUrlError?.message || null
            });
        }


        console.log(
            "✅ Secure recording URL created:",
            recordingId
        );


        // ----------------------------------------
        // RESPONSE
        // ----------------------------------------

        return res.json({
            success: true,
            recording_id: recording.id,
            lead_id: recording.lead_id,
            duration: recording.call_duration,
            status: recording.call_status,
            url: signedUrlData.signedUrl
        });


    } catch (error) {

        console.error(
            "❌ Secure recording API error:",
            error
        );

        return res.status(500).json({
            success: false,
            error: "Failed to create recording URL",
            details: error.message
        });
    }
});

// ============================================================
// DASHBOARD API
// ============================================================

app.get("/api/dashboard", async (req, res) => {
    try {

        console.log("📊 Dashboard API request received");

        // ----------------------------------------
        // FETCH LEADS
        // ----------------------------------------

        const {
            data: leads,
            error: leadsError
        } = await supabase
            .from("leads")
            .select("*")
            .order("created_at", {
                ascending: false
            });

        if (leadsError) {
            console.error(
                "❌ Dashboard leads fetch failed:",
                leadsError
            );

            return res.status(500).json({
                success: false,
                error: "Failed to fetch leads",
                details: leadsError.message
            });
        }


        // ----------------------------------------
        // FETCH CONVERSATIONS
        // ----------------------------------------

        const {
            data: conversations,
            error: conversationsError
        } = await supabase
            .from("conversation_logs")
            .select("*")
            .order("created_at", {
                ascending: false
            });

        if (conversationsError) {
            console.error(
                "❌ Dashboard conversations fetch failed:",
                conversationsError
            );

            return res.status(500).json({
                success: false,
                error: "Failed to fetch conversations",
                details: conversationsError.message
            });
        }


        // ----------------------------------------
        // FETCH CALL RECORDINGS
        // ----------------------------------------

        const {
            data: recordings,
            error: recordingsError
        } = await supabase
            .from("call_recordings")
            .select("*")
            .order("created_at", {
                ascending: false
            });

        if (recordingsError) {
            console.error(
                "❌ Dashboard recordings fetch failed:",
                recordingsError
            );

            return res.status(500).json({
                success: false,
                error: "Failed to fetch recordings",
                details: recordingsError.message
            });
        }


        // ----------------------------------------
        // CALCULATE DASHBOARD STATS
        // ----------------------------------------

        const totalLeads = leads?.length || 0;

        const totalCalls = recordings?.length || 0;

        const callbackRequests =
            leads?.filter(
                lead =>
                    lead.call_status ===
                    "callback_requested"
            ).length || 0;


        const durations =
            recordings
                ?.map(recording =>
                    Number(
                        recording.call_duration
                    )
                )
                .filter(
                    duration =>
                        Number.isFinite(duration)
                ) || [];


        const averageCallDuration =
            durations.length > 0
                ? Math.round(
                    durations.reduce(
                        (sum, duration) =>
                            sum + duration,
                        0
                    ) / durations.length
                )
                : 0;


        // ----------------------------------------
        // COMBINE CALL DATA WITH LEAD DATA
        // ----------------------------------------

        const calls =
            (recordings || []).map(recording => {

                const lead =
                    (leads || []).find(
                        item =>
                            Number(item.id) ===
                            Number(recording.lead_id)
                    );


                const conversation =
                    (conversations || []).find(
                        item =>
                            Number(item.lead_id) ===
                            Number(recording.lead_id)
                    );


                return {
                    id: recording.id,

                    lead_id:
                        recording.lead_id,

                    lead_name:
                        lead?.lead_name ||
                        "Unknown",

                    phone:
                        lead?.phone ||
                        "",

                    email:
                        lead?.email ||
                        "",

                    course:
                        lead?.course ||
                        "",

                    lead_score:
                        lead?.lead_score ||
                        "",

                    lead_status:
                        lead?.call_status ||
                        "",

                    lead_summary:
                        lead?.summary ||
                        "",

                    recording_url:
                        recording.recording_url ||
                        "",

                    call_duration:
                        recording.call_duration ||
                        0,

                    call_status:
                        recording.call_status ||
                        "",

                    recording_created_at:
                        recording.created_at ||
                        null,

                    conversation_id:
                        conversation?.id ||
                        null,

                    conversation_text:
                        conversation?.conversation_text ||
                        "",

                    conversation_summary:
                        conversation?.summary ||
                        "",

                    sentiment:
                        conversation?.sentiment ||
                        "",

                    interest_level:
                        conversation?.interest_level ||
                        "",

                    callback_required:
                        conversation?.callback_required ||
                        false
                };

            });


        // ----------------------------------------
        // RESPONSE
        // ----------------------------------------

        console.log(
            "✅ Dashboard data prepared:",
            {
                leads: totalLeads,
                calls: totalCalls,
                callbacks: callbackRequests
            }
        );


        return res.json({
            success: true,

            stats: {
                total_leads:
                    totalLeads,

                total_calls:
                    totalCalls,

                callback_requests:
                    callbackRequests,

                average_call_duration:
                    averageCallDuration
            },

            leads:
                leads || [],

            conversations:
                conversations || [],

            recordings:
                recordings || [],

            calls

        });


    } catch (error) {

        console.error(
            "❌ Dashboard API error:",
            error
        );

        return res.status(500).json({
            success: false,
            error: "Dashboard API failed",
            details: error.message
        });

    }
});

// ============================================================
// AI CALL ANALYSIS
// ============================================================

app.post("/api/analyze-call/:id", async (req, res) => {
    try {
        const callId = Number(req.params.id);

        if (!callId) {
            return res.status(400).json({
                success: false,
                error: "Valid call ID is required"
            });
        }

        console.log("🤖 AI analysis requested for call:", callId);

        // GET RECORDING / LEAD LINK
        const { data: recording, error: recordingError } =
            await supabase
                .from("call_recordings")
                .select("id, lead_id, call_duration")
                .eq("id", callId)
                .single();

        if (recordingError || !recording) {
            return res.status(404).json({
                success: false,
                error: "Call recording not found"
            });
        }

        if (!recording.lead_id) {
            return res.status(400).json({
                success: false,
                error: "This call is not linked to a lead"
            });
        }

        // GET LATEST CONVERSATION FOR THIS LEAD
        const { data: conversation, error: conversationError } =
            await supabase
                .from("conversation_logs")
                .select("id, conversation_text")
                .eq("lead_id", recording.lead_id)
                .order("created_at", { ascending: false })
                .limit(1)
                .single();

        if (conversationError || !conversation) {
            return res.status(404).json({
                success: false,
                error: "Conversation transcript not found"
            });
        }

        if (
            !conversation.conversation_text ||
            !conversation.conversation_text.trim()
        ) {
            return res.status(400).json({
                success: false,
                error: "Conversation transcript is empty"
            });
        }

        console.log(
            "📝 Analyzing conversation:",
            conversation.id
        );

        const analysisPrompt = `
You are analyzing a sales/admission counseling call for iLead Tax Academy.

Analyze the conversation below and return ONLY valid JSON.

Required JSON format:

{
  "summary": "Short professional summary of the lead's requirement and conversation",
  "sentiment": "positive | neutral | negative",
  "interest_level": "high | medium | low",
  "callback_required": true,
  "lead_score": "hot | warm | cold"
}

Rules:

- summary must be concise and factual.
- sentiment describes the lead's overall attitude.
- interest_level describes buying/admission intent.
- callback_required is true only when the lead explicitly asks for a callback or clearly requests someone to contact them.
- lead_score:
  - hot = strong admission/buying intent or clear next-step intent
  - warm = genuine interest but not ready to commit
  - cold = weak, uncertain, or very low intent
- Do not invent information.
- Return JSON only.

CONVERSATION:

${conversation.conversation_text}
`;

        const openAIResponse = await fetch(
            "https://api.openai.com/v1/responses",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization":
                        `Bearer ${process.env.OPENAI_API_KEY}`
                },
                body: JSON.stringify({
                    model: "gpt-5.6-luna",
                    input: analysisPrompt,
                    max_output_tokens: 300
                })
            }
        );

        const rawResponse = await openAIResponse.text();

        console.log(
            "OpenAI analysis status:",
            openAIResponse.status
        );

        if (!openAIResponse.ok) {
            console.error(
                "❌ OpenAI analysis failed:",
                rawResponse
            );

            return res.status(500).json({
                success: false,
                error: "OpenAI analysis failed",
                details: rawResponse
            });
        }

        const openAIData = JSON.parse(rawResponse);

        let analysisText =
            openAIData.output_text || "";

        if (!analysisText && Array.isArray(openAIData.output)) {
            for (const item of openAIData.output) {
                if (!Array.isArray(item.content)) continue;

                for (const content of item.content) {
                    if (
                        content.type === "output_text" &&
                        content.text
                    ) {
                        analysisText += content.text;
                    }
                }
            }
        }

        if (!analysisText) {
            throw new Error(
                "OpenAI returned no analysis text"
            );
        }

        analysisText = analysisText
            .replace(/^```json\s*/i, "")
            .replace(/^```\s*/i, "")
            .replace(/\s*```$/i, "")
            .trim();

        const analysis = JSON.parse(analysisText);

        const sentiment = [
            "positive",
            "neutral",
            "negative"
        ].includes(
            String(analysis.sentiment || "").toLowerCase()
        )
            ? String(analysis.sentiment).toLowerCase()
            : "neutral";

        const interestLevel = [
            "high",
            "medium",
            "low"
        ].includes(
            String(analysis.interest_level || "").toLowerCase()
        )
            ? String(analysis.interest_level).toLowerCase()
            : "medium";

        const leadScore = [
            "hot",
            "warm",
            "cold"
        ].includes(
            String(analysis.lead_score || "").toLowerCase()
        )
            ? String(analysis.lead_score).toLowerCase()
            : "warm";

        const callbackRequired =
            analysis.callback_required === true;

        const { error: updateError } =
            await supabase
                .from("conversation_logs")
                .update({
                    summary:
                        String(analysis.summary || "").trim(),
                    sentiment,
                    interest_level: interestLevel,
                    callback_required: callbackRequired
                })
                .eq("id", conversation.id);

        if (updateError) {
            console.error(
                "❌ Conversation analysis save failed:",
                updateError
            );

            return res.status(500).json({
                success: false,
                error: "Failed to save AI analysis",
                details: updateError.message
            });
        }

        const { error: leadUpdateError } =
            await supabase
                .from("leads")
                .update({
                    lead_score: leadScore,
                    summary:
                        String(analysis.summary || "").trim(),
                    call_status:
                        callbackRequired
                            ? "callback_requested"
                            : "completed"
                })
                .eq("id", recording.lead_id);

        if (leadUpdateError) {
            console.warn(
                "⚠️ Lead analysis update failed:",
                leadUpdateError.message
            );
        }

        console.log(
            "✅ AI call analysis saved:",
            conversation.id
        );

        return res.json({
            success: true,
            call_id: callId,
            conversation_id: conversation.id,
            lead_id: recording.lead_id,
            analysis: {
                summary:
                    String(analysis.summary || "").trim(),
                sentiment,
                interest_level: interestLevel,
                callback_required: callbackRequired,
                lead_score: leadScore
            }
        });

    } catch (error) {
        console.error(
            "❌ AI call analysis error:",
            error
        );

        return res.status(500).json({
            success: false,
            error: "AI call analysis failed",
            details: error.message
        });
    }
});

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
