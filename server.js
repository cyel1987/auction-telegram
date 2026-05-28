const express = require("express");
const axios = require("axios");
const app = express();
app.use(express.json());

const BOT_TOKEN = "8826928537:AAEdxNbB6Ie5emOQ917CBE2p8t22fypAEb4";
const CHAT_ID = "-1001936075305";
const API_KEY = "apk-067bf7704db3a98885dabee44798e1d2.f540a1dc8febb4ea40a12836c1249124e452a449d69a5e2b73964921a226146a";
const PRODUCT_ID = "10395060076860";

let lastBidCount = 0;
let lastHighestBid = 0;

async function checkForNewBids() {
  try {
    const response = await axios.get(
      `https://auction-api.tunnelpacket.com/api/auction/${PRODUCT_ID}`,
      { headers: { Authorization: `Bearer ${API_KEY}` } }
    );

    const auction = response.data.auction;
    const bids = response.data.auction_bids || [];
    const latestBid = bids[bids.length - 1];

    if (auction.bid_count > lastBidCount && latestBid) {
      lastBidCount = auction.bid_count;
      lastHighestBid = auction.highest_bid;

      const message = [
        "🔨 NEW BID PLACED!",
        "",
        `📦 Item: ${auction.shopify_product_id}`,
        `👤 Bidder: ${latestBid.customer_first_name} ${latestBid.customer_last_name}`,
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
      console.log(`No new bids. Current count: ${auction.bid_count}`);
    }
  } catch (err) {
    console.log("❌ Error:", err.message);
  }
}

// Check every 30 seconds
setInterval(checkForNewBids, 30000);
checkForNewBids(); // Run immediately on start

app.listen(3000, () => {
  console.log("🚀 Server running on port 3000");
});
