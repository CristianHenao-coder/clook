const express = require('express');
const path = require('path');
const dotenv = require('dotenv');
const morgan = require('morgan');
const fs = require('fs');
const axios = require('axios');

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;
console.log(`Using port: ${port}`);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(morgan('dev'));
app.use(express.static('gif'));

// ---------------------------
// Rate Limiter
// ---------------------------
const requestTimes = {};
const MAX_REQUESTS = 10;
const TIME_WINDOW = 60000;

function rateLimiter(req, res, next) {
    const ip = req.ip;
    const now = Date.now();

    if (!requestTimes[ip]) {
        requestTimes[ip] = [];
    }

    requestTimes[ip] = requestTimes[ip].filter(time => now - time < TIME_WINDOW);

    if (requestTimes[ip].length >= MAX_REQUESTS) {
        return res.status(429).send('Too Many Requests');
    }

    requestTimes[ip].push(now);
    next();
}
app.use(rateLimiter);

// ---------------------------
// Bot + Search Engine Detection
// ---------------------------
function isSearchEngine(userAgent) {
    const searchEngines = [
        'googlebot', 'bingbot', 'slurp', 'duckduckbot', 'baiduspider',
        'yandexbot', 'sogou', 'exabot', 'facebot', 'applebot',
        'facebookexternalhit', 'twitterbot', 'linkedinbot', 'embedly',
        'quora link preview', 'showyoubot', 'outbrain', 'pinterest',
        'vkshare', 'w3c_validator'
    ];
    const ua = userAgent.toLowerCase();
    return searchEngines.some(bot => ua.includes(bot));
}

async function isBot(ip) {
    try {
        const responses = await Promise.all([
            axios.get(`https://api.seon.io/v1/check-bot?ip=${ip}`)
        ]);
        return responses.some(response => response.data.isBot);
    } catch (error) {
        console.error('Error checking bot:', error);
        return false;
    }
}

// ---------------------------
// TikTok Browser Detection
// ---------------------------
function isTikTokInAppBrowser(userAgent) {
    const ua = userAgent?.toLowerCase() || '';
    return ua.includes('tiktok') || ua.includes('musically');
}

// ---------------------------
// Routes
// ---------------------------

app.get('/', (req, res) => {
    res.redirect('/instructions');
});

app.get('/instructions', (req, res) => {
    const userAgent = req.headers['user-agent'] || '';

    if (isTikTokInAppBrowser(userAgent)) {
        console.log("User is inside TikTok's internal browser");
        return res.render('instructions');
    }

    console.log("User opened link in a real browser → redirecting to /loading");
    return res.redirect('/loading');
});

app.get('/loading', async (req, res) => {
    const userAgent = req.headers['user-agent'];
    const ip = req.ip;

    console.log('User-Agent:', userAgent);
    console.log('IP:', ip);
    console.log('Is search engine:', isSearchEngine(userAgent));

    const isBotDetected = await isBot(ip);

    if (isSearchEngine(userAgent) || isBotDetected) {
        console.log('Detected search engine bot or bot IP');
        res.render('searchEngine');
    } else {
        console.log('Detected regular user');
        res.render('loading');
    }
});

// ---------------------------
// GIF Static File Handling
// ---------------------------
app.use((req, res, next) => {
    if (req.method === 'GET' && req.url.startsWith('/gif/')) {
        const filePath = path.join(__dirname, 'gif', req.url.split('/').pop());
        if (fs.existsSync(filePath)) {
            res.sendFile(filePath);
        } else {
            res.status(404).send('File not found');
        }
    } else {
        next();
    }
});

// ---------------------------
// /redirect (mobile logic)
// ---------------------------
app.get('/redirect', (req, res) => {
    const userAgent = req.headers['user-agent'];

    const isMobile = /Mobi|Android/i.test(userAgent);

    if (isMobile) {
        return res.redirect('/instructions');
    }

    return res.redirect('https://onlyfans.com/perfil');
});

// ---------------------------
// Start server
// ---------------------------
app.listen(port, '0.0.0.0', () => {
    console.log(`Servidor corriendo en port ${port}`);
});
