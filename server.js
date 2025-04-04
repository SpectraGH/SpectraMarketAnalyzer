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

// Connect to MongoDB Atlas
mongoose.connect(process.env.MONGODB_URI || 'your_mongodb_connection_string')
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('MongoDB connection error:', err));

// Create a schema for submissions
const submissionSchema = new mongoose.Schema({
    id: Number,
    name: String,
    email: String,
    sku: String,
    description: String,
    metal: String,
    grams: Number,
    calculatedPrice: String,
    action: String,
    imagePath: String,
    timestamp: { type: Date, default: Date.now }
});

// Create a model
const Submission = mongoose.model('Submission', submissionSchema);

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

server.listen(PORT, () => { console.log(`Server running on port ${PORT}`) }).on("error", err => { "EADDRINUSE" === err.code ? console.error(`Port ${PORT} is already in use. Please try a different port.`) : console.error("Error starting server:", err), process.exit(1) }), app.set("view engine", "ejs"), app.set("views", path.join(__dirname, "views")), app.use(express.static("public"));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
    res.setHeader("X-Frame-Options", "ALLOWALL");
    next();
});

async function getMetalPrices() { let e; try { e = await puppeteer.launch({ headless: "new" }); const t = await e.newPage(); await t.goto("https://www.metalsdaily.com/live-prices/pgms/", { timeout: 6e4 }); return await t.evaluate(() => { const e = {}; return document.querySelectorAll("table tr").forEach(t => { const r = t.querySelectorAll("td"); if (r.length > 2) { let t = r[0].innerText.trim(), a = r[2].innerText.trim().replace(/,/g, ""); t.includes("USD/OZ") && (t = t.replace("USD/OZ", "").trim(), e[t] = parseFloat(a) / 28) } }), e }) } catch (e) { return console.error("Error scraping metal prices:", e.message), { Gold: 0, Silver: 0, Platinum: 0, Palladium: 0 } } finally { e && await e.close() } } async function getMetalData(e) { const t = `https://query1.finance.yahoo.com/v8/finance/chart/${e}?range=3mo&interval=1d`; try { const e = await axios.get(t), r = e.data.chart.result[0]; if (!r) throw new Error("No data returned from Yahoo Finance"); return { dates: r.timestamp.map(e => new Date(1e3 * e).toISOString().split("T")[0]), prices: r.indicators.quote[0].close } } catch (e) { return console.error("Error fetching data:", e), { dates: [], prices: [] } } } async function emitRealTimeUpdates() { try { const e = await getMetalPrices(); io.emit("updatePrices", e) } catch (e) { console.error("Error emitting real-time updates:", e.message) } } setInterval(emitRealTimeUpdates, 1e4), app.get("/", (e, t) => { t.send("Welcome to the Metal Prices API! Use /data to get the latest prices.") }), app.get("/data", async (e, t) => { let r = await getMetalPrices(), a = await getMetalData("GC=F"), n = await getMetalData("SI=F"), o = await getMetalData("PL=F"), s = await getMetalData("PA=F"); r.Gold = r.Gold || (a.prices.length > 0 ? a.prices.slice(-1)[0] / 28 : 0), r.Silver = r.Silver || (n.prices.length > 0 ? n.prices.slice(-1)[0] / 28 : 0), r.Platinum = r.Platinum || (o.prices.length > 0 ? o.prices.slice(-1)[0] / 28 : 0), r.Palladium = r.Palladium || (s.prices.length > 0 ? s.prices.slice(-1)[0] / 28 : 0), t.render("index", { metalPrices: r, goldData: a, silverData: n, platinumData: o, palladiumData: s }) }),

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

// Add new route for admin data display page
app.get('/admin', async (req, res) => {
    try {
        // Get submissions from MongoDB instead of file
        const submissions = await Submission.find()
            .sort({ timestamp: -1 }); // Sort by timestamp descending
        
        res.render('admin', { submissions });
    } catch (error) {
        console.error('Error loading admin page:', error);
        res.status(500).send('Error loading data. Please try again.');
    }
});

module.exports = app;

