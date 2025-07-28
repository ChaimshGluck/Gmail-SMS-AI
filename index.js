import express from 'express';
const app = express();

app.get('/', async (req, res) => {
    const code = req.query.code;
    // Exchange code for token here...
    res.send('Authorization successful! You may close this window.');
});

app.listen(3000, () => {
    console.log('Listening on http://localhost:3000');
});