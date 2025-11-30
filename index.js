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
const MAX_REQUESTS = 50;
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

    const patterns = [
        'instagram',
        'fban/instagram',
        'fb_iab',
        'fbav',
        'instagramapp',
        'instagram 3',        // v300+, v400+, etc.
        'version/0'           // usado por IG WebView en iOS
    ];

    return patterns.some(p => ua.includes(p));
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
    const isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(ua);

    // 1. Bot check
    if (isBot(req)) {
        return res.render('searchEngine');
    }

    // 2. TikTok **o Instagram** → instrucciones
    if (isTikTokInAppBrowser(ua) || isInstagramInAppBrowser(ua)) {
        return res.render('instructions');
    }

    // 3. Mobile real (no in-app) → loading
    if (isMobile) {
        return res.redirect('/loading');
    }

    // 4. Desktop
    return res.redirect('https://onlyfans.com/perfil');
});



app.get('/loading', (req, res) => {
    const ip = getRealIp(req);
    trackUserAction(ip, 'visit_loading');
    if (isBot(req)) {
        return res.render('searchEngine');
        
    }
    return res.render('loading');
});


app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
