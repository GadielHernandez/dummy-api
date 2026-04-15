# 🧪 Dummy API — Test Dashboard

A minimal but complete API server for testing integrations: invoices, products, Base64 auth, and webhooks.

## Features
- REST API with Bearer Base64 token auth
- CRUD for **Invoices** and **Products**
- **Outgoing webhooks**: fires events when resources are created/updated/deleted
- **Incoming webhook receiver**: any service can POST to `/api/webhooks/receive`
- Live dashboard UI with auto-polling (3s)

---

## 🚀 Deploy to Vercel (recommended, free)

### Option A — Vercel CLI
```bash
npm i -g vercel
cd dummy-api
vercel          # follow prompts, that's it
```

### Option B — GitHub + Vercel dashboard
1. Push this folder to a GitHub repo
2. Go to [vercel.com](https://vercel.com) → New Project → import your repo
3. No build settings needed — just deploy
4. (Optional) Add `API_TOKEN` env var in Vercel dashboard → Settings → Environment Variables

---

## 🌐 Deploy to Netlify

Netlify requires serverless function format. Use Vercel instead for simplest setup.

---

## 🏃 Run locally
```bash
npm install
npm run dev      # or: npm start
# open http://localhost:3000
```

---

## 🔐 Authentication

All protected endpoints need:
```
Authorization: Bearer <base64-encoded-token>
```

The raw token is `dummy-secret-token-2024`.  
Base64 of that: `ZHVtbXktc2VjcmV0LXRva2VuLTIwMjQ=`

The dashboard's **API Reference** tab shows the exact header to use.

To change the token: set the `API_TOKEN` environment variable.

---

## 📡 Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/auth/token` | — | Get the encoded token |
| GET | `/api/products` | ✓ | List products |
| POST | `/api/products` | ✓ | Create product |
| PUT | `/api/products/:id` | ✓ | Update product |
| DELETE | `/api/products/:id` | ✓ | Delete product |
| GET | `/api/invoices` | ✓ | List invoices |
| POST | `/api/invoices` | ✓ | Create invoice |
| PATCH | `/api/invoices/:id/status` | ✓ | Update status |
| DELETE | `/api/invoices/:id` | ✓ | Delete invoice |
| POST | `/api/webhooks/receive` | — | Receive incoming webhook |
| GET | `/api/webhooks/logs` | — | View all webhook logs |
| POST | `/api/webhooks/config` | ✓ | Set outgoing webhook URL |
| GET | `/api/health` | — | Health check |

---

## 🔗 Webhook Testing

**Outgoing:** Set a URL (e.g. from [webhook.site](https://webhook.site)) in the Webhooks tab. Every create/update/delete operation will POST to it.

**Incoming:** Your service can POST to `https://your-domain/api/webhooks/receive`. The UI shows all received payloads in real time.
