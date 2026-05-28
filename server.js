const express = require("express");
const axios = require("axios");
const app = express();
app.use(express.json());

const BOT_TOKEN = process.env.BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;
const THREAD_ID = process.env.THREAD_ID;
const API_KEY = process.env.API_KEY;

const bidCounts = {};
let initialized = false;

async function checkForNewBids() {
  try {
    const listResponse = await axios.get(
      `https://auction-api.tunnelpacket.com/api/auctions?status=active`,
      { headers: { Authorization: `Bearer ${API_KEY}` } }
    );

    const auctions = listResponse.data;
    if (!auctions || auctions.length === 0) {
      console.log("No active auctions found.");
      initialized = true;
      return;
    }

    for (const auctionSummary of auctions) {
      const productId = auctionSummary.shopify_product_id;
      const productTitle = auctionSummary.shopify_product_title;

      const detailResponse = await axios.get(
        `https://auction-api.tunnelpacket.com/api/auction/${productId}`,
        { headers: { Authorization: `Bearer ${API_KEY}` } }
      );

      const auction = detailResponse.data.auction;
      const bids = detailResponse.data.auction_bids || [];

      if (!initialized) {
        bidCounts[productId] = auction.bid_count;
        continue;
      }

      if (bidCounts[productId] === undefined) {
        bidCounts[productId] = auction.bid_count;
        continue;
      }

      if (auction.bid_count > bidCounts[productId]) {
        bidCounts[productId] = auction.bid_count;

        const sortedBids = bids.sort((a, b) => new Date(a.bid_date) - new Date(b.bid_date));
        const latestBid = sortedBids[sortedBids.length - 1];
        const secondLatestBid = sortedBids[sortedBids.length - 2];

        if (!latestBid) continue;

        const message = [
          "🔨 NEW BID PLACED!",
          "",
          `📦 Item: ${productTitle}`,
          `👤 Bidder: ${latestBid.customer_first_name[0]}${'*'.repeat(latestBid.customer_first_name.length - 1)} ${latestBid.customer_last_name[0]}${'*'.repeat(latestBid.customer_last_name.length - 1)}`,
          `💰 Previous Bid: ${latestBid.currency} ${secondLatestBid ? secondLatestBid.bid : '-'}`,
          `📈 Current Bid: ${latestBid.currency} ${auction.highest_bid}`,
          `🏁 Total Bids: ${auction.bid_count}`,
          `⏰ Ends: ${new Date(auction.end_date).toLocaleString("en-SG", { timeZone: "Asia/Singapore" })}`,
        ].join("\n");

        await axios.post(
          `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
          { chat_id: CHAT_ID, message_thread_id: THREAD_ID, text: message }
        );

        console.log(`✅ New bid on "${productTitle}" sent to Telegram!`);
      } else {
        console.log(`No new bids on "${productTitle}". Total: ${auction.bid_count}`);
      }
    }

    if (!initialized) {
      initialized = true;
      console.log(`✅ Initialized. Watching ${auctions.length} active auction(s)...`);
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
