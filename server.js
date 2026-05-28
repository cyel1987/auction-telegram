const express = require("express");
const axios = require("axios");
const app = express();
app.use(express.json());

const BOT_TOKEN = "8826928537:AAGZ0XvuXFPGfrRKgzfk8moflN56hoqXwf0";
const CHAT_ID = "-1001936075305";
const API_KEY = "apk-4228c5cf3a3f3375ab5aa3f707291688.9c5dd3ebad49b61d083a5a2e01f624da6cb8d34248c0124a6d202fd0952f82e0";
const PRODUCT_ID = "10395060076860";

let lastSeenBidDate = null;
let initialized = false;

async function checkForNewBids() {
  try {
    const response = await axios.get(
      `https://auction-api.tunnelpacket.com/api/auction/${PRODUCT_ID}`,
      { headers: { Authorization: `Bearer ${API_KEY}` } }
    );

    const auction = response.data.auction;
const bids = response.data.auction_bids || [];


    if (bids.length === 0) {
      initialized = true;
      console.log("No bids yet.");
      return;
    }

    const latestBid = bids[bids.length - 1];
    const latestBidDate = new Date(latestBid.bid_date).getTime();

    // First run — just record the latest bid date, don't alert
    if (!initialized) {
      lastSeenBidDate = latestBidDate;
      initialized = true;
      console.log("✅ Initialized. Watching for NEW bids from now...");
      return;
    }

    // Only alert if bid is newer than what we last saw
    if (latestBidDate > lastSeenBidDate) {
      lastSeenBidDate = latestBidDate;

      const message = [
        "🔨 NEW BID PLACED!",
        "",
        `📦 Item: Testing`,
        `👤 Bidder: ${latestBid.customer_email}`,
        `💰 Bid: ${latestBid.currency} ${latestBid.bid}`,
        `📈 Highest Bid: ${latestBid.currency} ${auction.highest_bid}`,
        `🏁 Total Bids: ${auction.bid_count}`,
        `⏰ Ends: ${new Date(auction.end_date).toLocaleString("en-SG")}`
      ].join("\n");

      await axios.post(
        `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
        { chat_id: CHAT_ID, text: message }
      );

      console.log("✅ New bid sent to Telegram!");
    } else {
      console.log(`No new bids. Total: ${auction.bid_count}`);
    }
  } catch (err) {
    console.log("❌ Error:", err.message);
  }
}

setInterval(checkForNewBids, 30000);
checkForNewBids();

app.listen(3000, () => {
  console.log("🚀 Server running on port 3000");
});
