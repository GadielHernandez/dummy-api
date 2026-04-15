const express = require('express')
const crypto = require('crypto')
const path = require('path')
const { put, getDownloadUrl, list, del } = require('@vercel/blob')

const app = express()
app.use(express.json())
app.use(express.static(path.join(__dirname, '../public')))

// ─── CONFIG ────────────────────────────────────────────────────────────────
const API_TOKEN = process.env.API_TOKEN || 'dummy-secret-token-2024'
const ENCODED_TOKEN = Buffer.from(API_TOKEN).toString('base64')

// ─── VERCEL BLOB HELPERS ────────────────────────────────────────────────────
// Each "store" is a JSON file in Blob, identified by a fixed pathname.
// We use `addRandomSuffix: false` so the pathname stays stable across writes.

const BLOBS = {
    products: 'dummy-api/products.json',
    invoices: 'dummy-api/invoices.json',
    webhooks: 'dummy-api/webhooks.json',
}

const DEFAULTS = {
    products: {
        products: [
            {
                id: 'prod_1',
                name: 'Widget Pro',
                price: 99.99,
                stock: 50,
                createdAt: new Date().toISOString(),
            },
            {
                id: 'prod_2',
                name: 'Gadget Basic',
                price: 29.99,
                stock: 200,
                createdAt: new Date().toISOString(),
            },
            {
                id: 'prod_3',
                name: 'Super Doohickey',
                price: 149.0,
                stock: 15,
                createdAt: new Date().toISOString(),
            },
        ],
    },
    invoices: {
        counter: 2,
        invoices: [
            {
                id: 'inv_1',
                number: 'INV-0001',
                customer: 'Acme Corp',
                items: [{ name: 'Widget Pro', qty: 2, price: 99.99 }],
                total: 199.98,
                status: 'paid',
                createdAt: new Date().toISOString(),
            },
            {
                id: 'inv_2',
                number: 'INV-0002',
                customer: 'Globex Inc',
                items: [{ name: 'Gadget Basic', qty: 5, price: 29.99 }],
                total: 149.95,
                status: 'pending',
                createdAt: new Date().toISOString(),
            },
        ],
    },
    webhooks: { webhookUrl: null, logs: [] },
}

async function blobRead(key) {
    // List blobs to find the exact URL for this pathname
    const { blobs } = await list({ prefix: BLOBS[key] })
    if (!blobs.length) {
        // First time — seed with default data
        await blobWrite(key, DEFAULTS[key])
        return DEFAULTS[key]
    }
    const r = await fetch(blobs[0].downloadUrl)
    if (!r.ok) throw new Error(`Blob read failed: ${r.status}`)
    return r.json()
}

async function blobWrite(key, data) {
    await put(BLOBS[key], JSON.stringify(data), {
        access: 'public',
        addRandomSuffix: false,
        contentType: 'application/json',
        allowOverwrite: true,
    })
    return data
}

// ─── AUTH HELPERS ────────────────────────────────────────────────────────────
function generateId(prefix) {
    return `${prefix}_${crypto.randomBytes(4).toString('hex')}`
}

function requireAuth(req, res, next) {
    const auth = req.headers['authorization'] || ''
    const token = auth.replace(/^Bearer\s+/i, '').trim()
    if (!token)
        return res.status(401).json({ error: 'Missing Authorization header' })
    const decoded = Buffer.from(token, 'base64').toString('utf8')
    if (decoded !== API_TOKEN)
        return res.status(403).json({ error: 'Invalid token' })
    next()
}

// ─── WEBHOOK FIRE ───────────────────────────────────────────────────────────
async function fireWebhook(event, data) {
    let store
    try {
        store = await blobRead('webhooks')
    } catch {
        store = { logs: [], webhookUrl: null }
    }
    const { webhookUrl, logs = [] } = store

    if (webhookUrl) {
        const payload = { event, data, timestamp: new Date().toISOString() }
        try {
            const resp = await fetch(webhookUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Webhook-Event': event,
                },
                body: JSON.stringify(payload),
                signal: AbortSignal.timeout(5000),
            })
            logs.unshift({
                id: generateId('whl'),
                direction: 'outgoing',
                event,
                url: webhookUrl,
                status: resp.status,
                payload,
                respondedAt: new Date().toISOString(),
            })
        } catch (err) {
            logs.unshift({
                id: generateId('whl'),
                direction: 'outgoing',
                event,
                url: webhookUrl,
                status: 'error',
                error: err.message,
                payload,
                respondedAt: new Date().toISOString(),
            })
        }
        await blobWrite('webhooks', {
            webhookUrl,
            logs: logs.slice(0, 50),
        }).catch(() => {})
    }
}

// ─── PRODUCTS ────────────────────────────────────────────────────────────────
app.get('/api/products', requireAuth, async (req, res) => {
    try {
        const { products } = await blobRead('products')
        res.json({ data: products, total: products.length })
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

app.get('/api/products/:id', requireAuth, async (req, res) => {
    try {
        const { products } = await blobRead('products')
        const p = products.find((x) => x.id === req.params.id)
        if (!p) return res.status(404).json({ error: 'Product not found' })
        res.json(p)
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

app.post('/api/products', requireAuth, async (req, res) => {
    try {
        const { name, price, stock = 0 } = req.body
        if (!name || price == null)
            return res
                .status(400)
                .json({ error: 'name and price are required' })
        const store = await blobRead('products')
        const product = {
            id: generateId('prod'),
            name,
            price: parseFloat(price),
            stock: parseInt(stock),
            createdAt: new Date().toISOString(),
        }
        store.products.push(product)
        await blobWrite('products', store)
        fireWebhook('product.created', product).catch(() => {})
        res.status(201).json(product)
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

app.put('/api/products/:id', requireAuth, async (req, res) => {
    try {
        const store = await blobRead('products')
        const idx = store.products.findIndex((x) => x.id === req.params.id)
        if (idx === -1)
            return res.status(404).json({ error: 'Product not found' })
        store.products[idx] = {
            ...store.products[idx],
            ...req.body,
            id: store.products[idx].id,
        }
        await blobWrite('products', store)
        fireWebhook('product.updated', store.products[idx]).catch(() => {})
        res.json(store.products[idx])
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

app.delete('/api/products/:id', requireAuth, async (req, res) => {
    try {
        const store = await blobRead('products')
        const idx = store.products.findIndex((x) => x.id === req.params.id)
        if (idx === -1)
            return res.status(404).json({ error: 'Product not found' })
        const [deleted] = store.products.splice(idx, 1)
        await blobWrite('products', store)
        fireWebhook('product.deleted', deleted).catch(() => {})
        res.json({ deleted: true, id: deleted.id })
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

// ─── INVOICES ────────────────────────────────────────────────────────────────
app.get('/api/invoices', requireAuth, async (req, res) => {
    try {
        const { invoices } = await blobRead('invoices')
        res.json({ data: invoices, total: invoices.length })
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

app.get('/api/invoices/:id', requireAuth, async (req, res) => {
    try {
        const { invoices } = await blobRead('invoices')
        const inv = invoices.find((x) => x.id === req.params.id)
        if (!inv) return res.status(404).json({ error: 'Invoice not found' })
        res.json(inv)
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

app.post('/api/invoices', requireAuth, async (req, res) => {
    try {
        const { customer, items, status = 'pending' } = req.body
        if (!customer || !items?.length)
            return res
                .status(400)
                .json({ error: 'customer and items[] required' })
        const store = await blobRead('invoices')
        const total = items.reduce((sum, i) => sum + i.price * i.qty, 0)
        const invoice = {
            id: generateId('inv'),
            number: `INV-${String(store.counter + 1).padStart(4, '0')}`,
            customer,
            items,
            total: Math.round(total * 100) / 100,
            status,
            createdAt: new Date().toISOString(),
        }
        store.invoices.push(invoice)
        store.counter = (store.counter || 0) + 1
        await blobWrite('invoices', store)
        fireWebhook('invoice.created', invoice).catch(() => {})
        res.status(201).json(invoice)
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

app.patch('/api/invoices/:id/status', requireAuth, async (req, res) => {
    try {
        const store = await blobRead('invoices')
        const inv = store.invoices.find((x) => x.id === req.params.id)
        if (!inv) return res.status(404).json({ error: 'Invoice not found' })
        inv.status = req.body.status || inv.status
        await blobWrite('invoices', store)
        fireWebhook('invoice.updated', inv).catch(() => {})
        res.json(inv)
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

app.delete('/api/invoices/:id', requireAuth, async (req, res) => {
    try {
        const store = await blobRead('invoices')
        const idx = store.invoices.findIndex((x) => x.id === req.params.id)
        if (idx === -1)
            return res.status(404).json({ error: 'Invoice not found' })
        const [deleted] = store.invoices.splice(idx, 1)
        await blobWrite('invoices', store)
        fireWebhook('invoice.deleted', deleted).catch(() => {})
        res.json({ deleted: true, id: deleted.id })
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

// ─── WEBHOOKS ────────────────────────────────────────────────────────────────
app.post('/api/webhooks/receive', async (req, res) => {
    try {
        let store
        try {
            store = await blobRead('webhooks')
        } catch {
            store = { logs: [], webhookUrl: null }
        }
        const log = {
            id: generateId('whi'),
            direction: 'incoming',
            event: req.headers['x-webhook-event'] || 'unknown',
            headers: req.headers,
            payload: req.body,
            receivedAt: new Date().toISOString(),
        }
        store.logs = [log, ...(store.logs || [])].slice(0, 50)
        await blobWrite('webhooks', store)
        res.json({ received: true, id: log.id })
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

app.post('/api/webhooks/config', requireAuth, async (req, res) => {
    try {
        let store
        try {
            store = await blobRead('webhooks')
        } catch {
            store = { logs: [], webhookUrl: null }
        }
        store.webhookUrl = req.body.url || null
        await blobWrite('webhooks', store)
        res.json({ webhookUrl: store.webhookUrl })
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

app.get('/api/webhooks/config', requireAuth, async (req, res) => {
    try {
        let store
        try {
            store = await blobRead('webhooks')
        } catch {
            store = { logs: [], webhookUrl: null }
        }
        res.json({ webhookUrl: store.webhookUrl })
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

app.get('/api/webhooks/logs', async (req, res) => {
    try {
        let store
        try {
            store = await blobRead('webhooks')
        } catch {
            store = { logs: [] }
        }
        res.json({ data: store.logs || [], total: (store.logs || []).length })
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

app.delete('/api/webhooks/logs', requireAuth, async (req, res) => {
    try {
        let store
        try {
            store = await blobRead('webhooks')
        } catch {
            store = { webhookUrl: null }
        }
        store.logs = []
        await blobWrite('webhooks', store)
        res.json({ cleared: true })
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

// ─── AUTH INFO ───────────────────────────────────────────────────────────────
app.get('/api/auth/token', (req, res) => {
    res.json({
        hint: 'Use as: Authorization: Bearer <encodedToken>',
        encodedToken: ENCODED_TOKEN,
        rawToken: API_TOKEN,
    })
})

// ─── HEALTH ──────────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// ─── SERVE UI ────────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'))
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () =>
    console.log(`🚀 Dummy API running on http://localhost:${PORT}`),
)
module.exports = app
