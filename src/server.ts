// Must be first — forces IPv4 before any SDK initializes
// Prevents ENOTFOUND errors on networks where IPv6 DNS fails
import dns from "dns";
dns.setDefaultResultOrder("ipv4first");

import "dotenv/config";
import app from "./app";

const PORT = 3000;

app.listen(PORT, () => {
  console.log(`Reel-to-Trip backend running on port ${PORT}`);
});
