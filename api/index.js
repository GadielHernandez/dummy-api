const express = require("express");
const crypto = require("crypto");
const path = require("path");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "../public")));

// ─── CONFIG ────────────────────────────────────────────────────────────────
const API_TOKEN = process.env.API_TOKEN || "dummy-secret-token-2024";
const ENCODED_TOKEN = Buffer.from(API_TOKEN).toString("base64");

// ─── IN-MEMORY STORE ────────────────────────────────────────────────────────
let products = [
  { id: "prod_1", name: "Widget Pro", price: 99.99, stock: 50, createdAt: new Date().toISOString() },
  { id: "prod_2", name: "Gadget Basic", price: 29.99, stock: 200, createdAt: new Date().toISOString() },
  { id: "prod_3", name: "Super Doohickey", price: 149.00, stock: 15, createdAt: new Date().toISOString() },
];

let invoices = [
  {
    id: "inv_1",
    number: "INV-0001",
    customer: "Acme Corp",
    items: [{ productId: "prod_1", name: "Widget Pro", qty: 2, price: 99.99 }],
    total: 199.98,
    status: "paid",
    createdAt: new Date().toISOString(),
  },
  {
    id: "inv_2",
    number: "INV-0002",
    customer: "Globex Inc",
    items: [{ productId: "prod_2", name: "Gadget Basic", qty: 5, price: 29.99 }],
    total: 149.95,
    status: "pending",
    createdAt: new Date().toISOString(),
  },
];

let webhookLogs = [];
let webhookUrl = null; // URL to forward events TO
let invoiceCounter = 3;
let productCounter = 4;

// ─── HELPERS ────────────────────────────────────────────────────────────────
function generateId(prefix) {
  return `${prefix}_${crypto.randomBytes(4).toString("hex")}`;
}

function requireAuth(req, res, next) {
  const auth = req.headers["authorization"] || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) return res.status(401).json({ error: "Missing Authorization header" });
  const decoded = Buffer.from(token, "base64").toString("utf8");
  if (decoded !== API_TOKEN) return res.status(403).json({ error: "Invalid token" });
  next();
}

async function fireWebhook(event, data) {
  if (!webhookUrl) return;
  const payload = { event, data, timestamp: new Date().toISOString() };
  try {
    const resp = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Webhook-Event": event },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000),
    });
    webhookLogs.unshift({
      id: generateId("whl"),
      direction: "outgoing",
      event,
      url: webhookUrl,
      status: resp.status,
      payload,
      respondedAt: new Date().toISOString(),
    });
  } catch (err) {
    webhookLogs.unshift({
      id: generateId("whl"),
      direction: "outgoing",
      event,
      url: webhookUrl,
      status: "error",
      error: err.message,
      payload,
      respondedAt: new Date().toISOString(),
    });
  }
  if (webhookLogs.length > 50) webhookLogs = webhookLogs.slice(0, 50);
}

// ─── PRODUCTS ────────────────────────────────────────────────────────────────
app.get("/api/products", requireAuth, (req, res) => {
  res.json({ data: products, total: products.length });
});

app.get("/api/products/:id", requireAuth, (req, res) => {
  const p = products.find((x) => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: "Product not found" });
  res.json(p);
});

app.post("/api/products", requireAuth, (req, res) => {
  const { name, price, stock = 0 } = req.body;
  if (!name || price == null) return res.status(400).json({ error: "name and price are required" });
  const product = {
    id: generateId("prod"),
    name,
    price: parseFloat(price),
    stock: parseInt(stock),
    createdAt: new Date().toISOString(),
  };
  products.push(product);
  fireWebhook("product.created", product);
  res.status(201).json(product);
});

app.put("/api/products/:id", requireAuth, (req, res) => {
  const idx = products.findIndex((x) => x.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Product not found" });
  products[idx] = { ...products[idx], ...req.body, id: products[idx].id };
  fireWebhook("product.updated", products[idx]);
  res.json(products[idx]);
});

app.delete("/api/products/:id", requireAuth, (req, res) => {
  const idx = products.findIndex((x) => x.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Product not found" });
  const [deleted] = products.splice(idx, 1);
  fireWebhook("product.deleted", deleted);
  res.json({ deleted: true, id: deleted.id });
});

// ─── INVOICES ────────────────────────────────────────────────────────────────
app.get("/api/invoices", requireAuth, (req, res) => {
  res.json({ data: invoices, total: invoices.length });
});

app.get("/api/invoices/:id", requireAuth, (req, res) => {
  const inv = invoices.find((x) => x.id === req.params.id);
  if (!inv) return res.status(404).json({ error: "Invoice not found" });
  res.json(inv);
});

app.post("/api/invoices", requireAuth, (req, res) => {
  const { customer, items, status = "pending" } = req.body;
  if (!customer || !items?.length) return res.status(400).json({ error: "customer and items[] required" });
  const total = items.reduce((sum, i) => sum + i.price * i.qty, 0);
  const invoice = {
    id: generateId("inv"),
    number: `INV-${String(++invoiceCounter).padStart(4, "0")}`,
    customer,
    items,
    total: Math.round(total * 100) / 100,
    status,
    createdAt: new Date().toISOString(),
  };
  invoices.push(invoice);
  fireWebhook("invoice.created", invoice);
  res.status(201).json(invoice);
});

app.patch("/api/invoices/:id/status", requireAuth, (req, res) => {
  const inv = invoices.find((x) => x.id === req.params.id);
  if (!inv) return res.status(404).json({ error: "Invoice not found" });
  inv.status = req.body.status || inv.status;
  fireWebhook("invoice.updated", inv);
  res.json(inv);
});

app.delete("/api/invoices/:id", requireAuth, (req, res) => {
  const idx = invoices.findIndex((x) => x.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Invoice not found" });
  const [deleted] = invoices.splice(idx, 1);
  fireWebhook("invoice.deleted", deleted);
  res.json({ deleted: true, id: deleted.id });
});

// ─── WEBHOOKS ────────────────────────────────────────────────────────────────
// Receive incoming webhooks (from external services pointing here)
app.post("/api/webhooks/receive", (req, res) => {
  const log = {
    id: generateId("whi"),
    direction: "incoming",
    event: req.headers["x-webhook-event"] || "unknown",
    headers: req.headers,
    payload: req.body,
    receivedAt: new Date().toISOString(),
  };
  webhookLogs.unshift(log);
  if (webhookLogs.length > 50) webhookLogs = webhookLogs.slice(0, 50);
  res.json({ received: true, id: log.id });
});

// Configure where to send outgoing webhooks
app.post("/api/webhooks/config", requireAuth, (req, res) => {
  webhookUrl = req.body.url || null;
  res.json({ webhookUrl });
});

app.get("/api/webhooks/config", requireAuth, (req, res) => {
  res.json({ webhookUrl });
});

// Webhook logs (no auth so UI can poll freely)
app.get("/api/webhooks/logs", (req, res) => {
  res.json({ data: webhookLogs, total: webhookLogs.length });
});

app.delete("/api/webhooks/logs", requireAuth, (req, res) => {
  webhookLogs = [];
  res.json({ cleared: true });
});

// ─── AUTH INFO (public endpoint to get the token) ───────────────────────────
app.get("/api/auth/token", (req, res) => {
  res.json({
    hint: "Use this as: Authorization: Bearer <encodedToken>",
    encodedToken: ENCODED_TOKEN,
    rawToken: API_TOKEN,
  });
});

// ─── HEALTH ─────────────────────────────────────────────────────────────────
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ─── SERVE UI ────────────────────────────────────────────────────────────────
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/index.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Dummy API running on http://localhost:${PORT}`));
module.exports = app;
