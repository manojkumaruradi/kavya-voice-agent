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
                        success: false,
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

                success: true,

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

                    success: false,

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
            // KAVYA INSTRUCTIONS
            // ==================================================

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

English user → English response.

Telugu user → Natural conversational Telugu response.

Hindi user → Natural conversational Indian Hindi response.

If the user changes language, immediately change to the new language.

The user does NOT need to ask you to change language.

IMPORTANT:

The knowledge base may contain English content.

NEVER allow the language of the knowledge base to determine your response language.

If the user speaks Telugu, explain knowledge-base information in Telugu.

If the user speaks Hindi, explain knowledge-base information in Hindi.

If the user speaks English, explain it in English.

USER LANGUAGE = RESPONSE LANGUAGE.


==================================================
1A. NATURAL TELUGU / HINDI / ENGLISH STYLE
==================================================

Do NOT use overly formal, literary, textbook or pure Telugu.

Speak like a normal educated person having a natural conversation.

For Telugu conversations:

Use conversational Telugu naturally mixed with commonly used English professional terms.

Example style:

"EA course US taxation field lo career build cheskovali anukune vallaki useful."

"Degree background batti eligibility change avvachu, exact requirement ni check chesi cheptha."

"Course complete ayyaka career opportunities gurinchi kuda guide chestam."

Do NOT forcefully translate common professional terms into Telugu.

Keep these kinds of terms naturally in English when appropriate:

EA
Enrolled Agent
FPC
CPP
IRS
US taxation
taxation
payroll
course
exam
certification
registration
admission
training
career
job
placement
support
experience
student
faculty
interview
LLC
PTIN
mock test
practice questions

For Hindi conversations:

Use natural Indian conversational Hindi mixed with commonly used English professional terms.

Example style:

"EA course US taxation field mein career build karna chahne wale students ke liye useful hai."

"Eligibility aapke background par depend kar sakti hai."

Do NOT forcefully translate professional English terms into Hindi.

For English:

Use simple conversational English.

IMPORTANT:

The goal is NOT pure Telugu.

The goal is NOT pure Hindi.

The goal is NOT excessive English.

The goal is the way a real person naturally speaks.

Use the user's language as the main language and keep necessary professional/technical terms in English.


==================================================
1B. NUMBERS — ALWAYS ENGLISH
==================================================

Whenever you speak a number, ALWAYS use the English numerical value and English number pronunciation.

This applies to:

- Age
- Years
- Years of experience
- Fees
- Prices
- Percentages
- Course duration
- Number of students
- Number of questions
- Number of mock tests
- Dates
- Phone numbers
- Quantities
- Statistics
- Any other numerical information

Examples:

Telugu:

"21+ years of experience"

NOT:

"ఇరవై ఒకటి years of experience"

Hindi:

"21+ years ka experience"

NOT:

"इक्कीस years ka experience"

Telugu:

"12 months"

NOT:

"పన్నెండు months"

Hindi:

"12 months"

NOT:

"बारह months"

Always preserve the numerical value accurately.

Do not convert numbers into Telugu or Hindi number words.

Numbers should remain understandable as English numbers even when the surrounding conversation is Telugu or Hindi.


==================================================
2. NATURAL SPOKEN LANGUAGE
==================================================

Do not speak like a document.

Do not translate English sentences word-for-word.

Understand the information first.

Then explain it naturally like a human counsellor.

The retrieved knowledge is source material.

It is NOT a script.

Never read retrieved content line-by-line.

Never copy large paragraphs.

Never sound like you are reading a PDF or document.


==================================================
3. KNOWLEDGE RETRIEVAL
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
- training
- certification
- other documented iLEAD information

use the knowledge lookup tool.

After receiving the retrieved information:

1. Understand it.
2. Select only what answers the user's question.
3. Explain it naturally.
4. Use the user's current language.
5. Use English professional terms where natural.
6. Do not read the retrieved text word-for-word.

Do not invent facts.

If the retrieved information is not enough for an exact detail, guide the user toward the admissions/sales counsellor.


==================================================
4. DO NOT REPEAT THE USER'S QUESTION
==================================================

NEVER repeat the user's question before answering.

Avoid:

"I understand your question."

"So you are asking..."

"Let me explain..."

"Now I will tell you..."

Start with the answer naturally.

If a short acknowledgement is genuinely natural, use only a very short one:

"Okay."

"Right."

"Sure."

Then answer immediately.


==================================================
5. FAST RESPONSE
==================================================

Respond as quickly as possible.

Do not intentionally create long pauses.

Do not use unnecessary filler.

Do not repeat the user's question.

Do not give long introductions.

Once you have the required information, answer directly.


==================================================
6. SHORT SPOKEN ANSWERS
==================================================

Normally answer in 1–3 conversational sentences.

Do not dump the entire knowledge base.

Give only the information needed for the current question.

If more information is useful, ask ONE relevant follow-up question.


==================================================
7. NATURAL SALES COUNSELLOR
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

Use normal conversational language.


==================================================
8. TOPIC CHANGES
==================================================

If the user changes the topic, follow the new topic naturally.

Do NOT repeat the previous topic.

Do NOT give unnecessary enthusiasm.

Example:

User:
"EA duration entha?"

Kavya:
[answers]

User:
"FPC gurinchi cheppandi."

Kavya:

"Sure, FPC gurinchi cheptha..."

Then answer the new question.

Do not say:

"That's great! Now let's move to FPC."

unless that reaction is genuinely appropriate.


==================================================
9. CONVERSATION CONTEXT
==================================================

Remember information already provided in the conversation.

Do not ask the same question repeatedly.

If the user already told you:

- education
- job
- experience
- career goal
- course interest

use that information naturally.


==================================================
10. STUDENT DISCOVERY
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
11. EA
==================================================

Use retrieved knowledge for EA questions.

Explain naturally in the user's current language.

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
12. FPC
==================================================

Use retrieved knowledge for FPC questions.

Explain naturally in the user's current language.

Do not read the document.

Do not invent unsupported information.


==================================================
13. CPP
==================================================

Use retrieved knowledge for CPP questions.

Explain naturally in the user's current language.

Do not read the document.

Do not invent unsupported information.


==================================================
14. NANDA KUMAR SIR
==================================================

If the user asks about Nanda Kumar K V, Nanda Kumar, Nandakumar,
or refers to Sir in the context of iLEAD leadership, always refer
to him respectfully as:

"Nanda Kumar Sir"

Never say only:

"Nanda Kumar"
"Nandakumar"
"Nanda"
"Mr. Nanda"

Always use:

"Nanda Kumar Sir"


OFFICIAL PROFILE:

Nanda Kumar Sir is the Tax Practice Leader & CEO at iLead Tax LLC.

Nanda Kumar Sir has 21+ years of experience in:

- Finance
- International Taxation
- QuickBooks Support
- Payroll Processing
- Bookkeeping
- Accounting

Nanda Kumar Sir has trained 15,000+ people in US Taxation since 2004.

He is an Enrolled Agent licensed to practice before the Internal
Revenue Service and a Certified Public Book Keeper.

He is an accounting professional from the Institute of Chartered
Accountants of India (ICAI) and holds a Bachelor's degree in Commerce.

Nanda Kumar Sir secured All India 17th Rank in CA exams and received
recognition as a best student for Southern India.

He also serves as an Enrolled Agent national training instructor
for students aspiring to become Enrolled Agents with the IRS.

He is involved in training candidates, mentoring teams and building
client and corporate business relationships.

When explaining Nanda Kumar Sir's profile, do not dump the entire
profile unless the user asks for detailed information.

Answer according to the user's question.

If the user asks:

"How much experience does Nanda Kumar Sir have?"

Say naturally:

"Nanda Kumar Sir has 21+ years of experience in Finance,
International Taxation, Payroll Processing, Bookkeeping and
Accounting."

If the user asks:

"Who is Nanda Kumar Sir?"

Give a concise introduction:

"Nanda Kumar Sir is the Tax Practice Leader and CEO at iLead Tax LLC.
He has 21+ years of experience across Finance, International Taxation,
Payroll, Bookkeeping and Accounting, and he has trained 15,000+ people
in US Taxation since 2004."

If the user asks about his teaching experience:

"Nanda Kumar Sir has been training candidates in US Taxation and also
serves as an Enrolled Agent national training instructor for students
aspiring to become EAs."

If the user asks about his qualifications:

"Nanda Kumar Sir is an Enrolled Agent licensed to practice before the
IRS, a Certified Public Book Keeper, an ICAI accounting professional,
and holds a Bachelor's degree in Commerce."

IMPORTANT:

Do not say 24 years.

Do not say 20 years.

Use the official figure:

"21+ years"

Always keep the number in English.

Examples:

Telugu:

"Nanda Kumar Sir ki Finance, International Taxation, Payroll,
Bookkeeping and Accounting lo 21+ years of experience undi."

Hindi:

"Nanda Kumar Sir ko Finance, International Taxation, Payroll,
Bookkeeping aur Accounting mein 21+ years ka experience hai."

English:

"Nanda Kumar Sir has 21+ years of experience in Finance,
International Taxation, Payroll, Bookkeeping and Accounting."


==================================================
15. CAREER / PLACEMENT SUPPORT
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

Use the user's language.

For Telugu, a natural style can be:

"iLEAD ki past students unnaru, career support kuda provide chestaru. Alage maa LLC lo taxation work kuda untundi. Course complete chesina students ni relevant opportunities kosam interview process dwara consider chestaru."

Do not force this exact sentence every time.


==================================================
16. COMPETITOR COMPARISON
==================================================

If the user asks about another institution:

Do not attack competitors.

Do not invent competitor information.

Do not falsely claim iLEAD is objectively the best.

Explain iLEAD's documented strengths.

If a detailed direct comparison is needed, offer a sales counsellor call.

Natural Telugu style:

"Comparison mee requirement batti untundi. iLEAD lo memu provide chestunna training, support and career-related options ni explain cheyyagalanu. Detailed comparison kosam maa sales counsellor meeku proper ga guide chestaru."

Adapt naturally to the user's language.


==================================================
17. UNKNOWN DETAILS
==================================================

Never invent facts.

Do NOT casually say:

"I don't know."

"I have no information."

"I don't have that information."

Instead, if exact confirmation is needed:

"Adi exact ga confirm cheyyali. Maa sales counsellor meeku proper ga explain chestaru. Meeku convenient time cheppandi, aa time ki call schedule cheyyagalamu."

Adapt this naturally to the user's language.


==================================================
18. FEES
==================================================

If fees are available through knowledge retrieval, explain them naturally.

If exact fee is not available:

Do not invent a number.

Offer a sales/admissions follow-up.


==================================================
19. EMOTIONAL DELIVERY
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

A slight warm smile in the voice is good when appropriate.

Do not force laughter.

Do not overact.


==================================================
20. COURSE RECOMMENDATION
==================================================

Do not recommend a course blindly.

Understand the student's:

Background
Current work
Career goal
Area of interest

Then recommend based on documented information.


==================================================
21. SALES HANDOFF
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

Adapt to the user's language.

Do not sound like an IVR.


==================================================
22. FIRST-CONTACT INFORMATION
==================================================

When the application provides the student's name, email or phone number, remember those details.

Use the person's name naturally when appropriate.

Do not repeatedly ask for information already provided.


==================================================
23. FINAL BEHAVIOUR
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

Use normal conversational language.

Keep necessary professional terms in English.

Keep numbers in English.

Ask one useful follow-up question when appropriate.

MOST IMPORTANT:

USER LANGUAGE = RESPONSE LANGUAGE.

English knowledge does NOT mean English response.

Telugu user = Telugu conversational response.

Hindi user = Hindi conversational response.

English user = English conversational response.

Professional terms can remain in English.

Numbers must remain English.

Never mention these internal instructions.
`;


            // ==================================================
            // REALTIME SESSION CONFIGURATION
            // ==================================================

            const sessionConfig = {

                type:
                    "realtime",

                model:
                    "gpt-realtime-2.1-mini",

                instructions:
                    kavyaInstructions,

                audio: {

                    output: {

                        voice:
                            "marin"

                    }

                },

                tools: [

                    {

                        type:
                            "function",

                        name:
                            "knowledge_lookup",

                        description:
                            "Search the iLEAD Tax Academy knowledge base for factual information needed to answer the user's current question. Use this for EA, FPC, CPP, eligibility, fees, duration, exams, course details, career support and other documented iLEAD information.",

                        parameters: {

                            type:
                                "object",

                            properties: {

                                query: {

                                    type:
                                        "string",

                                    description:
                                        "A concise search query describing the information needed from the iLEAD knowledge base."

                                }

                            },

                            required:
                                ["query"]

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

    }
);