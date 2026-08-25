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

// Current ElevenLabs audio
let currentManojAudio = null;

// Current object URL
let currentAudioUrl = null;


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


    // Invalidate any previous TTS request
    ttsGeneration++;


    if (
        currentManojAudio
    ) {

        try {

            currentManojAudio.pause();

            currentManojAudio.currentTime =
                0;

        } catch (error) {

            console.log(
                "Audio stop warning:",
                error
            );

        }


        currentManojAudio =
            null;

    }


    if (
        currentAudioUrl
    ) {

        try {

            URL.revokeObjectURL(
                currentAudioUrl
            );

        } catch (error) {

            console.log(
                error
            );

        }


        currentAudioUrl =
            null;

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
            "🛑 OpenAI response cancelled"
        );


    } catch (error) {

        console.error(
            "❌ Could not cancel OpenAI response:",
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


    // ========================================
    // STOP ANY PREVIOUS AUDIO
    // ========================================

    stopManojAudio();


    // Create a unique generation ID
    const myGeneration =
        ++ttsGeneration;


    try {

        isSpeaking =
            true;


        console.log(
            "🎙️ Sending text to ElevenLabs:",
            text
        );


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


        // ========================================
        // CHECK WHETHER THIS IS STILL THE
        // ACTIVE TTS REQUEST
        // ========================================

        if (
            myGeneration !==
            ttsGeneration
        ) {

            console.log(
                "🗑️ Ignoring old TTS response"
            );

            return;

        }


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


        const audioBlob =
            await response.blob();


        // ========================================
        // CHECK AGAIN AFTER DOWNLOAD
        // ========================================

        if (
            myGeneration !==
            ttsGeneration
        ) {

            console.log(
                "🗑️ Ignoring stale ElevenLabs audio"
            );

            return;

        }


        currentAudioUrl =
            URL.createObjectURL(
                audioBlob
            );


        const audio =
            new Audio(
                currentAudioUrl
            );


        currentManojAudio =
            audio;


        audio.volume =
            1.0;


        audio.onended =
            function () {

                if (
                    currentManojAudio ===
                    audio
                ) {

                    currentManojAudio =
                        null;

                }


                if (
                    currentAudioUrl
                ) {

                    URL.revokeObjectURL(
                        currentAudioUrl
                    );

                    currentAudioUrl =
                        null;

                }


                isSpeaking =
                    false;


                console.log(
                    "✅ Manoj audio finished"
                );

            };


        audio.onerror =
            function () {

                console.error(
                    "❌ Manoj audio playback error"
                );


                if (
                    currentManojAudio ===
                    audio
                ) {

                    currentManojAudio =
                        null;

                }


                if (
                    currentAudioUrl
                ) {

                    URL.revokeObjectURL(
                        currentAudioUrl
                    );

                    currentAudioUrl =
                        null;

                }


                isSpeaking =
                    false;

            };


        console.log(
            "🔊 Playing Manoj voice"
        );


        await audio.play();


    } catch (error) {

        console.error(
            "❌ Manoj voice playback failed:",
            error
        );


        isSpeaking =
            false;

    }

}


// ========================================
// KNOWLEDGE LOOKUP
// ========================================

async function handleKnowledgeLookup(
    toolCallId,
    argumentsJson
) {

    try {

        console.log(
            "🔎 Knowledge lookup requested:",
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
                "❌ Failed to parse tool arguments:",
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
                "❌ Knowledge lookup query missing"
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
            "📚 Knowledge result:",
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
                "❌ Data channel is not open"
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
            "📤 Knowledge result sent to OpenAI"
        );


        dataChannel.send(
            JSON.stringify({

                type:
                    "response.create"

            })
        );


    } catch (error) {

        console.error(
            "❌ Knowledge lookup error:",
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
                "🎤 Microphone access granted"
            );


            // ========================================
            // 2. CREATE WEBRTC CONNECTION
            // ========================================

            peerConnection =
                new RTCPeerConnection();


            console.log(
                "🔗 RTCPeerConnection created"
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
                "🎤 Microphone track added"
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
                        "🔇 OpenAI audio received — not playing"
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
                        "📡 OpenAI data channel connected"
                    );


                    status.innerText =
                        "Connected ✅";


                    addMessage(
                        "ai",
                        "Connected to Manoj. You can speak now."
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
                            "📩 OpenAI Event:",
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
                                "❌ OpenAI error:",
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
                                "🎤 User started speaking"
                            );


                            if (
                                isSpeaking
                            ) {

                                console.log(
                                    "🛑 User interrupted Manoj"
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
                                "🧠 OpenAI response started"
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


                            currentAssistantText +=
                                data.delta || "";


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
                                    "🛑 Ignoring duplicate text completion"
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
                                "📝 OpenAI final response:",
                                finalText
                            );


                            addMessage(
                                "ai",
                                finalText
                            );


                            await speakWithManoj(
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
                                "🔎 Knowledge tool call received"
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
                            "❌ Data channel error:",
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
                            "Connected ✅";

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
                "📤 SDP offer created"
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
                "📥 OpenAI SDP answer received"
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
                "✅ Remote description set"
            );


            status.innerText =
                "Connected ✅";


        } catch (error) {

            console.error(
                "❌ Voice connection error:",
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
        "🔴 Disconnecting..."
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
    "✅ Manoj voice client loaded"
);

console.log(
    "🛡️ Duplicate-response protection: ENABLED"
);

console.log(
    "🛑 Voice interruption handling: ENABLED"
);

console.log(
    "🎤 Echo cancellation: ENABLED"
);

console.log(
    "🔊 ElevenLabs Manoj voice: ENABLED"
);