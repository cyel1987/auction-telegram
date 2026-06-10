const express = require("express");
const axios = require("axios");
const app = express();
app.use(express.json());

const BOT_TOKEN = process.env.BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;
const THREAD_ID = process.env.THREAD_ID;
const THREAD_ID_SHORT = process.env.THREAD_ID_SHORT;
const API_KEY = process.env.API_KEY;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;
const SHOPIFY_STORE = "geekster-sg.myshopify.com";

const bidCounts = {};
const endedAuctions = new Set();
const notifiedNewAuctions = new Set();
const sentReminders = {};
const auctionEndDates = {};
const newAuctionNotifiedDates = {};
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

function formatAmount(amount) {
  return parseFloat(amount).toFixed(0);
}

async function sendAdminMessage(text) {
  try {
    await axios.post(
      `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
      { chat_id: ADMIN_CHAT_ID, text, parse_mode: "HTML" }
    );
  } catch (e) {
    console.log(`❌ Admin message error: ${e.message}`);
  }
}

async function handleAutobidCommand() {
  try {
    const activeRes = await axios.get(
      `https://auction-api.tunnelpacket.com/api/auctions?status=active`,
      { headers: { Authorization: `Bearer ${API_KEY}` } }
    );
    const activeAuctions = Array.isArray(activeRes.data) ? activeRes.data : [];

    if (activeAuctions.length === 0) {
      await sendAdminMessage("No active auctions found.");
      return;
    }

    let message = "🤖 <b>AUTOBID INFO</b>\n";

    for (const auctionSummary of activeAuctions) {
      const productId = auctionSummary.shopify_product_id;
      const productTitle = auctionSummary.shopify_product_title;

      const detailRes = await axios.get(
        `https://auction-api.tunnelpacket.com/api/auction/${productId}`,
        { headers: { Authorization: `Bearer ${API_KEY}` } }
      );
      const autoBids = detailRes.data.automatic_bids || [];

      message += `\n📦 <b>${productTitle}</b>\n`;
      message += `💰 Current Highest Bid: SGD ${formatAmount(auctionSummary.highest_bid)}\n`;

      if (autoBids.length === 0) {
        message += `No autobids placed.\n`;
      } else {
        const sortedAutoBids = autoBids.sort((a, b) => parseFloat(b.bid) - parseFloat(a.bid));
        for (const ab of sortedAutoBids) {
          message += `👤 ${ab.customer_first_name} ${ab.customer_last_name} (${ab.customer_email}) | Max: ${ab.currency} ${formatAmount(ab.bid)}\n`;
        }
      }
    }

    await sendAdminMessage(message);
  } catch (e) {
    console.log(`❌ Autobid command error: ${e.message}`);
    await sendAdminMessage(`❌ Error fetching autobid info: ${e.message}`);
  }
}

// Listen for /autobid command from admin
app.post("/telegram-webhook", async (req, res) => {
  res.sendStatus(200);
  const message = req.body.message;
  if (!message) return;
  if (message.chat.id.toString() !== ADMIN_CHAT_ID) return;
  if (message.text === "/autobid") {
    await handleAutobidCommand();
  }
});

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
        auctionEndDates[auction.shopify_product_id] = auction.end_date;
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

      // Reset reminders if end date has changed
      if (auctionEndDates[productId] && auctionEndDates[productId] !== auctionSummary.end_date) {
        console.log(`🔄 End date changed for "${productTitle}", resetting reminders...`);
        sentReminders[productId] = [];
      }
      auctionEndDates[productId] = auctionSummary.end_date;

      if (bidCounts[productId] === undefined) {
        bidCounts[productId] = auctionSummary.bid_count;
        sentReminders[productId] = [];
        if (hasEnded) {
          endedAuctions.add(productId);
          notifiedNewAuctions.add(productId);
        }
        continue;
      }

      // New auction listing notification at 10am on Mon/Wed
      if (!notifiedNewAuctions.has(productId) && !hasEnded) {
        const sgtHour = parseInt(new Date().toLocaleString("en-SG", { timeZone: "Asia/Singapore", hour: "numeric", hour12: false }));
        const sgtMinute = parseInt(new Date().toLocaleString("en-SG", { timeZone: "Asia/Singapore", minute: "numeric" }));
        const sgtDay = new Date().toLocaleString("en-SG", { timeZone: "Asia/Singapore", weekday: "long" });
        const isAuctionDay = sgtDay === "Monday" || sgtDay === "Wednesday";
        const isAuctionTime = isAuctionDay && sgtHour === 10 && sgtMinute === 0;
        const todayDate = new Date().toLocaleDateString("en-SG", { timeZone: "Asia/Singapore" });
        const alreadyNotifiedToday = newAuctionNotifiedDates[productId] === todayDate;

        if (isAuctionTime && !alreadyNotifiedToday) {
          notifiedNewAuctions.add(productId);
          newAuctionNotifiedDates[productId] = todayDate;
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
                `💰 Starting Price: ${auctionSummary.starting_price ? `SGD ${formatAmount(auctionSummary.starting_price)}` : 'N.A.'}`,
                `🔓 Release Price: ${auction.reserve_price ? `SGD ${formatAmount(auction.reserve_price)}` : 'N.A.'}`,
                `🛒 Buyout Price: ${auction.buy_it_now_price ? `SGD ${formatAmount(auction.buy_it_now_price)}` : 'N.A.'}`,
                `⏰ Ends: ${new Date(auction.end_date).toLocaleString("en-SG", { timeZone: "Asia/Singapore" })}`,
                `🔗 <a href="${productUrl}">Submit Your Bid Here</a>`,
              ].join("\n");

              await axios.post(
                `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
                { chat_id: CHAT_ID, message_thread_id: THREAD_ID, text: newAuctionMessage, parse_mode: "HTML" }
              );

              console.log(`✅ New auction listed: "${productTitle}"`);
            }
          } catch (e) {
            console.log(`❌ Error sending new auction notification: ${e.message}`);
          }
        } else if (!isAuctionTime) {
          console.log(`⏳ New auction "${productTitle}" detected but not auction time. Skipping.`);
        }
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

              const detailReminderRes = await axios.get(
                `https://auction-api.tunnelpacket.com/api/auction/${productId}`,
                { headers: { Authorization: `Bearer ${API_KEY}` } }
              );
              const reminderAuction = detailReminderRes.data.auction;
              const reminderBids = detailReminderRes.data.auction_bids || [];
              const sortedReminderBids = reminderBids.sort((a, b) => parseFloat(b.bid) - parseFloat(a.bid));
              const currentLeader = sortedReminderBids[0];

              const reminderMessage = [
                "⏰ AUCTION ENDING SOON!",
                "",
                `📦 Item: ${productTitle}`,
                `📈 Current Bid: SGD ${formatAmount(auctionSummary.highest_bid)}`,
                `👤 Current Bidder: ${currentLeader ? `${currentLeader.customer_first_name[0]}${'*'.repeat(Math.max(currentLeader.customer_first_name.length - 1, 1))} ${currentLeader.customer_last_name[0]}${'*'.repeat(Math.max(currentLeader.customer_last_name.length - 1, 1))}` : 'No bids yet'}`,
                `🏁 Total Bids: ${auctionSummary.bid_count}`,
                `🔓 Release Price: ${reminderAuction?.reserve_price ? `SGD ${formatAmount(reminderAuction.reserve_price)}` : 'N.A.'}`,
                `🛒 Buyout Price: ${reminderAuction?.buy_it_now_price ? `SGD ${formatAmount(reminderAuction.buy_it_now_price)}` : 'N.A.'}`,
                `⌛ Ending in ${reminder.label}!`,
                `🔗 <a href="${productUrl}">Submit Your Bid Here</a>`,
              ].join("\n");

              const reminderMessageShort = [
                `⏰ ${productTitle} ending in ${reminder.label}!`,
                `💰 Current Bid: SGD ${formatAmount(auctionSummary.highest_bid)}`,
                `🔓 RP: ${reminderAuction?.reserve_price ? `SGD ${formatAmount(reminderAuction.reserve_price)}` : 'N.A.'}`,
                `🔗 <a href="${productUrl}">Submit Your Bid Here</a>`,
              ].join("\n");

              await axios.post(
                `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
                { chat_id: CHAT_ID, message_thread_id: THREAD_ID, text: reminderMessage, parse_mode: "HTML" }
              );

              await axios.post(
                `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
                { chat_id: CHAT_ID, message_thread_id: THREAD_ID_SHORT, text: reminderMessageShort, parse_mode: "HTML", disable_web_page_preview: true }
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
            const sortedBids = bids.sort((a, b) => parseFloat(b.bid) - parseFloat(a.bid));
            const winner = sortedBids[0];

            if (winner) hasWinner = true;

            const reserveNotMet = auction.reserve_price && parseFloat(auction.highest_bid) < parseFloat(auction.reserve_price);

            const endMessage = [
              "🏁 AUCTION ENDED!",
              "",
              `📦 Item: ${productTitle}`,
              `🏆 Winner: ${winner ? `${winner.customer_first_name[0]}${'*'.repeat(winner.customer_first_name.length - 1)} ${winner.customer_last_name[0]}${'*'.repeat(winner.customer_last_name.length - 1)}` : 'No bids'}`,
              `💰 Winning Bid: ${winner ? `${winner.currency} ${formatAmount(auction.highest_bid)}` : '-'}`,
              `🏁 Total Bids: ${auction.bid_count}`,
              `🔓 Release Price: ${auction.reserve_price ? `${winner ? winner.currency : 'SGD'} ${formatAmount(auction.reserve_price)}` : 'N.A.'}`,
              ...(reserveNotMet ? [
                "",
                `⚠️ The current bid has not met the Release Price of ${winner.currency} ${formatAmount(auction.reserve_price)}.`,
                `We will get back to the current winner if the seller is fine to let go at the current bid price.`,
              ] : []),
            ].join("\n");

            const endMessageShort = [
              `🏁 ${productTitle} has ended!`,
              `🏆 Winner: ${winner ? `${winner.customer_first_name[0]}${'*'.repeat(winner.customer_first_name.length - 1)} ${winner.customer_last_name[0]}${'*'.repeat(winner.customer_last_name.length - 1)}` : 'No bids'}`,
              `💰 Winning Bid: ${winner ? `${winner.currency} ${formatAmount(auction.highest_bid)}` : '-'}`,
              `🔓 RP: ${auction.reserve_price ? `${winner ? winner.currency : 'SGD'} ${formatAmount(auction.reserve_price)}` : 'N.A.'}`,
            ].join("\n");

            await axios.post(
              `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
              { chat_id: CHAT_ID, message_thread_id: THREAD_ID, text: endMessage }
            );

            await axios.post(
              `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
              { chat_id: CHAT_ID, message_thread_id: THREAD_ID_SHORT, text: endMessageShort, disable_web_page_preview: true }
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
          const autoBids = detailRes.data.automatic_bids || [];
          const sortedBids = bids.sort((a, b) => parseFloat(b.bid) - parseFloat(a.bid));
          const latestBid = sortedBids[0];
          const secondLatestBid = sortedBids[1];

          bidCounts[productId] = auction.bid_count;

          const bidShopifyInfo = await getShopifyProductInfo(productId);
          const bidProductUrl = bidShopifyInfo ? `https://www.geekster.sg/products/${bidShopifyInfo.handle}` : 'https://www.geekster.sg/collections/auctions';

          if (latestBid) {
            const message = [
              "🔨 NEW BID PLACED!",
              "",
              `📦 Item: ${productTitle}`,
              `👤 Bidder: ${latestBid.customer_first_name[0]}${'*'.repeat(Math.max(latestBid.customer_first_name.length - 1, 1))} ${latestBid.customer_last_name[0]}${'*'.repeat(Math.max(latestBid.customer_last_name.length - 1, 1))}`,
              `💰 Previous Bid: ${latestBid.currency} ${secondLatestBid ? formatAmount(secondLatestBid.bid) : '-'}`,
              `📈 Current Bid: ${latestBid.currency} ${formatAmount(auction.highest_bid)}`,
              `🏁 Total Bids: ${auction.bid_count}`,
              `🔓 Release Price: ${auction.reserve_price ? `${latestBid.currency} ${formatAmount(auction.reserve_price)}` : 'N.A.'}`,
              `🛒 Buyout Price: ${auction.buy_it_now_price ? `${latestBid.currency} ${formatAmount(auction.buy_it_now_price)}` : 'N.A.'}`,
              `⏰ Ends: ${new Date(auction.end_date).toLocaleString("en-SG", { timeZone: "Asia/Singapore" })}`,
              `🔗 <a href="${bidProductUrl}">Submit Your Bid Here</a>`,
            ].join("\n");

            const messageShort = [
              `🔨 New bid on ${productTitle}`,
              `👤 Bidder: ${latestBid.customer_first_name[0]}${'*'.repeat(Math.max(latestBid.customer_first_name.length - 1, 1))} ${latestBid.customer_last_name[0]}${'*'.repeat(Math.max(latestBid.customer_last_name.length - 1, 1))}`,
              `💰 Bid: ${latestBid.currency} ${formatAmount(auction.highest_bid)}`,
              `🔓 RP: ${auction.reserve_price ? `${latestBid.currency} ${formatAmount(auction.reserve_price)}` : 'N.A.'}`,
              `🔗 <a href="${bidProductUrl}">Submit Your Bid Here</a>`,
            ].join("\n");

            // Admin private message with autobid info
            let adminMessage = [
              `🔨 NEW BID - ${productTitle}`,
              ``,
              `👤 Bidder: ${latestBid.customer_first_name} ${latestBid.customer_last_name}`,
              `📧 Email: ${latestBid.customer_email}`,
              `💰 Current Bid: ${latestBid.currency} ${formatAmount(auction.highest_bid)}`,
              `🏁 Total Bids: ${auction.bid_count}`,
            ].join("\n");

            if (autoBids.length > 0) {
              const sortedAutoBids = autoBids.sort((a, b) => parseFloat(b.bid) - parseFloat(a.bid));
              adminMessage += "\n\n🤖 AUTOBID INFO\n";
              for (const ab of sortedAutoBids) {
                adminMessage += `👤 ${ab.customer_first_name} ${ab.customer_last_name} (${ab.customer_email}) | Max: ${ab.currency} ${formatAmount(ab.bid)}\n`;
              }
            } else {
              adminMessage += "\n\n🤖 No autobids placed.";
            }

            await axios.post(
              `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
              { chat_id: CHAT_ID, message_thread_id: THREAD_ID, text: message, parse_mode: "HTML" }
            );

            await axios.post(
              `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
              { chat_id: CHAT_ID, message_thread_id: THREAD_ID_SHORT, text: messageShort, parse_mode: "HTML", disable_web_page_preview: true }
            );

            await sendAdminMessage(adminMessage);

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

// Set up Telegram webhook for /autobid command
async function setWebhook() {
  try {
    await axios.post(
      `https://api.telegram.org/bot${BOT_TOKEN}/setWebhook`,
      { url: `https://auction-telegram.onrender.com/telegram-webhook` }
    );
    console.log("✅ Webhook set successfully");
  } catch (e) {
    console.log(`❌ Webhook error: ${e.message}`);
  }
}

app.get("/", (req, res) => {
  res.send("Auction bot is running!");
});

app.listen(3000, () => {
  console.log("🚀 Server running on port 3000");
  setWebhook();
});
