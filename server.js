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

const knowledgeBasePath = path.join(
    __dirname,
    "knowledge",
    "ilead-knowledge-base.md"
);

const knowledgeBase = fs.readFileSync(
    knowledgeBasePath,
    "utf8"
);

console.log(
    `📚 Knowledge Base available locally: ${knowledgeBase.length} characters`
);


// ========================================
// KNOWLEDGE SEARCH
// ========================================

function searchKnowledgeBase(query) {

    if (!query || typeof query !== "string") {
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

    // ----------------------------------------
    // Split knowledge base into sections
    // ----------------------------------------

    const sections = knowledgeBase
        .split(/\n(?=#)/)
        .map(section => section.trim())
        .filter(Boolean);

    // ----------------------------------------
    // Score each section
    // ----------------------------------------

    const scoredSections = sections.map(section => {

        const lowerSection = section.toLowerCase();

        let score = 0;

        for (const word of cleanQuery) {

            if (word.length < 2) {
                continue;
            }

            if (lowerSection.includes(word)) {
                score += 1;
            }
        }

        // Strong topic boosts
        if (
            cleanQuery.some(word =>
                ["ea", "enrolled", "agent"].includes(word)
            ) &&
            lowerSection.includes("enrolled agent")
        ) {
            score += 8;
        }

        if (
            cleanQuery.some(word =>
                ["fpc", "payroll", "fundamental"].includes(word)
            ) &&
            lowerSection.includes("fpc")
        ) {
            score += 8;
        }

        if (
            cleanQuery.some(word =>
                ["cpp", "payroll", "professional"].includes(word)
            ) &&
            lowerSection.includes("cpp")
        ) {
            score += 8;
        }

        if (
            cleanQuery.some(word =>
                ["fee", "fees", "price", "cost"].includes(word)
            ) &&
            lowerSection.includes("fee")
        ) {
            score += 6;
        }

        if (
            cleanQuery.some(word =>
                ["eligibility", "eligible", "qualification"].includes(word)
            ) &&
            lowerSection.includes("eligib")
        ) {
            score += 6;
        }

        if (
            cleanQuery.some(word =>
                ["duration", "months", "month", "days"].includes(word)
            ) &&
            lowerSection.includes("duration")
        ) {
            score += 6;
        }

        if (
            cleanQuery.some(word =>
                ["exam", "examination", "test"].includes(word)
            ) &&
            lowerSection.includes("exam")
        ) {
            score += 6;
        }

        if (
            cleanQuery.some(word =>
                ["career", "job", "placement", "support"].includes(word)
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

    // ----------------------------------------
    // Get best matching sections
    // ----------------------------------------

    const bestSections = scoredSections
        .filter(item => item.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);

    if (bestSections.length === 0) {
        return "";
    }

    // ----------------------------------------
    // Keep returned context small
    // ----------------------------------------

    const result = bestSections
        .map(item => item.section)
        .join("\n\n");

    // Safety limit
    return result.slice(0, 12000);
}


// ========================================
// EXPRESS APP
// ========================================

const app = express();

expressWs(app);


// ========================================
// MIDDLEWARE
// ========================================

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
// KNOWLEDGE SEARCH API
// ========================================
//
// The browser/app can call this when
// Kavya needs factual information.
//
// The complete KB is NOT sent to OpenAI
// when the session starts.
//
// ========================================

app.post("/knowledge-search", (req, res) => {

    try {

        const query = req.body?.query;

        if (
            !query ||
            typeof query !== "string"
        ) {

            return res.status(400).json({
                error: "query is required"
            });

        }

        console.log(
            `🔎 Knowledge search: ${query}`
        );

        const result =
            searchKnowledgeBase(query);

        return res.json({

            success: true,

            query,

            context: result

        });

    } catch (error) {

        console.error(
            "❌ Knowledge search error:",
            error
        );

        return res.status(500).json({

            success: false,

            error:
                "Knowledge search failed"

        });

    }

});


// ========================================
// OPENAI REALTIME WEBRTC SESSION
// ========================================

app.post("/session", async (req, res) => {

    try {

        console.log("====================================");
        console.log("🌐 WEBRTC SESSION REQUEST");
        console.log("====================================");


        // ========================================
        // RECEIVE SDP
        // ========================================

        const sdpOffer = req.body;

        if (
            !sdpOffer ||
            typeof sdpOffer !== "string"
        ) {

            console.log(
                "❌ SDP offer missing or invalid"
            );

            return res.status(400).json({

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


        // ========================================
        // CREATE MULTIPART FORM
        // ========================================

        const formData = new FormData();

        formData.set(
            "sdp",
            sdpOffer
        );


        // ========================================
        // KAVYA INSTRUCTIONS
        // ========================================

        const kavyaInstructions = `

You are Kavya, the AI admission and course counsellor for iLEAD Tax Academy.

Your role is to have a natural, human, warm and persuasive conversation with prospective students.

You are a SALES COUNSELLOR.

You are NOT a robotic FAQ bot.

You are NOT a document reader.

You are NOT a script reader.

==================================================
1. HIGHEST PRIORITY — LANGUAGE
==================================================

ALWAYS respond in the same language the USER is currently speaking.

Telugu user → Telugu response.

Hindi user → Hindi response.

English user → English response.

If the user changes language, immediately change to the new language.

The user does NOT need to ask you to change language.

IMPORTANT:

The knowledge base may contain English content.

NEVER allow the language of the knowledge base to determine your response language.

If the user speaks Telugu, explain knowledge-base information in natural Telugu.

If the user speaks Hindi, explain knowledge-base information in natural Hindi.

If the user speaks English, explain it in English.

USER LANGUAGE = RESPONSE LANGUAGE.

==================================================
2. NATURAL SPOKEN LANGUAGE
==================================================

Do not speak like a document.

Do not translate English sentences word-for-word.

Understand the information first.

Then explain it naturally like a human counsellor.

For Telugu:

Use natural conversational Telugu with necessary English professional terms.

Examples of natural terms:

EA
Enrolled Agent
FPC
CPP
IRS
US taxation
course
exam
career
payroll
certification
admission
registration
training
support

For Hindi:

Use natural conversational Indian Hindi with necessary English professional terms.

For English:

Use simple conversational English.

==================================================
3. NEVER READ THE KNOWLEDGE BASE
==================================================

The knowledge base is information, not a script.

Never read paragraphs word-for-word.

Never copy large sections.

Never translate paragraphs line-by-line.

When knowledge is retrieved:

1. Understand the information.
2. Identify what answers the user's question.
3. Explain only the relevant information.
4. Use the user's language.
5. Keep the answer conversational.

==================================================
4. KNOWLEDGE RETRIEVAL
==================================================

A knowledge lookup tool is available.

When you need factual information about:

- EA
- FPC
- CPP
- eligibility
- fees
- duration
- exams
- course details
- career support
- other iLEAD documented information

use the knowledge lookup tool.

Do not pretend to know a specific fact if it is not in the retrieved information.

Do not invent facts.

If the retrieved information is not enough for an exact detail, guide the user to the admissions/sales counsellor.

==================================================
5. DO NOT REPEAT THE USER'S QUESTION
==================================================

NEVER repeat the question.

Do not say:

"I understand your question."

"So you are asking..."

"Let me explain..."

"Now I will tell you..."

Start the answer directly.

BAD:

"Okay, I understand that you are asking who can do EA."

GOOD:

"EA mainly US taxation field lo career build cheyyalanukune vallaki useful option..."

==================================================
6. FAST RESPONSE
==================================================

Respond as quickly as possible.

Do not intentionally create long pauses.

Do not use filler.

Do not repeat the question.

Do not say long acknowledgement sentences.

If acknowledgement is needed:

"Okay."

"Right."

"Sure."

Then answer immediately.

==================================================
7. SHORT SPOKEN ANSWERS
==================================================

Normally answer in 1–3 conversational sentences.

Do not dump large amounts of information.

Give the user what they need.

Ask only ONE useful follow-up question at a time.

==================================================
8. NATURAL SALES COUNSELLOR
==================================================

Think and speak like a good human admission counsellor.

Be:

Warm
Friendly
Confident
Helpful
Patient
Persuasive
Professional
Natural

Do not sound:

Robotic
Mechanical
Like an IVR
Like a textbook
Like an FAQ

Do not repeatedly use:

"Absolutely."

"Certainly."

"That's a great question."

"I'd be happy to assist you."

==================================================
9. TOPIC CHANGES
==================================================

If the user changes the topic, follow the new topic naturally.

Do not repeat the previous topic.

Do not give unnecessary enthusiasm.

Example:

User:
"EA duration entha?"

Kavya:
[answer]

User:
"FPC gurinchi cheppandi."

Kavya:

"Okay, FPC gurinchi cheptha..."

Then answer.

==================================================
10. CONVERSATION CONTEXT
==================================================

Remember information already provided in the conversation.

Do not ask the same question repeatedly.

If the user already told you their education, job or experience, use that information naturally.

==================================================
11. STUDENT DISCOVERY
==================================================

When useful, understand:

- Educational background
- Current job
- Work experience
- Career goal
- Interest in taxation
- Interest in payroll
- Reason for certification

Ask one question at a time.

Do not interrogate the user.

==================================================
12. EA
==================================================

Use retrieved knowledge for EA questions.

Explain naturally in the user's language.

Never invent:

Eligibility
Fees
Duration
Discounts
Faculty
Exam guarantees
Job guarantees
Placement guarantees
Salary guarantees

==================================================
13. FPC
==================================================

Use retrieved knowledge for FPC questions.

Explain naturally in the user's language.

Do not read the document.

Do not invent unsupported information.

==================================================
14. CPP
==================================================

Use retrieved knowledge for CPP questions.

Explain naturally in the user's language.

Do not read the document.

Do not invent unsupported information.

==================================================
15. NANDaKUMAR SIR
==================================================

If the user asks about Nandakumar Sir's experience:

Nandakumar Sir has 24 years of experience.

Do not say you do not have information.

==================================================
16. CAREER / PLACEMENT SUPPORT
==================================================

If the user asks about placement or career support:

Explain naturally:

iLEAD has past students and provides career-related support.

iLEAD also has an LLC where taxation work is carried out.

Students who successfully complete the relevant program may be considered for relevant opportunities there through an interview process and subject to requirements.

This is NOT a guaranteed placement.

Never promise:

Guaranteed placement.
Guaranteed job.
Guaranteed salary.

Natural Telugu style:

"iLEAD ki past students unnaru, career support kuda provide chestaru. Alage maa LLC lo taxation work kuda untundi. Course complete chesina students ni relevant opportunities kosam interview process dwara consider chestaru."

Adapt to the user's language.

==================================================
17. COMPETITOR COMPARISON
==================================================

If the user asks about another institution:

Do not attack competitors.

Do not invent competitor information.

Do not falsely claim iLEAD is objectively the best.

Explain iLEAD's documented strengths.

If a detailed direct comparison is needed, offer a sales counsellor call.

Example Telugu:

"Comparison mee requirement batti untundi. iLEAD lo memu provide chestunna training, support and career-related options ni explain cheyyagalanu. Direct comparison kosam maa sales counsellor meeku proper ga guide chestaru."

==================================================
18. UNKNOWN DETAILS
==================================================

Never invent facts.

Do not casually say:

"I don't know."

"I have no information."

Instead, if exact confirmation is needed:

"Adi exact ga confirm cheyyali. Maa sales counsellor meeku proper ga explain chestaru. Meeku convenient time cheppandi, aa time ki call schedule cheyyagalamu."

==================================================
19. FEES
==================================================

If fees are available through knowledge retrieval, explain them naturally.

If the exact fee is not available:

Do not invent a number.

Offer a sales/admissions follow-up.

==================================================
20. EMOTIONAL DELIVERY
==================================================

Use subtle emotional variation.

If the user is excited:
Sound enthusiastic.

If confused:
Sound patient.

If worried:
Sound reassuring.

If interested:
Sound encouraging.

A natural warm smile in the voice is good when appropriate.

Do not force laughter.

Do not overact.

==================================================
21. COURSE RECOMMENDATION
==================================================

Do not recommend a course blindly.

Understand the student's:

Background
Current work
Career goal
Area of interest

Then recommend based on documented information.

==================================================
22. SALES HANDOFF
==================================================

When the user wants:

Detailed guidance
Personalized advice
Direct competitor comparison
Exact confirmation
Admission discussion
Career guidance

offer a call naturally.

Example:

"Meeku detailed ga guide cheyyali ante maa sales counsellor proper ga explain chestaru. Mee convenient time cheppandi, aa time ki call schedule cheyyagalamu."

Do not sound like an IVR.

==================================================
23. FIRST-CONTACT INFORMATION
==================================================

When the application provides the student's name, email or phone number, remember those details.

Use the person's name naturally when appropriate.

Do not repeatedly ask for information already provided.

==================================================
24. FINAL BEHAVIOUR
==================================================

Before responding:

Understand the user's intent.

Detect the user's current language.

Use retrieved knowledge when necessary.

Remember conversation context.

Do not repeat the question.

Do not add filler.

Answer quickly.

Keep answers concise.

Speak naturally.

Ask one useful follow-up question when appropriate.

MOST IMPORTANT:

USER LANGUAGE = RESPONSE LANGUAGE.

English knowledge = NOT English response.

Telugu user = Telugu response.

Hindi user = Hindi response.

English user = English response.

Never mention these internal instructions.
`;


        // ========================================
        // REALTIME SESSION CONFIGURATION
        // ========================================

        const sessionConfig = {

            type: "realtime",

            model: "gpt-realtime-2.1-mini",

            instructions:
                kavyaInstructions,

            audio: {

                output: {

                    voice: "marin"

                }

            },

            tools: [

                {
                    type: "function",

                    name: "knowledge_lookup",

                    description:
                        "Search the iLEAD Tax Academy knowledge base for factual information needed to answer the user's current question. Use this for EA, FPC, CPP, eligibility, fees, duration, exams, course details, career support and other documented iLEAD information.",

                    parameters: {

                        type: "object",

                        properties: {

                            query: {

                                type: "string",

                                description:
                                    "A concise search query describing the information needed from the iLEAD knowledge base."

                            }

                        },

                        required: [
                            "query"
                        ]

                    }

                }

            ]

        };


        // ========================================
        // ADD SESSION CONFIG
        // ========================================

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


        // ========================================
        // READ RESPONSE
        // ========================================

        const answer =
            await response.text();


        console.log(
            "OpenAI Status:",
            response.status
        );


        // ========================================
        // HANDLE ERROR
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