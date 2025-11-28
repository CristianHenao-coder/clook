const express = require('express');
const path = require('path');
const dotenv = require('dotenv');
const morgan = require('morgan');
const fs = require('fs');
const axios = require('axios');

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;
console.log(`Using port: \${port}`);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(morgan('dev'));
app.use(express.static('gif'));

// Middleware para rastrear la frecuencia de las solicitudes
const requestTimes = {};
const MAX_REQUESTS = 10;
const TIME_WINDOW = 60000; // 1 minuto

function isSearchEngine(userAgent) {
    const searchEngines = [
        'googlebot', 'bingbot', 'slurp', 'duckduckbot', 'baiduspider',
        'yandexbot', 'sogou', 'exabot', 'facebot', 'applebot',
        'facebookexternalhit', 'twitterbot', 'linkedinbot', 'embedly', 'quora link preview',
        'showyoubot', 'outbrain', 'pinterest', 'vkshare', 'w3c_validator',
        'whatsapp', 'telegrambot', 'tiktok', 'instagram'
    ];
    const userAgentLower = userAgent.toLowerCase();
    return searchEngines.some(bot => userAgentLower.includes(bot));
}

async function isBot(ip) {
    try {
        // Reemplaza estas URLs con las APIs de verificación de bots reales
        const responses = await Promise.all([
            axios.get(`https://api.seon.io/v1/check-bot?ip=\${ip}`),
            // axios.get(`https://api.imperva.com/check-bot?ip=\${ip}`) // Descomenta si tienes una API de Imperva funcional
        ]);
        return responses.some(response => response.data.isBot);
    } catch (error) {
        console.error('Error checking bot:', error);
        return false;
    }
}

function rateLimiter(req, res, next) {
    const ip = req.ip;
    const now = Date.now();

    if (!requestTimes[ip]) {
        requestTimes[ip] = [];
    }

    // Eliminar solicitudes antiguas
    requestTimes[ip] = requestTimes[ip].filter(time => now - time < TIME_WINDOW);

    if (requestTimes[ip].length >= MAX_REQUESTS) {
        return res.status(429).send('Too Many Requests');
    }

    requestTimes[ip].push(now);
    next();
}

app.use(rateLimiter);

app.get('/instructions', (req, res) => {
    res.render('instructions');
});

app.get('/loading', async (req, res) => {
    const userAgent = req.headers['user-agent'];
    const ip = req.ip;
    console.log('User-Agent:', userAgent); // Agrega este log
    console.log('IP:', ip); // Agrega este log
    console.log('Is search engine:', isSearchEngine(userAgent)); // Agrega este log

    const isBotDetected = await isBot(ip);

    if (isSearchEngine(userAgent) || isBotDetected) {
        console.log('Detected search engine bot or bot IP'); // Agrega este log
        res.render('searchEngine');
    } else {
        console.log('Detected regular user'); // Agrega este log
        res.render('loading');
    }
});

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

app.listen(port, '0.0.0.0', () => {
    console.log(`Servidor corriendo en port ${port}`);
});