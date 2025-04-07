const express = require("express"),
    puppeteer = require("puppeteer"),
    axios = require("axios"),
    path = require("path"),
    http = require("http"),
    { Server } = require("socket.io"),
    app = express(),
    server = http.createServer(app),
    io = new Server(server),
    PORT = process.env.PORT || 8e3;
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const mongoose = require('mongoose');
const session = require('express-session');
require('dotenv').config();

// Import models instead of defining schema in server.js
const Submission = require('./models/Submission');
const Order = require('./models/Order');

// Import routes
const orderRoutes = require('./routes/orders');

// Connect to MongoDB Atlas
mongoose.connect(process.env.MONGODB_URI || 'your_mongodb_connection_string')
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('MongoDB connection error:', err));

// Configure Cloudinary
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME || 'dcvqytwuq',
    api_key: process.env.CLOUDINARY_API_KEY || '573695395824533',
    api_secret: process.env.CLOUDINARY_API_SECRET || '2CqOsEyaZZGBvVclLGNYuwHrhQs'
});

// Configure Cloudinary storage for multer
const storage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: {
        folder: 'metal_transactions',
        allowed_formats: ['jpg', 'jpeg', 'png', 'gif'],
        transformation: [{ width: 1000, height: 1000, crop: 'limit' }]
    }
});

const upload = multer({ storage: storage });

// Configure server and middleware
server.listen(PORT, () => { 
    console.log(`Server running on port ${PORT}`) 
}).on("error", err => { 
    "EADDRINUSE" === err.code ? 
    console.error(`Port ${PORT} is already in use. Please try a different port.`) : 
    console.error("Error starting server:", err), 
    process.exit(1) 
});

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static("public"));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
    res.setHeader("X-Frame-Options", "ALLOWALL");
    next();
});

// Use order routes
app.use('/orders', orderRoutes);

// Set up session middleware
app.use(session({
    secret: process.env.SESSION_SECRET || 'spectra-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: process.env.NODE_ENV === 'production', 
        maxAge: 3600000 // 1 hour
    }
}));

// Get metal prices
async function getMetalPrices() { 
    let e; 
    try { 
        e = await puppeteer.launch({ 
            headless: "new", 
            args: ["--no-sandbox", "--disable-setuid-sandbox"],
            ignoreDefaultArgs: ["--disable-extensions"]
        }); 
        const t = await e.newPage(); 
        await t.goto("https://www.metalsdaily.com/live-prices/pgms/", { timeout: 6e4 }); 
        return await t.evaluate(() => { 
            const e = {}; 
            return document.querySelectorAll("table tr").forEach(t => { 
                const r = t.querySelectorAll("td"); 
                if (r.length > 2) { 
                    let t = r[0].innerText.trim(), 
                    a = r[2].innerText.trim().replace(/,/g, ""); 
                    t.includes("USD/OZ") && (t = t.replace("USD/OZ", "").trim(), e[t] = parseFloat(a) / 28) 
                } 
            }), e 
        }) 
    } catch (e) { 
        console.error("Error scraping metal prices:", e.message);
        // Fallback to Yahoo Finance API data
        try {
            console.log("Using fallback method for metal prices...");
            const goldData = await getMetalData("GC=F");
            const silverData = await getMetalData("SI=F");
            const platinumData = await getMetalData("PL=F");
            const palladiumData = await getMetalData("PA=F");
            
            return {
                Gold: goldData.prices.length > 0 ? goldData.prices.slice(-1)[0] / 28 : 0,
                Silver: silverData.prices.length > 0 ? silverData.prices.slice(-1)[0] / 28 : 0,
                Platinum: platinumData.prices.length > 0 ? platinumData.prices.slice(-1)[0] / 28 : 0,
                Palladium: palladiumData.prices.length > 0 ? palladiumData.prices.slice(-1)[0] / 28 : 0
            };
        } catch (fallbackError) {
            console.error("Fallback method also failed:", fallbackError.message);
            return { Gold: 0, Silver: 0, Platinum: 0, Palladium: 0 }; 
        }
    } finally { 
        e && await e.close() 
    } 
}

// Get metal data for charts 
async function getMetalData(e) { 
    const t = `https://query1.finance.yahoo.com/v8/finance/chart/${e}?range=3mo&interval=1d`; 
    try { 
        const e = await axios.get(t), 
        r = e.data.chart.result[0]; 
        if (!r) throw new Error("No data returned from Yahoo Finance"); 
        return { 
            dates: r.timestamp.map(e => new Date(1e3 * e).toISOString().split("T")[0]), 
            prices: r.indicators.quote[0].close 
        } 
    } catch (e) { 
        return console.error("Error fetching data:", e), { dates: [], prices: [] } 
    } 
}

// Real-time price updates
async function emitRealTimeUpdates() { 
    try { 
        const e = await getMetalPrices(); 
        io.emit("updatePrices", e) 
    } catch (e) { 
        console.error("Error emitting real-time updates:", e.message) 
    } 
} 

setInterval(emitRealTimeUpdates, 1e4);

// Root route
app.get("/", (e, t) => { 
    t.send("Welcome to the Metal Prices API! Use /data to get the latest prices.") 
});

// Data route
app.get("/data", async (e, t) => { 
    let r = await getMetalPrices(), 
    a = await getMetalData("GC=F"), 
    n = await getMetalData("SI=F"), 
    o = await getMetalData("PL=F"), 
    s = await getMetalData("PA=F"); 
    
    r.Gold = r.Gold || (a.prices.length > 0 ? a.prices.slice(-1)[0] / 28 : 0);
    r.Silver = r.Silver || (n.prices.length > 0 ? n.prices.slice(-1)[0] / 28 : 0);
    r.Platinum = r.Platinum || (o.prices.length > 0 ? o.prices.slice(-1)[0] / 28 : 0);
    r.Palladium = r.Palladium || (s.prices.length > 0 ? s.prices.slice(-1)[0] / 28 : 0);
    
    t.render("index", { 
        metalPrices: r, 
        goldData: a, 
        silverData: n, 
        platinumData: o, 
        palladiumData: s 
    }) 
});

// Route to display sell confirmation page
app.get('/orders/sell-confirmation/:orderNumber', async (req, res) => {
    try {
        const orderNumber = req.params.orderNumber;
        
        // Find the order
        const order = await Order.findOne({ orderNumber });
        
        if (!order) {
            return res.status(404).render('error', { 
                message: 'Order not found', 
                error: { status: 404, stack: '' } 
            });
        }
        
        // Check if it's a sell order
        if (order.action !== 'sell') {
            return res.status(400).render('error', { 
                message: 'Invalid order type', 
                error: { status: 400, stack: '' } 
            });
        }
        
        // Render the sell confirmation page
        res.render('sell-confirmation', { order });
    } catch (error) {
        console.error('Error loading sell confirmation:', error);
        res.status(500).render('error', { 
            message: 'Error loading sell confirmation', 
            error: { status: 500, stack: process.env.NODE_ENV === 'development' ? error.stack : '' } 
        });
    }
});

// Handle direct image uploads to Cloudinary
app.post('/upload-image', async (req, res) => {
    try {
        const fileStr = req.body.data;
        const uploadedResponse = await cloudinary.uploader.upload(fileStr, {
            upload_preset: 'metal_transactions'
        });
        res.json({ success: true, url: uploadedResponse.secure_url });
    } catch (error) {
        console.error('Error uploading image:', error);
        res.status(500).json({ success: false, message: 'Failed to upload image' });
    }
});

// Handle form submissions
app.post('/submit-form', upload.single('image'), async (req, res) => {
    try {
        const { name, email, sku, description, action, metal, grams, calculatedPrice } = req.body;
        const id = Date.now();
        
        // Create a new submission document
        const newSubmission = new Submission({
            id: id,
            name,
            email,
            sku,
            description,
            metal,
            grams: parseFloat(grams) || 0,
            calculatedPrice,
            action: action || 'none',
            imagePath: req.file ? req.file.path : null
        });
        
        // Save to MongoDB
        await newSubmission.save();

        // Return success response with ID
        res.json({ 
            success: true, 
            message: 'Thank you! Your submission has been received.',
            id: id
        });
    } catch (error) {
        console.error('Error saving submission:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error processing your submission. Please try again.',
            error: error.message
        });
    }
});

// Authentication middleware
const isAuthenticated = (req, res, next) => {
    if (req.session && req.session.isAuthenticated) {
        return next();
    }
    // Store the original URL for redirect after login
    req.session.returnTo = req.originalUrl;
    res.redirect('/admin/login');
};

// Admin login page
app.get('/admin/login', (req, res) => {
    res.render('admin-login', { error: null });
});

// Admin login POST endpoint - updated to handle JSON requests
app.post('/admin/login', express.json(), (req, res) => {
    const { username, password, rememberMe } = req.body;
    
    // Get credentials from environment variables or use defaults for development
    const adminUsername = process.env.ADMIN_USERNAME || 'admin';
    const adminPassword = process.env.ADMIN_PASSWORD || 'spectra2023';
    
    if (username === adminUsername && password === adminPassword) {
        // Set authenticated session
        req.session.isAuthenticated = true;
        
        // Store remember me preference in session
        if (rememberMe) {
            req.session.rememberMe = true;
            // Set a longer session expiration if rememberMe is true
            req.session.cookie.maxAge = 7 * 24 * 60 * 60 * 1000; // 7 days
        }
        
        // Redirect to originally requested URL or admin dashboard
        const redirectUrl = req.session.returnTo || '/admin/dashboard';
        delete req.session.returnTo;
        
        // Handle both form and API requests
        if (req.headers['content-type'] === 'application/json') {
            res.json({ success: true, redirect: redirectUrl });
        } else {
            res.redirect(redirectUrl);
        }
    } else {
        // Handle both form and API requests
        if (req.headers['content-type'] === 'application/json') {
            res.status(401).json({ error: 'Invalid username or password' });
        } else {
            res.render('admin-login', { error: 'Invalid username or password' });
        }
    }
});

// Verify authentication token endpoint
app.post('/admin/verify-token', express.json(), (req, res) => {
    const { token } = req.body;
    
    // Check if token exists and session is authenticated
    if (token && req.session && req.session.isAuthenticated) {
        res.json({ valid: true });
    } else {
        res.json({ valid: false });
    }
});

// Check session validity endpoint
app.get('/admin/check-session', (req, res) => {
    if (req.session && req.session.isAuthenticated) {
        res.json({ valid: true });
    } else {
        res.json({ valid: false });
    }
});

// Admin logout
app.get('/admin/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/admin/login');
});

// Protected admin dashboard
app.get('/admin/dashboard', isAuthenticated, async (req, res) => {
    try {
        // Get submissions from MongoDB
        const submissions = await Submission.find()
            .sort({ timestamp: -1 }); // Sort by timestamp descending
        
        // Get orders with their related submission data
        const orders = await Order.find()
            .sort({ createdAt: -1 })
            .lean(); // Use lean to get plain JS objects
        
        // Create an orders map for easy lookup by submissionId
        const ordersMap = {};
        orders.forEach(order => {
            if (order.submissionId) {
                ordersMap[order.submissionId.toString()] = order;
            }
        });
        
        res.render('admin', { submissions, orders, ordersMap });
    } catch (error) {
        console.error('Error loading admin page:', error);
        res.status(500).send('Error loading data. Please try again.');
    }
});

// Redirect old admin URL to new dashboard
app.get('/admin', (req, res) => {
    res.redirect('/admin/dashboard');
});

// Error handling middleware
app.use((req, res, next) => {
    res.status(404).render('error', {
        message: 'Page not found',
        error: { status: 404, stack: '' }
    });
});

app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(err.status || 500).render('error', {
        message: err.message || 'Something went wrong!',
        error: process.env.NODE_ENV === 'development' ? err : {}
    });
});

module.exports = app;

