const express = require("express");
const axios = require("axios");
const app = express();
app.use(express.json());

const BOT_TOKEN = process.env.BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;
const THREAD_ID = process.env.THREAD_ID;
const API_KEY = process.env.API_KEY;
const SHOPIFY_STORE = "geekster-sg.myshopify.com";

const bidCounts = {};
const endedAuctions = new Set();
const notifiedNewAuctions = new Set();
const sentReminders = {}; // tracks which reminders sent per auction
let initialized = false;

async function getShopifyProductInfo(productId) {
  try {
    const res = await axios.get(
      `https://${SHOPIFY_STORE}/products.json?tag=product_auction&limit=50`
    );
    const products = res.data.products || [];
    const product = products.find(p => p.id.toString() === productId.toString());
    return product ? {
      publishedAt: new Date(product.published_at),
      handle: product.handle
    } : null;
  } catch (e) {
    console.log(`❌ Error fetching Shopify product: ${e.message}`);
    return null;
  }
}

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
        sentReminders[auction.shopify_product_id] = [];
        if (new Date(auction.end_date) < now) {
          endedAuctions.add(auction.shopify_product_id);
          notifiedNewAuctions.add(auction.shopify_product_id);
        }
      }
      initialized = true;
      console.log(`✅ Initialized. Watching ${activeAuctions.length} active auction(s)...`);
      return;
    }
    let hasWinner = false;

    for (const auctionSummary of activeAuctions) {
      const productId = auctionSummary.shopify_product_id;
      const productTitle = auctionSummary.shopify_product_title;
      const endDate = new Date(auctionSummary.end_date);
      const hasEnded = endDate < now;
      const minutesLeft = (endDate - now) / 60000;

      if (bidCounts[productId] === undefined) {
        bidCounts[productId] = auctionSummary.bid_count;
        sentReminders[productId] = [];

        if (hasEnded) {
          endedAuctions.add(productId);
          notifiedNewAuctions.add(productId);
        } else if (!notifiedNewAuctions.has(productId)) {
          const sgtHour = parseInt(new Date().toLocaleString("en-SG", { timeZone: "Asia/Singapore", hour: "numeric", hour12: false }));
          const sgtMinute = parseInt(new Date().toLocaleString("en-SG", { timeZone: "Asia/Singapore", minute: "numeric" }));
          const sgtDay = new Date().toLocaleString("en-SG", { timeZone: "Asia/Singapore", weekday: "long" });
          const isAuctionDay = sgtDay === "Monday" || sgtDay === "Wednesday";
          const isAuctionTime = isAuctionDay && sgtHour === 10 && sgtMinute === 0;

          if (isAuctionTime) {
            notifiedNewAuctions.add(productId);
            try {
              const shopifyInfo = await getShopifyProductInfo(productId);
              const productUrl = shopifyInfo ? `https://www.geekster.sg/products/${shopifyInfo.handle}` : 'https://www.geekster.sg/collections/auctions';

              const detailRes = await axios.get(
                `https://auction-api.tunnelpacket.com/api/auction/${productId}`,
                { headers: { Authorization: `Bearer ${API_KEY}` } }
              );
              const auction = detailRes.data.auction;

              if (auction) {
                const newAuctionMessage = [
                  "🆕 NEW AUCTION LISTED!",
                  "",
                  `📦 Item: ${productTitle}`,
                  `💰 Starting Price: ${auctionSummary.starting_price ? `SGD ${auctionSummary.starting_price}` : 'N.A.'}`,
                  `🔓 Release Price: ${auction.reserve_price ? `SGD ${auction.reserve_price}` : 'N.A.'}`,
                  `🛒 Buyout Price: ${auction.buy_it_now_price ? `SGD ${auction.buy_it_now_price}` : 'N.A.'}`,
                  `⏰ Ends: ${new Date(auction.end_date).toLocaleString("en-SG", { timeZone: "Asia/Singapore" })}`,
                  `🔗 [Submit Your Bid Here](${productUrl})`,
                ].join("\n");

                await axios.post(
                  `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
                  { chat_id: CHAT_ID, message_thread_id: THREAD_ID, text: newAuctionMessage, parse_mode: "Markdown" }
                );

                console.log(`✅ New auction listed: "${productTitle}"`);
              }
            } catch (e) {
              console.log(`❌ Error sending new auction notification: ${e.message}`);
            }
          } else {
            notifiedNewAuctions.add(productId);
            console.log(`⏳ New auction "${productTitle}" detected but not auction time. Skipping.`);
          }
        }
        continue;
      }

      // Send reminders before auction ends
      if (!hasEnded) {
     const reminders = [
          { minutes: 240, label: "4 hours" },
          { minutes: 180, label: "3 hours" },
          { minutes: 120, label: "2 hours" },
          { minutes: 60, label: "1 hour" },
          { minutes: 30, label: "30 minutes" },
          { minutes: 15, label: "15 minutes" },
          { minutes: 5, label: "5 minutes" },
        ];

        for (const reminder of reminders) {
          const alreadySent = (sentReminders[productId] || []).includes(reminder.minutes);
          if (!alreadySent && minutesLeft <= reminder.minutes && minutesLeft > reminder.minutes - 1) {
            sentReminders[productId] = [...(sentReminders[productId] || []), reminder.minutes];

            try {
              const shopifyInfo = await getShopifyProductInfo(productId);
              const productUrl = shopifyInfo ? `https://www.geekster.sg/products/${shopifyInfo.handle}` : 'https://www.geekster.sg/collections/auctions';

              const reminderMessage = [
                "⏰ AUCTION ENDING SOON!",
                "",
                `📦 Item: ${productTitle}`,
                `📈 Current Bid: SGD ${auctionSummary.highest_bid}`,
                `🏁 Total Bids: ${auctionSummary.bid_count}`,
                `⌛ Ending in ${reminder.label}!`,
                `🔗 [Submit Your Bid Here](${productUrl})`,
              ].join("\n");

              await axios.post(
                `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
                { chat_id: CHAT_ID, message_thread_id: THREAD_ID, text: reminderMessage, parse_mode: "Markdown" }
              );

              console.log(`✅ ${reminder.label} reminder sent for "${productTitle}"`);
            } catch (e) {
              console.log(`❌ Error sending reminder: ${e.message}`);
            }
          }
        }
      }

      // Auction just ended
      if (hasEnded && !endedAuctions.has(productId)) {
        endedAuctions.add(productId);

        try {
          const detailRes = await axios.get(
            `https://auction-api.tunnelpacket.com/api/auction/${productId}`,
            { headers: { Authorization: `Bearer ${API_KEY}` } }
          );
          const auction = detailRes.data.auction;
          const bids = detailRes.data.auction_bids || [];

          if (auction) {
            const sortedBids = bids.sort((a, b) => new Date(a.bid_date) - new Date(b.bid_date));
            const winner = sortedBids[sortedBids.length - 1];

            if (winner) hasWinner = true;

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
          }
        } catch (e) {
          console.log(`❌ Error sending ended notification: ${e.message}`);
        }

        continue;
      }

      // New bid placed
      if (!hasEnded && auctionSummary.bid_count > bidCounts[productId]) {
        try {
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

          const bidShopifyInfo = await getShopifyProductInfo(productId);
          const bidProductUrl = bidShopifyInfo ? `https://www.geekster.sg/products/${bidShopifyInfo.handle}` : 'https://www.geekster.sg/collections/auctions';

          if (latestBid) {
            const message = [
              "🔨 NEW BID PLACED!",
              "",
              `📦 Item: ${productTitle}`,
              `👤 Bidder: ${latestBid.customer_first_name[0]}${'*'.repeat(latestBid.customer_first_name.length - 1)} ${latestBid.customer_last_name[0]}${'*'.repeat(latestBid.customer_last_name.length - 1)}`,
              `💰 Previous Bid: ${latestBid.currency} ${secondLatestBid ? secondLatestBid.bid : '-'}`,
              `📈 Current Bid: ${latestBid.currency} ${auction.highest_bid}`,
              `🏁 Total Bids: ${auction.bid_count}`,
              `🔓 Release Price: ${auction.reserve_price ? `${latestBid.currency} ${auction.reserve_price}` : 'N.A.'}`,
              `🛒 Buyout Price: ${auction.buy_it_now_price ? `${latestBid.currency} ${auction.buy_it_now_price}` : 'N.A.'}`,
              `⏰ Ends: ${new Date(auction.end_date).toLocaleString("en-SG", { timeZone: "Asia/Singapore" })}`,
              `🔗 [Submit Your Bid Here](${bidProductUrl})`,
            ].join("\n");

            await axios.post(
              `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
              { chat_id: CHAT_ID, message_thread_id: THREAD_ID, text: message, parse_mode: "Markdown" }
            );

            console.log(`✅ New bid on "${productTitle}"`);
          }
        } catch (e) {
          console.log(`❌ Error sending bid notification: ${e.message}`);
        }
      } else if (!hasEnded) {
        console.log(`No new bids on "${productTitle}". Total: ${auctionSummary.bid_count}`);
      }
    }

    // Send ONE PayNow QR code if any auction ended with a winner
    if (hasWinner) {
      await axios.post(
        `https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`,
        {
          chat_id: CHAT_ID,
          message_thread_id: THREAD_ID,
          photo: "https://github.com/cyel1987/auction-telegram/blob/main/PayNow.PNG?raw=true",
          caption: "💳 Please make payment via PayNow QR Code."
        }
      );
    }

    console.log("🔁 Check complete.");

  } catch (err) {
    console.log("❌ Error:", err.message);
    console.log("❌ Stack:", err.stack);
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
