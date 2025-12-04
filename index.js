const express = require('express');
const path = require('path');
const dotenv = require('dotenv');
const morgan = require('morgan');
const fs = require('fs');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;
console.log(`Using port: ${port}`);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(morgan('dev'));
app.use('/clook/gif', express.static(path.join(__dirname, 'gif')));
app.use(cookieParser());
app.use(express.urlencoded({ extended: true }));

// -------------------------------------------
// Utils
// -------------------------------------------
app.set('trust proxy', true);

function getRealIp(req) {
    const fwd = req.headers['x-forwarded-for'];
    if (fwd) return fwd.split(',')[0].trim();
    return req.ip;
}

function getLinks() {
    const data = fs.readFileSync(path.join(__dirname, 'links.json'), 'utf-8');
    return JSON.parse(data);
}

// -------------------------------------------
// Session ID Middleware
// -------------------------------------------
app.use((req, res, next) => {
    if (!req.cookies.sessionId) {
        const sessionId = crypto.randomBytes(16).toString('hex');
        res.cookie('sessionId', sessionId, { httpOnly: true });
        req.sessionId = sessionId;
    } else {
        req.sessionId = req.cookies.sessionId;
    }
    next();
});

// -------------------------------------------
// Rate Limiter (IP + Session)
// -------------------------------------------
const requestTimes = {};
const MAX_REQUESTS = 50;
const TIME_WINDOW = 60000;

function rateLimiter(req, res, next) {
    const ip = getRealIp(req);
    const sessionId = req.sessionId;
    const key = `${ip}_${sessionId}`;
    const now = Date.now();

    if (!requestTimes[key]) requestTimes[key] = [];
    requestTimes[key] = requestTimes[key].filter(t => now - t < TIME_WINDOW);

    if (requestTimes[key].length >= MAX_REQUESTS) {
        return res.status(429).send('Too Many Requests');
    }

    requestTimes[key].push(now);
    next();
}
app.use(rateLimiter);

// -------------------------------------------
// Bot / UA Detection
// -------------------------------------------
function isSearchEngine(userAgent) {
    const searchEngines = [
        'googlebot', 'bingbot', 'slurp', 'duckduckbot', 'baiduspider',
        'yandexbot', 'sogou', 'exabot', 'facebot', 'applebot',
        'facebookexternalhit', 'twitterbot', 'linkedinbot', 'embedly',
        'quora link preview', 'showyoubot', 'outbrain', 'pinterest',
        'vkshare', 'w3c_validator'
    ];
    const ua = (userAgent || '').toLowerCase();
    return searchEngines.some(bot => ua.includes(bot));
}

function isTikTokInAppBrowser(userAgent) {
    const ua = (userAgent || '').toLowerCase();
    return ua.includes('tiktok') || ua.includes('musically');
}

function isInstagramInAppBrowser(userAgent) {
    const ua = (userAgent || '').toLowerCase();
    const patterns = [
        'instagram', 'fban/instagram', 'fb_iab', 'fbav',
        'instagramapp', 'instagram 3', 'version/0'
    ];
    return patterns.some(p => ua.includes(p));
}

function isJavaScriptEnabled(req) {
    return req.headers['x-javascript-enabled'] === 'true';
}

function isCookiesEnabled(req) {
    return req.cookies ? true : false;
}

function isMissingUserAgent(userAgent) {
    return !userAgent || userAgent.trim() === '';
}

function isSuspiciousUserAgent(userAgent) {
    if (!userAgent) return true;
    const ua = userAgent.toLowerCase();
    const suspiciousPatterns = [
        'python-requests', 'axios/', 'curl/', 'wget', 'node-fetch',
        'httpclient', 'java/', 'go-http', 'scrapy', 'spider', 'bot',
        'crawler', 'libwww', 'unknown', 'apache-httpclient'
    ];
    return suspiciousPatterns.some(p => ua.includes(p));
}

// -------------------------------------------
// Behavioral Analysis
// -------------------------------------------
const userActions = {};

function trackUserAction(ip, action) {
    if (!userActions[ip]) userActions[ip] = [];
    userActions[ip].push({ action, timestamp: Date.now() });
}

function isSuspiciousBehavior(ip) {
    if (!userActions[ip]) return false;
    const actions = userActions[ip];
    const recentActions = actions.filter(action => Date.now() - action.timestamp < 10000);
    return recentActions.length > 5;
}

// -------------------------------------------
// CAPTCHA Middleware
// -------------------------------------------
function captchaMiddleware(req, res, next) {
    const ip = getRealIp(req);
    if (isSuspiciousBehavior(ip)) return res.render('captcha');
    next();
}
app.use(captchaMiddleware);

// -------------------------------------------
// Honeypot Middleware
// -------------------------------------------
function honeypotMiddleware(req, res, next) {
    if (req.body && req.body.honeypot) {
        console.log('Honeypot triggered → bot');
        return res.render('searchEngine', { id: 'bot', model: {} });
    }
    next();
}
app.use(honeypotMiddleware);

// -------------------------------------------
// Bot Check
// -------------------------------------------
function isBot(req) {
    const ua = req.headers['user-agent'];
    const ip = getRealIp(req);
    return (
        isMissingUserAgent(ua) ||
        isSearchEngine(ua) ||
        isSuspiciousUserAgent(ua) ||
        isSuspiciousBehavior(ip)
    );
}

// -------------------------------------------
// Routes
// -------------------------------------------
app.get("/", (req, res) => {
    const links = getLinks();
    const defaultId = Object.keys(links)[0] || "default";
    return res.redirect(`/instructions/${defaultId}`);
});

app.get("/c/:id", (req, res) => {
    const links = getLinks();
    const id = req.params.id;
    if (!links[id]) return res.status(404).send("Invalid link");
    return res.redirect(`/instructions/${id}`);
});

app.get('/instructions/:id', (req, res) => {
    const links = getLinks();
    const id = req.params.id;
    const model = links[id];
    if (!model) return res.status(404).send("Invalid link");

    const ip = getRealIp(req);
    trackUserAction(ip, 'visit_instructions');

    const ua = req.headers['user-agent'] || '';
    const isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(ua);

    if ((isTikTokInAppBrowser(ua) || isInstagramInAppBrowser(ua)) && isMobile) {
        return res.render('instructions', { id });
    }

    return res.redirect(`/searchEngine/${id}`);
});

app.get('/searchEngine/:id', (req, res) => {
    const links = getLinks();
    const id = req.params.id;
    const model = links[id];
    if (!model) return res.status(404).send("Invalid link");

    const ip = getRealIp(req);
    trackUserAction(ip, 'visit_searchEngine');

    return res.render('searchEngine', { id, model });
});

app.get('/loading/:id', (req, res) => {
    const links = getLinks();
    const id = req.params.id;
    const model = links[id];
    if (!model) return res.status(404).send("Invalid link");

    const ip = getRealIp(req);
    trackUserAction(ip, 'visit_loading');

    const ua = req.headers['user-agent'] || '';
    if (isBot(req) || isTikTokInAppBrowser(ua) || isInstagramInAppBrowser(ua)) {
        return res.redirect('https://instagram.com/tu_perfil');
    }

    return res.render('loading', { id });
});

app.get('/secret/:id', (req, res) => {
    const links = getLinks();
    const id = req.params.id;
    const model = links[id];
    if (!model) return res.status(404).send("Invalid link");

    const ip = getRealIp(req);
    trackUserAction(ip, 'visit_secret');

    const ua = req.headers['user-agent'] || '';
    if (isBot(req) || isTikTokInAppBrowser(ua) || isInstagramInAppBrowser(ua)) {
        return res.redirect('https://instagram.com/tu_perfil');
    }

    return res.redirect(model.onlyfans);
});

// -------------------------------------------
app.listen(port, () => console.log(`Server running on port ${port}`));
