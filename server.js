const express = require("express");
const puppeteer = require("puppeteer");
const axios = require("axios");
const path = require("path");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 8000;

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
}).on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`Port ${PORT} is already in use. Please try a different port.`);
    } else {
        console.error('Error starting server:', err);
    }
    process.exit(1);
});

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static("public"));

// Function to scrape metal prices
async function getMetalPrices() {
    let browser;
    try {
        browser = await puppeteer.launch({ headless: "new" });
        const page = await browser.newPage();
        await page.goto("https://www.metalsdaily.com/live-prices/pgms/", { timeout: 60000 });

        const metalPrices = await page.evaluate(() => {
            const rows = document.querySelectorAll("table tr");
            let prices = {};

            rows.forEach(row => {
                const cols = row.querySelectorAll("td");
                if (cols.length > 2) {
                    let metal = cols[0].innerText.trim();
                    let askPrice = cols[2].innerText.trim().replace(/,/g, "");
                    if (metal.includes("USD/OZ")) {
                        metal = metal.replace("USD/OZ", "").trim();
                        prices[metal] = parseFloat(askPrice) / 28; // Convert to per gram
                    }
                }
            });
            return prices;
        });

        return metalPrices;
    } catch (error) {
        console.error("Error scraping metal prices:", error.message);
        return { Gold: 0, Silver: 0, Platinum: 0, Palladium: 0 }; // Fallback prices
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

// Function to get historical metal data from Yahoo Finance
async function getMetalData(symbol) {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=3mo&interval=1d`;
    try {
        const response = await axios.get(url);
        const data = response.data.chart.result[0];
        if (!data) {
            throw new Error("No data returned from Yahoo Finance");
        }
        return {
            dates: data.timestamp.map(ts => new Date(ts * 1000).toISOString().split("T")[0]),
            prices: data.indicators.quote[0].close
        };
    } catch (error) {
        console.error("Error fetching data:", error);
        return { dates: [], prices: [] };
    }
}

// Emit real-time updates to clients
async function emitRealTimeUpdates() {
    try {
        const metalPrices = await getMetalPrices();
        io.emit("updatePrices", metalPrices);
    } catch (error) {
        console.error("Error emitting real-time updates:", error.message);
    }
}

// Periodically fetch and emit updates
setInterval(emitRealTimeUpdates, 10000); // Fetch updates every 60 seconds

app.get("/", (req, res) => {
    res.send("Welcome to the Metal Prices API! Use /data to get the latest prices.");
});

app.get("/data", async (req, res) => {
    let metalPrices = await getMetalPrices();
    
    // Get historical data for all four metals
    let goldData = await getMetalData("GC=F");
    let silverData = await getMetalData("SI=F");
    let platinumData = await getMetalData("PL=F");
    let palladiumData = await getMetalData("PA=F");

    // Use Yahoo Finance data as fallback if scraping fails
    metalPrices["Gold"] = metalPrices["Gold"] || (goldData.prices.length > 0 ? goldData.prices.slice(-1)[0] / 28 : 0);
    metalPrices["Silver"] = metalPrices["Silver"] || (silverData.prices.length > 0 ? silverData.prices.slice(-1)[0] / 28 : 0);
    metalPrices["Platinum"] = metalPrices["Platinum"] || (platinumData.prices.length > 0 ? platinumData.prices.slice(-1)[0] / 28 : 0);
    metalPrices["Palladium"] = metalPrices["Palladium"] || (palladiumData.prices.length > 0 ? palladiumData.prices.slice(-1)[0] / 28 : 0);

    res.render("index", { 
        metalPrices, 
        goldData, 
        silverData, 
        platinumData, 
        palladiumData 
    });
});

// Export for Vercel serverless
module.exports = app;

