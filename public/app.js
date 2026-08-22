const startBtn = document.getElementById("startBtn");
const status = document.getElementById("status");
const messages = document.getElementById("messages");
const disconnectBtn = document.getElementById("disconnectBtn");

let ws = null;
let mediaRecorder = null;

function addMessage(sender, text) {

    const div = document.createElement("div");

    div.className = `message ${sender}`;

    div.innerHTML = `<strong>${sender.toUpperCase()}:</strong><br>${text}`;

    messages.appendChild(div);

    messages.scrollTop = messages.scrollHeight;

}

startBtn.onclick = async () => {

    status.innerText = "Requesting microphone...";

    try {

        const stream = await navigator.mediaDevices.getUserMedia({
            audio: true
        });

        ws = new WebSocket(
            (location.protocol === "https:" ? "wss://" : "ws://") +
            location.host +
            "/media-stream"
        );

        ws.onopen = () => {

            status.innerText = "Connected ✅";

            addMessage("ai", "Connected to Kavya.");

            mediaRecorder = new MediaRecorder(stream, {
                mimeType: "audio/webm"
            });

            mediaRecorder.ondataavailable = (event) => {

                if (
                    event.data.size > 0 &&
                    ws.readyState === WebSocket.OPEN
                ) {

                    ws.send(event.data);

                }

            };

            mediaRecorder.start(250);

        };

        ws.onmessage = async (event) => {

            if (typeof event.data === "string") {

                addMessage("ai", event.data);

                return;

            }

            const audio = new Audio(
                URL.createObjectURL(event.data)
            );

            audio.play();

        };

        ws.onclose = () => {

            status.innerText = "Disconnected";

            addMessage("ai", "Connection closed.");

            if (mediaRecorder) {

                mediaRecorder.stop();

            }

        };

    } catch (err) {

        console.error(err);

        status.innerText = "Microphone permission denied.";

    }

};
disconnectBtn.onclick = () => {

    if (mediaRecorder && mediaRecorder.state !== "inactive") {

        mediaRecorder.stop();

    }

    if (ws && ws.readyState === WebSocket.OPEN) {

        ws.close();

    }

    status.innerText = "Disconnected";

    addMessage("ai", "Disconnected from Kavya.");

};