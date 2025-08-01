import fs from 'fs';
import path from 'path';
import { fileURLToPath } from "url";
import readline from 'readline';
import { google } from "googleapis";
import OpenAI from "openai";
import 'dotenv/config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const tmpDir = path.join(__dirname, "tmp");

if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
}

const SCOPES = ["https://www.googleapis.com/auth/gmail.modify"];
const TOKEN_PATH = path.join(__dirname, "token.json");

const openai = new OpenAI({
    apiKey: process.env.OPEN_AI_KEY
});

const credentials = JSON.parse(process.env.GMAIL_CREDENTIALS_JSON);
authorize(credentials);

function authorize(credentials) {
    const { client_secret, client_id } = credentials.installed;
    const oAuth2Client = new google.auth.OAuth2(
        client_id,
        client_secret,
        "urn:ietf:wg:oauth:2.0:oob"
    );

    // Check for existing token
    const token = JSON.parse(process.env.GMAIL_TOKEN_JSON);
    oAuth2Client.setCredentials(token);
    startPolling(oAuth2Client);
    return;

    // const authUrl = oAuth2Client.generateAuthUrl({ access_type: "offline", scope: SCOPES });
    // console.log("Authorize this app by visiting this url:", authUrl);

    // const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    // rl.question("Enter the code from that page here: ", (code) => {
    //     rl.close();
    //     oAuth2Client.getToken(code, (err, token) => {
    //         if (err) return console.error("Error retrieving token", err);
    //         oAuth2Client.setCredentials(token);
    //         fs.writeFileSync(TOKEN_PATH, JSON.stringify(token));
    //         startPolling(oAuth2Client);
    //     });
    // });
}

function startPolling(auth) {
    // Check every 60 seconds (60000 ms)
    setInterval(() => {
        checkGmail(auth);
    }, 60000);
}

const emailTarget = "9176278846@vtext.com";


function checkGmail(auth) {
    console.log("Checking Gmail for unread messages...");
    const gmail = google.gmail({ version: "v1", auth });

    gmail.users.messages.list({
        userId: "me",
        q: "is:unread",
    }, async (err, res) => {
        if (err) return console.log("API error:", err);

        const messages = res.data.messages || [];
        if (!messages.length) {
            console.log("No unread messages.");
            return;
        }

        for (let i = 0; i < messages.length; i++) {
            if (i >= 10) break; // Limit to first 10 unread messages
            const msg = messages[i];
            const msgData = await gmail.users.messages.get({ userId: "me", id: msg.id });
            const headers = msgData.data.payload.headers;
            const fromHeader = headers.find(h => h.name === "From");

            if (!fromHeader) continue;

            const senderEmailMatch = fromHeader.value.match(/<(.+)>/);
            const senderEmail = senderEmailMatch ? senderEmailMatch[1] : fromHeader.value;

            // Only reply if sender matches your target email
            if (senderEmail.toLowerCase() === emailTarget.toLowerCase()) {
                console.log(`found message from ${senderEmail}, replying...`);

                const question = msgData.data.snippet; // or extract full message body if you want
                if (!msgData.data.snippet.startsWith("AI")) return;

                const aiReply = await getAIResponse(question, senderEmail);

                // Get original subject or use a default
                const subjectHeader = headers.find(h => h.name === "Subject");
                const subject = subjectHeader ? subjectHeader.value : "No Subject";

                // Prepare raw email message
                const replyTo = "9176278846@vzwpix.com";
                const rawMessage = makeReplyMessage(replyTo, subject, aiReply, msgData.data.threadId);

                // Send the reply
                await gmail.users.messages.send({
                    userId: "me",
                    requestBody: {
                        raw: rawMessage,
                        threadId: msgData.data.threadId,
                    }
                });

                // Mark message as read
                await gmail.users.messages.modify({
                    userId: "me",
                    id: msg.id,
                    requestBody: { removeLabelIds: ["UNREAD"] },
                });

                console.log(`Replied and marked message ${msg.id} as read.`);
            } else {
                console.log(`Skipping message from ${senderEmail}`);
            }
        }
    });
}

function makeReplyMessage(to, subject, message, threadId) {
    const emailLines = [
        `To: ${to}`,
        'Content-Type: text/plain; charset="UTF-8"',
        'MIME-Version: 1.0',
        `Subject: Re: ${subject}`,
        `In-Reply-To: ${threadId}`,
        `References: ${threadId}`,
        '',
        message,
    ];
    const email = emailLines.join('\n');

    // Base64 encode in URL-safe format
    return Buffer.from(email)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}

async function getAIResponse(newUserMessage, email) {
    if (!newUserMessage || typeof newUserMessage !== 'string' || !newUserMessage.trim()) {
        console.error("Empty or invalid user message.", newUserMessage);
        return "Sorry, I didn't catch that.";
    }
    const historyFilePath = './tmp/conversationStore.json';

    if (!fs.existsSync(historyFilePath) || fs.readFileSync(historyFilePath, 'utf8').trim() === '') {
        fs.writeFileSync(historyFilePath, '{}');
    }
    const history = getHistory(email);

    // Add new user message
    history.push({ role: "user", content: newUserMessage });

    const res = await openai.chat.completions.create({
        model: "gpt-4",
        messages: history,
    });

    const reply = res.choices[0].message.content;

    // Save AI reply
    saveMessage(email, "user", newUserMessage);
    saveMessage(email, "assistant", reply);

    return reply;
}

function getHistory(email) {
    const raw = fs.readFileSync('./tmp/conversationStore.json', 'utf8');
    let data;
    try {
        data = JSON.parse(raw);
    } catch (err) {
        console.error("Failed to parse conversationStore.json:", err);
        return [];
    }

    const history = data[email] || [];

    // Filter out any invalid messages
    return history.filter(
        m => m && typeof m.content === 'string' && m.content.trim() !== ''
    );
}

function saveMessage(email, role, content) {
    const data = JSON.parse(fs.readFileSync('./tmp/conversationStore.json', 'utf8'));
    if (!data[email]) data[email] = [];
    data[email].push({ role, content });
    fs.writeFileSync('./tmp/conversationStore.json', JSON.stringify(data, null, 2));
}