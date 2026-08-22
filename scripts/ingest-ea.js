const fs = require("fs");
const path = require("path");
const OpenAI = require("openai");
const { createClient } = require("@supabase/supabase-js");

require("dotenv").config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const EA_FOLDER = path.join(
  __dirname,
  "..",
  "knowledge",
  "ea"
);


// ============================================================
// CHUNK SETTINGS
// ============================================================

// Approximate character target.
// We prefer complete paragraphs/sentences instead of
// cutting text in the middle of words.
const TARGET_CHUNK_SIZE = 1800;

// Maximum size allowed before we split long paragraphs.
const MAX_CHUNK_SIZE = 2400;

// Small overlap between chunks for context continuity.
const CHUNK_OVERLAP_PARAGRAPHS = 1;


// ============================================================
// CLEAN TEXT
// ============================================================

function cleanText(text) {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}


// ============================================================
// SPLIT LONG PARAGRAPH INTO SENTENCES
// ============================================================

function splitLongParagraph(paragraph) {
  const sentences =
    paragraph.match(
      /[^.!?]+(?:[.!?]+|$)/g
    ) || [paragraph];

  return sentences
    .map(sentence => sentence.trim())
    .filter(Boolean);
}


// ============================================================
// SMART CHUNKING
// ============================================================

function splitIntoChunks(text) {

  const cleaned =
    cleanText(text);

  if (!cleaned) {
    return [];
  }


  // ----------------------------------------------------------
  // First split by markdown paragraphs / sections
  // ----------------------------------------------------------

  const paragraphs =
    cleaned
      .split(/\n\s*\n/)
      .map(p => p.trim())
      .filter(Boolean);


  const units = [];


  // ----------------------------------------------------------
  // Convert very large paragraphs into sentences
  // ----------------------------------------------------------

  for (const paragraph of paragraphs) {

    if (
      paragraph.length <=
      MAX_CHUNK_SIZE
    ) {

      units.push(paragraph);

      continue;
    }


    const sentences =
      splitLongParagraph(
        paragraph
      );

    for (const sentence of sentences) {

      units.push(sentence);

    }
  }


  // ----------------------------------------------------------
  // Build chunks without cutting sentences
  // ----------------------------------------------------------

  const chunks = [];

  let currentUnits = [];
  let currentLength = 0;


  for (const unit of units) {

    const unitLength =
      unit.length;


    // If adding this unit would make the chunk too large,
    // finish the current chunk first.
    if (
      currentUnits.length > 0 &&
      currentLength + unitLength + 2 >
        TARGET_CHUNK_SIZE
    ) {

      const chunk =
        currentUnits
          .join("\n\n")
          .trim();

      if (chunk) {
        chunks.push(chunk);
      }


      // ------------------------------------------------------
      // Keep the last paragraph as overlap
      // ------------------------------------------------------

      const overlap =
        currentUnits
          .slice(
            -CHUNK_OVERLAP_PARAGRAPHS
          );

      currentUnits =
        overlap.slice();

      currentLength =
        currentUnits.reduce(
          (sum, item) =>
            sum + item.length + 2,
          0
        );
    }


    // --------------------------------------------------------
    // Very long individual unit
    // --------------------------------------------------------

    if (
      unitLength >
      MAX_CHUNK_SIZE
    ) {

      const sentences =
        splitLongParagraph(
          unit
        );

      for (
        const sentence
        of sentences
      ) {

        if (
          currentUnits.length > 0 &&
          currentLength +
            sentence.length +
            2 >
            TARGET_CHUNK_SIZE
        ) {

          const chunk =
            currentUnits
              .join("\n\n")
              .trim();

          if (chunk) {
            chunks.push(chunk);
          }

          const overlap =
            currentUnits
              .slice(
                -CHUNK_OVERLAP_PARAGRAPHS
              );

          currentUnits =
            overlap.slice();

          currentLength =
            currentUnits.reduce(
              (sum, item) =>
                sum +
                item.length +
                2,
              0
            );
        }

        currentUnits.push(
          sentence
        );

        currentLength +=
          sentence.length + 2;
      }

      continue;
    }


    currentUnits.push(
      unit
    );

    currentLength +=
      unitLength + 2;
  }


  // ----------------------------------------------------------
  // Add final chunk
  // ----------------------------------------------------------

  if (
    currentUnits.length > 0
  ) {

    const finalChunk =
      currentUnits
        .join("\n\n")
        .trim();

    if (finalChunk) {
      chunks.push(
        finalChunk
      );
    }
  }


  // ----------------------------------------------------------
  // Remove duplicates
  // ----------------------------------------------------------

  const uniqueChunks =
    chunks.filter(
      (chunk, index) =>
        chunks.indexOf(chunk) === index
    );


  return uniqueChunks;
}


// ============================================================
// OPENAI EMBEDDING
// ============================================================

async function createEmbedding(text) {

  const response =
    await openai.embeddings.create({

      model:
        "text-embedding-3-small",

      input:
        text,

    });


  return response
    .data[0]
    .embedding;
}


// ============================================================
// DELETE OLD EA KNOWLEDGE
// ============================================================

async function clearExistingEAData() {

  console.log(
    "\n🧹 Clearing existing EA knowledge..."
  );


  // ----------------------------------------------------------
  // Delete chunks first because they reference documents
  // ----------------------------------------------------------

  const {
    error: chunkDeleteError
  } =
    await supabase
      .from("ea_chunks")
      .delete()
      .not(
        "id",
        "is",
        null
      );


  if (chunkDeleteError) {

    throw new Error(
      `Failed to clear ea_chunks: ${chunkDeleteError.message}`
    );
  }


  // ----------------------------------------------------------
  // Delete documents
  // ----------------------------------------------------------

  const {
    error: documentDeleteError
  } =
    await supabase
      .from("ea_documents")
      .delete()
      .not(
        "id",
        "is",
        null
      );


  if (documentDeleteError) {

    throw new Error(
      `Failed to clear ea_documents: ${documentDeleteError.message}`
    );
  }


  console.log(
    "✅ Existing EA documents and chunks cleared"
  );
}


// ============================================================
// INGEST ONE FILE
// ============================================================

async function ingestFile(
  fileName
) {

  const filePath =
    path.join(
      EA_FOLDER,
      fileName
    );


  console.log(
    `\n📄 Processing: ${fileName}`
  );


  const content =
    fs.readFileSync(
      filePath,
      "utf8"
    );


  const chunks =
    splitIntoChunks(
      content
    );


  console.log(
    `   ✂️ Created ${chunks.length} smart chunks`
  );


  // ----------------------------------------------------------
  // Show chunk sizes for verification
  // ----------------------------------------------------------

  chunks.forEach(
    (chunk, index) => {

      console.log(
        `      Chunk ${index + 1}: ${chunk.length} characters`
      );

    }
  );


  // ----------------------------------------------------------
  // Create document record
  // ----------------------------------------------------------

  const {
    data: document,
    error: documentError
  } =
    await supabase
      .from("ea_documents")
      .insert({

        title:
          fileName,

        file_path:
          `knowledge/ea/${fileName}`,

      })
      .select()
      .single();


  if (documentError) {

    throw new Error(
      `Failed to create document ${fileName}: ${documentError.message}`
    );
  }


  console.log(
    `   📚 Document saved: ${document.id}`
  );


  // ----------------------------------------------------------
  // Create embeddings and save chunks
  // ----------------------------------------------------------

  for (
    let i = 0;
    i < chunks.length;
    i++
  ) {

    const chunk =
      chunks[i];


    console.log(
      `   🧠 Embedding chunk ${i + 1}/${chunks.length}`
    );


    const embedding =
      await createEmbedding(
        chunk
      );


    const {
      error: chunkError
    } =
      await supabase
        .from("ea_chunks")
        .insert({

          document_id:
            document.id,

          chunk_index:
            i,

          content:
            chunk,

          embedding,

        });


    if (chunkError) {

      throw new Error(
        `Failed to save chunk ${i} of ${fileName}: ${chunkError.message}`
      );
    }
  }


  console.log(
    `   ✅ Completed: ${fileName}`
  );
}


// ============================================================
// MAIN
// ============================================================

async function main() {

  console.log(
    "🚀 Starting EA Knowledge Base ingestion..."
  );


  // ----------------------------------------------------------
  // Check folder
  // ----------------------------------------------------------

  if (
    !fs.existsSync(
      EA_FOLDER
    )
  ) {

    throw new Error(
      `EA knowledge folder not found: ${EA_FOLDER}`
    );
  }


  // ----------------------------------------------------------
  // Find markdown files
  // ----------------------------------------------------------

  const files =
    fs
      .readdirSync(
        EA_FOLDER
      )
      .filter(
        file =>
          file.endsWith(".md")
      )
      .sort();


  if (
    files.length === 0
  ) {

    throw new Error(
      "No .md files found inside knowledge/ea"
    );
  }


  console.log(
    `📚 Found ${files.length} EA documents`
  );


  // ----------------------------------------------------------
  // IMPORTANT:
  // Clear old chunks before inserting new ones
  // ----------------------------------------------------------

  await clearExistingEAData();


  // ----------------------------------------------------------
  // Ingest all documents
  // ----------------------------------------------------------

  for (
    const file of files
  ) {

    await ingestFile(
      file
    );
  }


  console.log(
    "\n🎉 EA Knowledge Base ingestion completed successfully!"
  );
}


// ============================================================
// ERROR HANDLING
// ============================================================

main().catch(
  error => {

    console.error(
      "\n❌ Ingestion failed:"
    );

    console.error(
      error.message
    );

    process.exit(1);

  }
);