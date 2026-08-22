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


            dataChannel.onmessage =
                function (event) {

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