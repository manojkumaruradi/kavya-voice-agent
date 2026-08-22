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


// ========================================
// ADD MESSAGE TO SCREEN
// ========================================

function addMessage(
    sender,
    text
) {

    const div =
        document.createElement("div");

    div.className =
        `message ${sender}`;

    div.innerHTML =
        `<strong>${sender.toUpperCase()}:</strong><br>${text}`;

    messages.appendChild(div);

    messages.scrollTop =
        messages.scrollHeight;

}


// ========================================
// KNOWLEDGE LOOKUP
// ========================================
//
// When OpenAI asks for information from
// the iLEAD knowledge base, this function
// searches our server-side KB and sends
// only the relevant information back.
//
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


        // ========================================
        // ASK OUR SERVER FOR RELEVANT KB CONTENT
        // ========================================

        const response =
            await fetch(
                "/knowledge-search",
                {

                    method: "POST",

                    headers: {

                        "Content-Type":
                            "application/json"

                    },

                    body:
                        JSON.stringify({
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


        // ========================================
        // SEND TOOL RESULT BACK TO OPENAI
        // ========================================

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


        // ========================================
        // ASK OPENAI TO CONTINUE RESPONSE
        // ========================================

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
                            "The requested information could not be retrieved right now. Please guide the user toward speaking with the admissions team for confirmation."

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
                        audio: true
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
                localStream.getAudioTracks()[0];


            peerConnection.addTrack(
                audioTrack,
                localStream
            );


            console.log(
                "🎤 Microphone track added"
            );


            // ========================================
            // 4. RECEIVE KAVYA AUDIO
            // ========================================

            audioElement =
                document.createElement(
                    "audio"
                );

            audioElement.autoplay =
                true;

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
                        "🔊 Kavya audio received"
                    );

                    audioElement.srcObject =
                        event.streams[0];

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
                        "Connected to Kavya. You can speak now."
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


                        // --------------------------------
                        // ERROR
                        // --------------------------------

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


                        // --------------------------------
                        // USER TRANSCRIPT
                        // --------------------------------

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

                        }


                        // --------------------------------
                        // AI TEXT
                        // --------------------------------

                        if (
                            data.type ===
                            "response.output_text.done"
                        ) {

                            if (
                                data.text
                            ) {

                                addMessage(
                                    "ai",
                                    data.text
                                );

                            }

                        }


                        // --------------------------------
                        // KNOWLEDGE TOOL CALL
                        // --------------------------------

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

                        }

                    } catch (error) {

                        console.error(
                            "Data channel error:",
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
            // 8. SEND RAW SDP TO OUR SERVER
            // ========================================

            status.innerText =
                "Connecting to Kavya...";


            const response =
                await fetch(
                    "/session",
                    {

                        method: "POST",

                        headers: {

                            "Content-Type":
                                "application/sdp"

                        },

                        body:
                            offer.sdp

                    }
                );


            // ========================================
            // 9. CHECK SERVER RESPONSE
            // ========================================

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
            // 10. RECEIVE OPENAI SDP ANSWER
            // ========================================

            const answerSdp =
                await response.text();


            console.log(
                "📥 OpenAI SDP answer received"
            );


            // ========================================
            // 11. SET REMOTE DESCRIPTION
            // ========================================

            await peerConnection.setRemoteDescription(
                {

                    type: "answer",

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
    // Close data channel
    // --------------------------------

    if (
        dataChannel
    ) {

        try {

            dataChannel.close();

        } catch (error) {

            console.log(error);

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

            console.log(error);

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


    status.innerText =
        "Disconnected";


    startBtn.disabled =
        false;


    addMessage(
        "ai",
        "Disconnected from Kavya."
    );

}