const startBtn =
    document.getElementById("startBtn");

const disconnectBtn =
    document.getElementById("disconnectBtn");

const status =
    document.getElementById("status");

const messages =
    document.getElementById("messages");


let peerConnection = null;
let dataChannel = null;
let localStream = null;
let audioElement = null;

let currentAssistantText = "";

let isSpeaking = false;

// Prevent duplicate AI responses
let responseInProgress = false;

// Identify the latest TTS request
let ttsGeneration = 0;


// ========================================
// ACTIVE PCM AUDIO SOURCES
// ========================================

let activePCMSourceNodes = [];

// ========================================
// ADD MESSAGE TO SCREEN
// ========================================

function addMessage(
    sender,
    text
) {

    if (
        !text ||
        typeof text !== "string"
    ) {
        return;
    }


    const div =
        document.createElement("div");


    div.className =
        `message ${sender}`;


    div.innerHTML =
        `<strong>${sender.toUpperCase()}:</strong><br>${text}`;


    messages.appendChild(
        div
    );


    messages.scrollTop =
        messages.scrollHeight;

}


// ========================================
// STOP CURRENT MANOJ AUDIO
// ========================================

function stopManojAudio() {

    console.log(
        "🛑 Stopping current Manoj audio"
    );


    // ========================================
    // INVALIDATE ANY PREVIOUS TTS REQUEST
    // ========================================

    ttsGeneration++;


    // ========================================
    // STOP ACTIVE PCM AUDIO SOURCES
    // ========================================

    if (
        activePCMSourceNodes.length > 0
    ) {

        console.log(
            `🛑 Stopping ${activePCMSourceNodes.length} PCM audio source(s)`
        );


        activePCMSourceNodes.forEach(
            function (source) {

                try {

                    source.stop();

                } catch (error) {

                    // Source may have already finished.
                    console.log(
                        "PCM source stop warning:",
                        error
                    );

                }

                try {

                    source.disconnect();

                } catch (error) {

                    console.log(
                        "PCM source disconnect warning:",
                        error
                    );

                }

            }
        );


        activePCMSourceNodes =
            [];

    }


    isSpeaking =
        false;

}
// ========================================
// CANCEL CURRENT OPENAI RESPONSE
// ========================================

function cancelCurrentOpenAIResponse() {

    if (
        !dataChannel ||
        dataChannel.readyState !==
        "open"
    ) {

        return;

    }


    try {

        dataChannel.send(
            JSON.stringify({

                type:
                    "response.cancel"

            })
        );


        console.log(
            "ðŸ›‘ OpenAI response cancelled"
        );


    } catch (error) {

        console.error(
            "âŒ Could not cancel OpenAI response:",
            error
        );

    }

}


// ========================================
// PLAY MANOJ VOICE
// ========================================

async function speakWithManoj(
    text
) {

    if (
        !text ||
        typeof text !== "string"
    ) {
        return;
    }

    stopManojAudio();

    const myGeneration =
        ++ttsGeneration;

    try {

        isSpeaking =
            true;

        console.log(
            "🎙️ Sending text to ElevenLabs:",
            text
        );

        // ========================================
        // CREATE AUDIO CONTEXT
        // ========================================

        if (
            !window.manojAudioContext
        ) {

            window.manojAudioContext =
                new (
                    window.AudioContext ||
                    window.webkitAudioContext
                )({
                    sampleRate: 16000
                });

        }

        const audioContext =
            window.manojAudioContext;

        if (
            audioContext.state ===
            "suspended"
        ) {

            await audioContext.resume();

        }

        // ========================================
        // REQUEST ELEVENLABS PCM
        // ========================================

        const response =
            await fetch(
                "/tts",
                {

                    method:
                        "POST",

                    headers: {

                        "Content-Type":
                            "application/json"

                    },

                    body:
                        JSON.stringify({

                            text:
                                text

                        })

                }
            );

        if (
            !response.ok
        ) {

            const errorText =
                await response.text();

            console.error(
                "❌ ElevenLabs TTS error:",
                errorText
            );

            isSpeaking =
                false;

            return;

        }

        if (
            !response.body
        ) {

            console.error(
                "❌ ElevenLabs returned no audio stream"
            );

            isSpeaking =
                false;

            return;

        }

        // ========================================
// STREAM PCM AUDIO DIRECTLY
// ========================================

const reader =
    response.body.getReader();

let pcmBuffer =
    new Uint8Array(0);

let nextStartTime =
    audioContext.currentTime + 0.08;

let firstAudioStarted =
    false;

while (true) {

    const {
        done,
        value
    } =
        await reader.read();

    if (done) {
        break;
    }

    // ------------------------------------
    // IGNORE OLD REQUEST
    // ------------------------------------

    if (
        myGeneration !==
        ttsGeneration
    ) {

        try {
            await reader.cancel();
        } catch (_) {}

        return;

    }

    if (
        !value ||
        value.length === 0
    ) {

        continue;

    }

    // ------------------------------------
    // COMBINE PCM BYTES
    // ------------------------------------

    const combined =
        new Uint8Array(
            pcmBuffer.length +
            value.length
        );

    combined.set(
        pcmBuffer,
        0
    );

    combined.set(
        value,
        pcmBuffer.length
    );

    pcmBuffer =
        combined;

    // ------------------------------------
    // PCM16 NEEDS 2-BYTE SAMPLES
    // ------------------------------------

    const usableLength =
        pcmBuffer.length -
        (pcmBuffer.length % 2);

    if (
        usableLength <= 0
    ) {

        continue;

    }

    const usable =
        pcmBuffer.slice(
            0,
            usableLength
        );

    pcmBuffer =
        pcmBuffer.slice(
            usableLength
        );

    // ------------------------------------
    // PCM16 → FLOAT32
    // ------------------------------------

    const sampleCount =
        usable.length / 2;

    const floatSamples =
        new Float32Array(
            sampleCount
        );

    const view =
        new DataView(
            usable.buffer,
            usable.byteOffset,
            usable.byteLength
        );

    for (
        let i = 0;
        i < sampleCount;
        i++
    ) {

        const sample =
            view.getInt16(
                i * 2,
                true
            );

        floatSamples[i] =
            sample / 32768;

    }

    // ------------------------------------
    // CREATE AUDIO BUFFER
    // ------------------------------------

    const audioBuffer =
        audioContext.createBuffer(
            1,
            floatSamples.length,
            16000
        );

    audioBuffer
        .getChannelData(0)
        .set(floatSamples);

    // ------------------------------------
    // CREATE SOURCE
    // ------------------------------------

    const source =
        audioContext.createBufferSource();

    source.buffer =
        audioBuffer;

    source.connect(
        audioContext.destination
    );

    activePCMSourceNodes.push(
        source
    );

    source.onended =
        function () {

            const index =
                activePCMSourceNodes.indexOf(
                    source
                );

            if (
                index !== -1
            ) {

                activePCMSourceNodes.splice(
                    index,
                    1
                );

            }

        };

    // ------------------------------------
    // SCHEDULE WITHOUT GAPS
    // ------------------------------------

    const startTime =
        Math.max(
            nextStartTime,
            audioContext.currentTime + 0.01
        );

    source.start(
        startTime
    );

    nextStartTime =
        startTime +
        audioBuffer.duration;

    // ------------------------------------
    // FIRST AUDIO
    // ------------------------------------

    if (
        !firstAudioStarted
    ) {

        firstAudioStarted =
            true;

        console.log(
            "🔊 First PCM chunk started"
        );

    }

}

// ========================================
// STREAM FINISHED
// ========================================

console.log(
    "✅ ElevenLabs PCM streaming finished"
);

if (
    myGeneration ===
    ttsGeneration
) {

    const remainingTime =
        Math.max(
            0,
            (
                nextStartTime -
                audioContext.currentTime
            ) * 1000
        );

    setTimeout(
        function () {

            if (
                myGeneration ===
                ttsGeneration
            ) {

                isSpeaking =
                    false;

            }

        },
        remainingTime
    );

}

    } catch (error) {

        console.error(
            "❌ PCM TTS playback error:",
            error
        );

        if (
            myGeneration ===
            ttsGeneration
        ) {

            isSpeaking =
                false;

        }

    }

}async function handleKnowledgeLookup(
    toolCallId,
    argumentsJson
) {

    try {

        console.log(
            "ðŸ”Ž Knowledge lookup requested:",
            argumentsJson
        );


        let args = {};


        try {

            args =
                JSON.parse(
                    argumentsJson || "{}"
                );

        } catch (error) {

            console.error(
                "âŒ Failed to parse tool arguments:",
                error
            );


            args = {};

        }


        const query =
            args.query;


        if (
            !query ||
            typeof query !== "string"
        ) {

            console.error(
                "âŒ Knowledge lookup query missing"
            );

            return;

        }


        const response =
            await fetch(
                "/knowledge-search",
                {

                    method:
                        "POST",

                    headers: {

                        "Content-Type":
                            "application/json"

                    },

                    body:
                        JSON.stringify({

                            query:
                                query

                        })

                }
            );


        if (
            !response.ok
        ) {

            const errorText =
                await response.text();


            throw new Error(
                `Knowledge search failed: ${errorText}`
            );

        }


        const result =
            await response.json();


        console.log(
            "ðŸ“š Knowledge result:",
            result
        );


        const context =
            result.context || "";


        if (
            !dataChannel ||
            dataChannel.readyState !==
            "open"
        ) {

            console.error(
                "âŒ Data channel is not open"
            );

            return;

        }


        dataChannel.send(
            JSON.stringify({

                type:
                    "conversation.item.create",

                item: {

                    type:
                        "function_call_output",

                    call_id:
                        toolCallId,

                    output:
                        context ||
                        "No relevant information was found in the iLEAD knowledge base."

                }

            })
        );


        console.log(
            "ðŸ“¤ Knowledge result sent to OpenAI"
        );


        dataChannel.send(
            JSON.stringify({

                type:
                    "response.create"

            })
        );


    } catch (error) {

        console.error(
            "âŒ Knowledge lookup error:",
            error
        );


        if (
            dataChannel &&
            dataChannel.readyState ===
            "open"
        ) {

            dataChannel.send(
                JSON.stringify({

                    type:
                        "conversation.item.create",

                    item: {

                        type:
                            "function_call_output",

                        call_id:
                            toolCallId,

                        output:
                            "The requested information could not be retrieved right now."

                    }

                })
            );


            dataChannel.send(
                JSON.stringify({

                    type:
                        "response.create"

                })
            );

        }

    }

}


// ========================================
// START CONVERSATION
// ========================================

startBtn.onclick =
    async function () {

        try {

            startBtn.disabled =
                true;


            status.innerText =
                "Requesting microphone...";


            addMessage(
                "ai",
                "Requesting microphone access..."
            );


            // ========================================
            // 1. MICROPHONE
            // ========================================

            localStream =
                await navigator.mediaDevices
                    .getUserMedia({

                        audio: {

                            echoCancellation:
                                true,

                            noiseSuppression:
                                true,

                            autoGainControl:
                                true

                        }

                    });


            console.log(
                "ðŸŽ¤ Microphone access granted"
            );


            // ========================================
            // 2. CREATE WEBRTC CONNECTION
            // ========================================

            peerConnection =
                new RTCPeerConnection();


            console.log(
                "ðŸ”— RTCPeerConnection created"
            );


            // ========================================
            // 3. ADD MICROPHONE
            // ========================================

            const audioTrack =
                localStream
                    .getAudioTracks()[0];


            peerConnection.addTrack(
                audioTrack,
                localStream
            );


            console.log(
                "ðŸŽ¤ Microphone track added"
            );


            // ========================================
            // 4. OPENAI AUDIO IS NOT PLAYED
            // ========================================

            audioElement =
                document.createElement(
                    "audio"
                );


            audioElement.autoplay =
                false;


            audioElement.playsInline =
                true;


            audioElement.style.display =
                "none";


            document.body.appendChild(
                audioElement
            );


            peerConnection.ontrack =
                function (event) {

                    console.log(
                        "ðŸ”‡ OpenAI audio received â€” not playing"
                    );

                };


            // ========================================
            // 5. DATA CHANNEL
            // ========================================

            dataChannel =
                peerConnection.createDataChannel(
                    "oai-events"
                );


            dataChannel.onopen =
                function () {

                    console.log(
                        "ðŸ“¡ OpenAI data channel connected"
                    );


                    status.innerText =
                        "Connected âœ…";


                    addMessage(
                        "ai",
                        "Connected to Manoj. You can speak now."
                    );

                                        dataChannel.send(
                        JSON.stringify({

                            type:
                                "conversation.item.create",

                            item: {

                                type:
                                    "message",

                                role:
                                    "user",

                                content: [

                                    {

                                        type:
                                            "input_text",

                                        text:
    "Start the conversation now. Your first greeting MUST be in English, regardless of the user's language. Say: Hi, I'm Manoj. How can I help you today? Keep it warm, natural, and brief."

                                    }

                                ]

                            }

                        })
                    );


                    dataChannel.send(
                        JSON.stringify({

                            type:
                                "response.create"

                        })
                    );

                };


            // ========================================
            // DATA CHANNEL MESSAGE HANDLER
            // ========================================

            dataChannel.onmessage =
                async function (event) {

                    try {

                        const data =
                            JSON.parse(
                                event.data
                            );


                        console.log(
                            "ðŸ“© OpenAI Event:",
                            data
                        );


                        // ========================================
                        // OPENAI ERROR
                        // ========================================

                        if (
                            data.type ===
                            "error"
                        ) {

                            console.error(
                                "âŒ OpenAI error:",
                                data
                            );


                            addMessage(
                                "ai",
                                "OpenAI error: " +
                                (
                                    data.error?.message ||
                                    "Unknown error"
                                )
                            );


                            return;

                        }


                        // ========================================
                        // USER SPEECH STARTED
                        // ========================================
                        //
                        // If the user starts talking while
                        // Manoj is speaking, immediately stop
                        // the current Manoj audio.
                        //
                        // ========================================

                        if (
                            data.type ===
                            "input_audio_buffer.speech_started"
                        ) {

                            console.log(
                                "ðŸŽ¤ User started speaking"
                            );


                            if (
                                isSpeaking
                            ) {

                                console.log(
                                    "ðŸ›‘ User interrupted Manoj"
                                );


                                stopManojAudio();


                                cancelCurrentOpenAIResponse();

                            }


                            return;

                        }


                        // ========================================
                        // USER TRANSCRIPT
                        // ========================================

                        if (
                            data.type ===
                            "conversation.item.input_audio_transcription.completed"
                        ) {

                            if (
                                data.transcript
                            ) {

                                addMessage(
                                    "user",
                                    data.transcript
                                );

                            }


                            return;

                        }


                        // ========================================
                        // RESPONSE CREATED
                        // ========================================

                        if (
                            data.type ===
                            "response.created"
                        ) {

                            console.log(
                                "ðŸ§  OpenAI response started"
                            );


                            responseInProgress =
                                true;


                            currentAssistantText =
                                "";


                            return;

                        }


                        // ========================================
                        // AI TEXT DELTA
                        // ========================================

                        if (
    data.type ===
    "response.output_text.delta"
) {

    if (
        !responseInProgress
    ) {

        responseInProgress =
            true;

    }


    const delta =
        data.delta || "";


    // Keep complete response for UI
    currentAssistantText +=
        delta;
return;

}


                        // ========================================
                        // AI TEXT COMPLETE
                        // ========================================

                        if (
                            data.type ===
                            "response.output_text.done"
                        ) {

                            // --------------------------------
                            // DUPLICATE PROTECTION
                            // --------------------------------

                            if (
                                !responseInProgress
                            ) {

                                console.log(
                                    "ðŸ›‘ Ignoring duplicate text completion"
                                );

                                return;

                            }


                            const finalText =
                                (
                                    data.text ||
                                    currentAssistantText
                                ).trim();
                            responseInProgress =
                                false;


                            currentAssistantText =
                                "";


                            if (
                                !finalText
                            ) {

                                return;

                            }


                            console.log(
                                "ðŸ“ OpenAI final response:",
                                finalText
                            );
                            await speakWithManoj(
    finalText
);


                            addMessage(
                                "ai",
                                finalText
                            );

                            return;

                        }


                        // ========================================
                        // RESPONSE COMPLETE
                        // ========================================

                        if (
                            data.type ===
                            "response.done"
                        ) {

                            responseInProgress =
                                false;


                            return;

                        }


                        // ========================================
                        // KNOWLEDGE TOOL CALL
                        // ========================================

                        if (
                            data.type ===
                            "response.function_call_arguments.done"
                        ) {

                            console.log(
                                "ðŸ”Ž Knowledge tool call received"
                            );


                            const functionName =
                                data.name;


                            const argumentsJson =
                                data.arguments;


                            const callId =
                                data.call_id;


                            if (
                                functionName ===
                                "knowledge_lookup"
                            ) {

                                await handleKnowledgeLookup(

                                    callId,

                                    argumentsJson

                                );

                            }


                            return;

                        }


                    } catch (error) {

                        console.error(
                            "âŒ Data channel error:",
                            error
                        );

                    }

                };


            // ========================================
            // 6. CONNECTION STATE
            // ========================================

            peerConnection.onconnectionstatechange =
                function () {

                    console.log(
                        "WebRTC state:",
                        peerConnection.connectionState
                    );


                    if (
                        peerConnection.connectionState ===
                        "connected"
                    ) {

                        status.innerText =
                            "Connected âœ…";

                    }


                    if (
                        peerConnection.connectionState ===
                        "connecting"
                    ) {

                        status.innerText =
                            "Connecting...";

                    }


                    if (
                        peerConnection.connectionState ===
                        "disconnected"
                    ) {

                        status.innerText =
                            "Disconnected";

                    }


                    if (
                        peerConnection.connectionState ===
                        "failed"
                    ) {

                        status.innerText =
                            "Connection failed";

                    }

                };


            // ========================================
            // 7. CREATE SDP OFFER
            // ========================================

            const offer =
                await peerConnection.createOffer();


            await peerConnection.setLocalDescription(
                offer
            );


            console.log(
                "ðŸ“¤ SDP offer created"
            );


            // ========================================
            // 8. SEND SDP TO SERVER
            // ========================================

            status.innerText =
                "Connecting to Manoj...";


            const response =
                await fetch(
                    "/session",
                    {

                        method:
                            "POST",

                        headers: {

                            "Content-Type":
                                "application/sdp"

                        },

                        body:
                            offer.sdp

                    }
                );


            if (
                !response.ok
            ) {

                const errorText =
                    await response.text();


                throw new Error(
                    `Session request failed: ${errorText}`
                );

            }


            // ========================================
            // 9. RECEIVE OPENAI SDP ANSWER
            // ========================================

            const answerSdp =
                await response.text();


            console.log(
                "ðŸ“¥ OpenAI SDP answer received"
            );


            // ========================================
            // 10. SET REMOTE DESCRIPTION
            // ========================================

            await peerConnection.setRemoteDescription(
                {

                    type:
                        "answer",

                    sdp:
                        answerSdp

                }
            );


            console.log(
                "âœ… Remote description set"
            );


            status.innerText =
                "Connected âœ…";


        } catch (error) {

            console.error(
                "âŒ Voice connection error:",
                error
            );


            status.innerText =
                "Connection failed";


            addMessage(
                "ai",
                `Error: ${error.message}`
            );


            disconnectConversation();

        }

    };


// ========================================
// DISCONNECT BUTTON
// ========================================

disconnectBtn.onclick =
    function () {

        disconnectConversation();

    };


// ========================================
// DISCONNECT
// ========================================

function disconnectConversation() {

    console.log(
        "ðŸ”´ Disconnecting..."
    );


    // --------------------------------
    // Stop Manoj audio first
    // --------------------------------

    stopManojAudio();


    // --------------------------------
    // Cancel any OpenAI response
    // --------------------------------

    cancelCurrentOpenAIResponse();


    // --------------------------------
    // Close data channel
    // --------------------------------

    if (
        dataChannel
    ) {

        try {

            dataChannel.close();

        } catch (error) {

            console.log(
                error
            );

        }


        dataChannel =
            null;

    }


    // --------------------------------
    // Close WebRTC
    // --------------------------------

    if (
        peerConnection
    ) {

        try {

            peerConnection.close();

        } catch (error) {

            console.log(
                error
            );

        }


        peerConnection =
            null;

    }


    // --------------------------------
    // Stop microphone
    // --------------------------------

    if (
        localStream
    ) {

        localStream
            .getTracks()
            .forEach(
                function (track) {

                    track.stop();

                }
            );


        localStream =
            null;

    }


    // --------------------------------
    // Remove audio element
    // --------------------------------

    if (
        audioElement
    ) {

        audioElement.srcObject =
            null;


        audioElement.remove();


        audioElement =
            null;

    }


    // --------------------------------
    // Reset state
    // --------------------------------

    currentAssistantText =
        "";

    responseInProgress =
        false;

    isSpeaking =
        false;


    // --------------------------------
    // Update UI
    // --------------------------------

    status.innerText =
        "Disconnected";


    startBtn.disabled =
        false;


    addMessage(
        "ai",
        "Disconnected from Manoj."
    );

}
// ========================================
// FINAL CLEANUP
// ========================================

// Make sure any remaining Manoj audio is stopped
window.addEventListener(
    "beforeunload",
    function () {

        try {

            stopManojAudio();

        } catch (error) {

            console.log(
                "Cleanup warning:",
                error
            );

        }

    }
);


// ========================================
// INITIAL UI STATE
// ========================================

if (status) {

    status.innerText =
        "Disconnected";

}


if (startBtn) {

    startBtn.disabled =
        false;

}


console.log(
    "âœ… Manoj voice client loaded"
);

console.log(
    "ðŸ›¡ï¸ Duplicate-response protection: ENABLED"
);

console.log(
    "ðŸ›‘ Voice interruption handling: ENABLED"
);

console.log(
    "ðŸŽ¤ Echo cancellation: ENABLED"
);

console.log(
    "ðŸ”Š ElevenLabs Manoj voice: ENABLED"
);










