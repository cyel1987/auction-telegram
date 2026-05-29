const express = require("express");
const axios = require("axios");
const app = express();
app.use(express.json());

const BOT_TOKEN = process.env.BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;
const THREAD_ID = process.env.THREAD_ID;
const API_KEY = process.env.API_KEY;

const bidCounts = {};
const endedAuctions = new Set();
let initialized = false;

async function checkForNewBids() {
  try {
    const activeRes = await axios.get(
      `https://auction-api.tunnelpacket.com/api/auctions?status=active`,
      { headers: { Authorization: `Bearer ${API_KEY}` } }
    );

    const activeAuctions = Array.isArray(activeRes.data) ? activeRes.data : [];
    const now = new Date();

    if (!initialized) {
      for (const auction of activeAuctions) {
        bidCounts[auction.shopify_product_id] = auction.bid_count;
      }
      initialized = true;
      console.log(`✅ Initialized. Watching ${activeAuctions.length} active auction(s)...`);
      return;
    }

    for (const auctionSummary of activeAuctions) {
      const productId = auctionSummary.shopify_product_id;
      const productTitle = auctionSummary.shopify_product_title;
      const hasEnded = new Date(auctionSummary.end_date) < now;

      if (bidCounts[productId] === undefined) {
        bidCounts[productId] = auctionSummary.bid_count;
        continue;
      }

      // Auction just ended
      if (hasEnded && !endedAuctions.has(productId)) {
        endedAuctions.add(productId);

        const detailRes = await axios.get(
          `https://auction-api.tunnelpacket.com/api/auction/${productId}`,
          { headers: { Authorization: `Bearer ${API_KEY}` } }
        );
        const auction = detailRes.data.auction;
        const bids = detailRes.data.auction_bids || [];

        if (!auction) continue;

        const sortedBids = bids.sort((a, b) => new Date(a.bid_date) - new Date(b.bid_date));
        const winner = sortedBids[sortedBids.length - 1];

        const endMessage = [
          "🏁 AUCTION ENDED!",
          "",
          `📦 Item: ${productTitle}`,
          `🏆 Winner: ${winner ? `${winner.customer_first_name[0]}${'*'.repeat(winner.customer_first_name.length - 1)} ${winner.customer_last_name[0]}${'*'.repeat(winner.customer_last_name.length - 1)}` : 'No bids'}`,
          `💰 Winning Bid: ${winner ? `${winner.currency} ${auction.highest_bid}` : '-'}`,
          `🏁 Total Bids: ${auction.bid_count}`,
        ].join("\n");

        await axios.post(
          `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
          { chat_id: CHAT_ID, message_thread_id: THREAD_ID, text: endMessage }
        );

        console.log(`✅ Auction ended: "${productTitle}"`);
        continue;
      }

      // New bid placed
      if (!hasEnded && auctionSummary.bid_count > bidCounts[productId]) {
        const detailRes = await axios.get(
          `https://auction-api.tunnelpacket.com/api/auction/${productId}`,
          { headers: { Authorization: `Bearer ${API_KEY}` } }
        );
        const auction = detailRes.data.auction;
        const bids = detailRes.data.auction_bids || [];
        const sortedBids = bids.sort((a, b) => new Date(a.bid_date) - new Date(b.bid_date));
        const latestBid = sortedBids[sortedBids.length - 1];
        const secondLatestBid = sortedBids[sortedBids.length - 2];

        bidCounts[productId] = auction.bid_count;

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

        console.log(`✅ New bid on "${productTitle}"`);
      } else if (!hasEnded) {
        console.log(`No new bids on "${productTitle}". Total: ${auctionSummary.bid_count}`);
      }
    }

  } catch (err) {
    console.log("❌ Error:", err.message);
  }
}

setInterval(checkForNewBids, 10000);
checkForNewBids();

app.get("/", (req, res) => {
  res.send("Auction bot is running!");
});

app.listen(3000, () => {
  console.log("🚀 Server running on port 3000");
});
