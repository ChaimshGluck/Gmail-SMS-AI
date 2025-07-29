import express from "express";
import "./gmail.js"; // runs your background polling logic

const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (_, res) => {
    res.send("Gmail AI Bot is running.");
});

app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});