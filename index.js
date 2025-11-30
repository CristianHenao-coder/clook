const express = require('express');
const path = require('path');
const dotenv = require('dotenv');
const morgan = require('morgan');
const fs = require('fs');
const cookieParser = require('cookie-parser');

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;
console.log(`Using port: \${port}`);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(morgan('dev'));
app.use(express.static('gif'));
app.use(cookieParser());

// -------------------------------------------
// Render / proxies → usar la IP real del cliente
// -------------------------------------------
app.set('trust proxy', true);

function getRealIp(req) {
    const fwd = req.headers['x-forwarded-for'];
    if (fwd) return fwd.split(',')[0].trim();
    return req.ip;
}

// -------------------------------------------
// Rate Limiter
// -------------------------------------------
const requestTimes = {};
const MAX_REQUESTS = 10;
const TIME_WINDOW = 60000;

function rateLimiter(req, res, next) {
    const ip = getRealIp(req);
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

// -------------------------------------------
// Bot + Search Engine Detection
// -------------------------------------------
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

function isTikTokInAppBrowser(userAgent) {
    const ua = userAgent?.toLowerCase() || '';
    return ua.includes('tiktok') || ua.includes('musically');
}

function isInstagramInAppBrowser(userAgent) {
    const ua = userAgent?.toLowerCase() || '';
    return (
        ua.includes('instagram') ||
        ua.includes('fban/instagram') ||
        ua.includes('fb_iab') ||
        ua.includes('fbav') // usado por IG y FB, pero en IG siempre aparece
    );
}

function isJavaScriptEnabled(req) {
    return req.headers['x-javascript-enabled'] === 'true';
}

function isCookiesEnabled(req) {
    return req.cookies ? true : false;
}

// -------------------------------------------
// Behavioral Analysis
// -------------------------------------------
const userActions = {};

function trackUserAction(ip, action) {
    if (!userActions[ip]) {
        userActions[ip] = [];
    }
    userActions[ip].push({ action, timestamp: Date.now() });
}

function isSuspiciousBehavior(ip) {
    if (!userActions[ip]) return false;
    const actions = userActions[ip];
    const now = Date.now();

    // Ejemplo de comportamiento sospechoso: más de 5 acciones en 10 segundos
    const recentActions = actions.filter(action => now - action.timestamp < 10000);
    return recentActions.length > 5;
}

// -------------------------------------------
// CAPTCHA Middleware
// -------------------------------------------
function captchaMiddleware(req, res, next) {
    const ip = getRealIp(req);
    if (isSuspiciousBehavior(ip)) {
        return res.render('captcha');
    }
    next();
}

app.use(captchaMiddleware);

function isMissingUserAgent(userAgent) {
    return !userAgent || userAgent.trim() === '';
}

function isSuspiciousUserAgent(userAgent) {
    if (!userAgent) return true;

    const ua = userAgent.toLowerCase();

    const suspiciousPatterns = [
        'python-requests',
        'axios/',
        'curl/',
        'wget',
        'node-fetch',
        'httpclient',
        'java/',
        'go-http',
        'scrapy',
        'spider',
        'bot',
        'crawler',
        'libwww',
        'unknown',
        'apache-httpclient'
    ];

    return suspiciousPatterns.some(p => ua.includes(p));
}


function honeypotMiddleware(req, res, next) {
    if (req.body && req.body.honeypot) {
        console.log('Honeypot triggered → bot');
        return res.render('searchEngine');
    }
    next();
}


app.use(express.urlencoded({ extended: true }));
app.use(honeypotMiddleware);



function isBot(req) {
    const ua = req.headers['user-agent'];
    const ip = getRealIp(req);

    if (isMissingUserAgent(ua)) return true;
    if (isSearchEngine(ua)) return true;
    if (isSuspiciousUserAgent(ua)) return true;
    if (isSuspiciousBehavior(ip)) return true;

    return false;
}


// -------------------------------------------
// Routes
// -------------------------------------------

app.get('/', (req, res) => {
    return res.redirect('/instructions');
});

app.get('/instructions', (req, res) => {
    const ip = getRealIp(req);
    trackUserAction(ip, 'visit_instructions');

    const ua = req.headers['user-agent'] || '';

    console.log('User-Agent:', ua);
    console.log('Real IP:', ip);

    // 1. Bot check
    if (isBot(req)) {
        console.log('[INSTRUCTIONS] Detected bot -> render searchEngine');
        return res.render('searchEngine'); // asegúrate de tener views/searchEngine.ejs
    }

    // 2. Mobile vs Desktop
    const isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(ua);

    if (isMobile) {
        console.log('[INSTRUCTIONS] Mobile -> render instructions');
        return res.render('instructions'); // asegúrate de tener views/instructions.ejs
    } else {
        console.log('[INSTRUCTIONS] Desktop -> redirect to OnlyFans');
        return res.redirect('https://onlyfans.com/perfil');
    }
});






app.get('/loading', (req, res) => {
    const ip = getRealIp(req);
    trackUserAction(ip, 'visit_loading');
    if (isBot(req)) {
        return res.render('searchEngine');
        
    }
    return res.render('loading');
});


// -------------------------------------------
// GIF Static File Handling
// -------------------------------------------
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

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
