const express = require("express");
const axios = require("axios");
const app = express();
app.use(express.json());

const BOT_TOKEN = process.env.BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;
const THREAD_ID = process.env.THREAD_ID;
const API_KEY = process.env.API_KEY;

const bidCounts = {};
const activeProductIds = new Set();
let initialized = false;

async function checkForNewBids() {
  try {
    const activeRes = await axios.get(
      `https://auction-api.tunnelpacket.com/api/auctions?status=active`,
      { headers: { Authorization: `Bearer ${API_KEY}` } }
    );

    const activeAuctions = Array.isArray(activeRes.data) ? activeRes.data : [];
    const currentActiveIds = new Set(activeAuctions.map(a => a.shopify_product_id));

    // First run — just record current active auctions
    if (!initialized) {
      for (const auction of activeAuctions) {
        activeProductIds.add(auction.shopify_product_id);
        bidCounts[auction.shopify_product_id] = auction.bid_count;
      }
      initialized = true;
      console.log(`✅ Initialized. Watching ${activeAuctions.length} active auction(s)...`);
      return;
    }

    // Check for auctions that just ended (disappeared from active list)
    for (const productId of activeProductIds) {
      console.log(`Checking if ${productId} is still active: ${currentActiveIds.has(productId)}`);
      if (!currentActiveIds.has(productId)) {
        activeProductIds.delete(productId);

        // Fetch final details
        try {
          const detailRes = await axios.get(
            `https://auction-api.tunnelpacket.com/api/auction/${productId}`,
            { headers: { Authorization: `Bearer ${API_KEY}` } }
          );
         const auction = detailRes.data.auction;
          const bids = detailRes.data.auction_bids || [];
          const sortedBids = bids.sort((a, b) => new Date(a.bid_date) - new Date(b.bid_date));
          const winner = sortedBids[sortedBids.length - 1];

          if (!auction) {
            console.log(`⚠️ No auction data for ${productId}, skipping...`);
            return;
          }

          // Get product title from archived list
          const archivedRes = await axios.get(
            `https://auction-api.tunnelpacket.com/api/auctions?status=archived`,
            { headers: { Authorization: `Bearer ${API_KEY}` } }
          );
          const archivedAuctions = Array.isArray(archivedRes.data) ? archivedRes.data : [];
          const archivedItem = archivedAuctions.find(a => a.shopify_product_id === productId);
          const productTitle = archivedItem ? archivedItem.shopify_product_title : productId;

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

          console.log(`✅ Auction  ended notification sent for "${productTitle}"!`);
        } catch (e) {
          console.log(`❌ Error fetching ended auction ${productId}:`, e.message);
        }
      }
    }

    // Check for new bids on active auctions
    for (const auctionSummary of activeAuctions) {
      const productId = auctionSummary.shopify_product_id;
      const productTitle = auctionSummary.shopify_product_title;

      activeProductIds.add(productId);

      if (bidCounts[productId] === undefined) {
        bidCounts[productId] = auctionSummary.bid_count;
        continue;
      }

      if (auctionSummary.bid_count > bidCounts[productId]) {
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

        console.log(`✅ New bid on "${productTitle}" sent to Telegram!`);
      } else {
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
