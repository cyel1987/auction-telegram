const express = require("express");
const axios = require("axios");
const app = express();
app.use(express.json());

const BOT_TOKEN = "8826928537:AAEdxNbB6Ie5emOQ917CBE2p8t22fypAEb4";
const CHAT_ID = "-1001936075305";

app.post("/auction", async (req, res) => {
  console.log("🔥 REQUEST RECEIVED");
  try {
    const message = "🎲 NEW BID ALERT\n\nItem: Test Item\nBidder: Test User\nBid: SGD 100";
    console.log("📤 Sending to Telegram...");
    const response = await axios.post(
      `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
      {
        chat_id: CHAT_ID,
        text: message
      }
    );
    console.log("✅ Success:", response.data);
    res.send("OK");
  } catch (err) {
    console.log("❌ FULL ERROR:");
    console.log(err.message);
    if (err.response) {
      console.log("STATUS:", err.response.status);
      console.log("DATA:", JSON.stringify(err.response.data));
    }
    res.status(500).send("ERROR");
  }
});

app.listen(3000, () => {
  console.log("Server running on port 3000");
});