const startBtn = document.getElementById("startBtn");
const disconnectBtn = document.getElementById("disconnectBtn");
const status = document.getElementById("status");
const messages = document.getElementById("messages");

let peerConnection = null;
let dataChannel = null;
let localStream = null;
let audioElement = null;


// ========================================
// MESSAGE DISPLAY
// ========================================

function addMessage(sender, text) {

    const div = document.createElement("div");

    div.className = `message ${sender}`;

    div.innerHTML =
        `<strong>${sender.toUpperCase()}:</strong><br>${text}`;

    messages.appendChild(div);

    messages.scrollTop = messages.scrollHeight;
}


// ========================================
// START CONVERSATION
// ========================================

startBtn.onclick = async () => {

    try {

        startBtn.disabled = true;

        status.innerText = "Requesting microphone...";

        addMessage(
            "ai",
            "Requesting microphone access..."
        );


        // ========================================
        // 1. GET MICROPHONE
        // ========================================

        localStream =
            await navigator.mediaDevices.getUserMedia({
                audio: true
            });

        console.log("🎤 Microphone access granted");


        // ========================================
        // 2. CREATE PEER CONNECTION
        // ========================================

        peerConnection =
            new RTCPeerConnection();

        console.log(
            "🔗 RTCPeerConnection created"
        );


        // ========================================
        // 3. ADD MICROPHONE TRACK
        // ========================================

        localStream
            .getTracks()
            .forEach((track) => {

                peerConnection.addTrack(
                    track,
                    localStream
                );

            });

        console.log(
            "🎤 Microphone track added"
        );


        // ========================================
        // 4. RECEIVE AI AUDIO
        // ========================================

        audioElement =
            document.createElement("audio");

        audioElement.autoplay = true;

        audioElement.style.display = "none";

        document.body.appendChild(
            audioElement
        );


        peerConnection.ontrack = (event) => {

            console.log(
                "🔊 AI audio track received"
            );

            audioElement.srcObject =
                event.streams[0];

        };


        // ========================================
        // 5. CREATE DATA CHANNEL
        // ========================================

        dataChannel =
            peerConnection.createDataChannel(
                "oai-events"
            );

        console.log(
            "📡 Data channel created"
        );


        dataChannel.onopen = () => {

            console.log(
                "✅ Data channel connected"
            );

            addMessage(
                "ai",
                "Connected to Kavya. You can speak now."
            );

        };


        dataChannel.onmessage = (event) => {

            try {

                const data =
                    JSON.parse(event.data);

                console.log(
                    "📩 OpenAI Event:",
                    data
                );


                // AI response completed
                if (
                    data.type ===
                    "response.done"
                ) {

                    const output =
                        data.response?.output;

                    if (
                        output &&
                        output.length > 0
                    ) {

                        for (
                            const item of output
                        ) {

                            if (
                                item.type ===
                                "message"
                            ) {

                                const contents =
                                    item.content || [];

                                for (
                                    const content
                                    of contents
                                ) {

                                    if (
                                        content.type ===
                                        "output_text"
                                    ) {

                                        addMessage(
                                            "ai",
                                            content.text
                                        );

                                    }

                                }

                            }

                        }

                    }

                }


                // Error handling
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
                        "Sorry, something went wrong."
                    );

                }

            } catch (error) {

                console.error(
                    "Data channel error:",
                    error
                );

            }

        };


        // ========================================
        // 6. CREATE SDP OFFER
        // ========================================

        const offer =
            await peerConnection.createOffer();

        console.log(
            "📤 SDP offer created"
        );


        await peerConnection.setLocalDescription(
            offer
        );

        console.log(
            "📡 Local description set"
        );


        // ========================================
        // 7. SEND SDP TO OUR SERVER
        // ========================================

        status.innerText =
            "Connecting to Kavya...";

        const response =
            await fetch("/session", {

                method: "POST",

                headers: {
                    "Content-Type":
                        "application/json"
                },

                body: JSON.stringify({
                    sdp: offer.sdp
                })

            });


        if (!response.ok) {

            const errorText =
                await response.text();

            throw new Error(
                `Session request failed: ${errorText}`
            );

        }


        // ========================================
        // 8. RECEIVE OPENAI SDP ANSWER
        // ========================================

        const answerSdp =
            await response.text();

        console.log(
            "📥 OpenAI SDP answer received"
        );


        await peerConnection.setRemoteDescription(
            {
                type: "answer",
                sdp: answerSdp
            }
        );


        console.log(
            "✅ Remote description set"
        );


        // ========================================
        // 9. CONNECTION STATE
        // ========================================

        peerConnection.onconnectionstatechange =
            () => {

                console.log(
                    "Connection state:",
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


        status.innerText =
            "Connecting...";

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

        startBtn.disabled = false;

        disconnectConversation();

    }

};


// ========================================
// DISCONNECT
// ========================================

disconnectBtn.onclick = () => {

    disconnectConversation();

};


// ========================================
// DISCONNECT FUNCTION
// ========================================

function disconnectConversation() {

    console.log(
        "🔴 Disconnecting..."
    );


    // Close data channel
    if (dataChannel) {

        dataChannel.close();

        dataChannel = null;

    }


    // Close WebRTC connection
    if (peerConnection) {

        peerConnection.close();

        peerConnection = null;

    }


    // Stop microphone
    if (localStream) {

        localStream
            .getTracks()
            .forEach((track) => {

                track.stop();

            });

        localStream = null;

    }


    // Remove audio element
    if (audioElement) {

        audioElement.srcObject = null;

        audioElement.remove();

        audioElement = null;

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