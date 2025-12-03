const express = require('express');
const path = require('path');
const dotenv = require('dotenv');
const morgan = require('morgan');
const fs = require('fs');
const cookieParser = require('cookie-parser');
const crypto = require('crypto'); // <- para generar sessionId

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
// Render / proxies → usar la IP real del cliente
// -------------------------------------------
app.set('trust proxy', true);

function getRealIp(req) {
    const fwd = req.headers['x-forwarded-for'];
    if (fwd) return fwd.split(',')[0].trim();
    return req.ip;
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
// Rate Limiter Inteligente (IP + session)
// -------------------------------------------
const requestTimes = {};
const MAX_REQUESTS = 50;
const TIME_WINDOW = 60000;

function rateLimiter(req, res, next) {
    const ip = getRealIp(req);
    const sessionId = req.sessionId;
    const key = `${ip}_${sessionId}`;
    const now = Date.now();

    if (!requestTimes[key]) {
        requestTimes[key] = [];
    }

    requestTimes[key] = requestTimes[key].filter(time => now - time < TIME_WINDOW);

    if (requestTimes[key].length >= MAX_REQUESTS) {
        return res.status(429).send('Too Many Requests');
    }

    requestTimes[key].push(now);
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
        'instagram 3',
        'version/0'
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
        'python-requests', 'axios/', 'curl/', 'wget', 'node-fetch',
        'httpclient', 'java/', 'go-http', 'scrapy', 'spider', 'bot',
        'crawler', 'libwww', 'unknown', 'apache-httpclient'
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

// Todos llegan a /instructions
app.get('/', (req, res) => {
    return res.redirect('/instructions');
});

// -------------------------------------------
// /instructions
// -------------------------------------------
// Aquí NO bloqueas bots. Todos pueden ver esta página.
// Solo rediriges según móvil/PC, In-App browsers, etc.
app.get('/instructions', (req, res) => {
    const ip = getRealIp(req);
    trackUserAction(ip, 'visit_instructions');

    const ua = req.headers['user-agent'] || '';
    const isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(ua);

    const fromTikTok = isTikTokInAppBrowser(ua);
    const fromInstagram = isInstagramInAppBrowser(ua);

    // 1. TikTok / Instagram in-app browser EN MÓVIL → mostrar instructions
    if ((fromTikTok || fromInstagram) && isMobile) {
        return res.render('instructions');
    }

    // 2. TikTok / Instagram in-app pero EN PC → pasan directo
    if ((fromTikTok || fromInstagram) && !isMobile) {
        return res.redirect('/searchEngine');
    }

    // 3. Usuarios normales (móvil y PC) → searchEngine
    return res.redirect('/searchEngine');
});


// -------------------------------------------
// /searchEngine (landing con botones)
// -------------------------------------------
// A esta página llegan quienes siguieron las instrucciones
// NO se bloquea nada aquí. Es pública.
app.get('/searchEngine', (req, res) => {
    const ip = getRealIp(req);
    trackUserAction(ip, 'visit_searchEngine');

    return res.render('searchEngine');
});

// -------------------------------------------
// /loading (CLOAKING FINAL)
// -------------------------------------------
// Aquí SÍ se aplica detección completa.
// Si es bot → redirigir a Instagram/TikTok
// Si es humano → dejar pasar a /secret
// -------------------------------------------
app.get('/loading', (req, res) => {
    const ip = getRealIp(req);
    const ua = req.headers['user-agent'] || '';

    trackUserAction(ip, 'visit_loading');

    // Bot detection REAL
    if (isBot(req) || isTikTokInAppBrowser(ua) || isInstagramInAppBrowser(ua)) {
        return res.redirect('https://instagram.com/tu_perfil');
    }

    // Si pasa todo → carga animación
    return res.render('loading');
});

// -------------------------------------------
// Página secreta final
// -------------------------------------------
app.get('/secret', (req, res) => {
    const ip = getRealIp(req);
    trackUserAction(ip, 'visit_secret');

    const ua = req.headers['user-agent'] || '';

    // Segunda verificación máxima
    if (isBot(req) || isTikTokInAppBrowser(ua) || isInstagramInAppBrowser(ua)) {
        // Bot, crawler, o in-app browser → fuera
        return res.redirect('https://instagram.com/tu_perfil');
    }

    // Humano real y navegador real → acceso al OnlyFans
    return res.redirect('https://onlyfans.com/tu_link_secreto');
});



app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});