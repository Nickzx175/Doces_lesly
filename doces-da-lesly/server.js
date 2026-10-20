require("dotenv").config();
const express = require("express");
const path = require("path");
const fs = require("fs/promises");
const crypto = require("crypto");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, "");
const ACCESS_TOKEN = process.env.MERCADOPAGO_ACCESS_TOKEN || "";
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const DATA_DIR = path.join(__dirname, "data");
const ORDERS_FILE = path.join(DATA_DIR, "orders.json");
const CREDIT_FILE = path.join(DATA_DIR, "credit-sales.json");

app.use(express.json({ limit: "100kb" }));
app.use(express.static(path.join(__dirname, "public")));

const PRODUCTS = [
  { id: "brigadeiro", name: "Brigadeiro Tradicional", price: 4.00, category: "Brigadeiros", emoji: "🍫", description: "Chocolate e granulado, clássico e delicioso." },
  { id: "ninho", name: "Brigadeiro de Ninho", price: 4.50, category: "Brigadeiros", emoji: "🍥", description: "Cremoso, feito com leite em pó." },
  { id: "cupcake", name: "Cupcake de Chocolate", price: 7.00, category: "Cupcakes", emoji: "🧁", description: "Massa fofinha com cobertura cremosa." },
  { id: "bolo", name: "Bolo de Chocolate", price: 65.00, category: "Bolos", emoji: "🎂", description: "Bolo para compartilhar. Confirme o tamanho com a loja." },
  { id: "trufa", name: "Trufa Gourmet", price: 5.00, category: "Trufas", emoji: "🍬", description: "Chocolate com recheio cremoso." },
  { id: "brownie", name: "Brownie", price: 8.00, category: "Bolos", emoji: "🍪", description: "Brownie macio com muito chocolate." },
  { id: "caixa6", name: "Caixa com 6 brigadeiros", price: 22.00, category: "Kits", emoji: "🎁", description: "Uma caixinha para presentear." },
  { id: "morango", name: "Cupcake de Morango", price: 7.50, category: "Cupcakes", emoji: "🍓", description: "Cobertura delicada com sabor de morango." }
];

async function ensureStore() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try { await fs.access(ORDERS_FILE); }
  catch { await fs.writeFile(ORDERS_FILE, "[]", "utf8"); }
  try { await fs.access(CREDIT_FILE); }
  catch { await fs.writeFile(CREDIT_FILE, "[]", "utf8"); }
}
async function readOrders() {
  await ensureStore();
  return JSON.parse(await fs.readFile(ORDERS_FILE, "utf8"));
}
async function writeOrders(orders) {
  await ensureStore();
  await fs.writeFile(ORDERS_FILE, JSON.stringify(orders, null, 2), "utf8");
}
function money(n) { return Number(n).toFixed(2); }

async function readCreditSales() {
  await ensureStore();
  return JSON.parse(await fs.readFile(CREDIT_FILE, "utf8"));
}
async function writeCreditSales(sales) {
  await ensureStore();
  await fs.writeFile(CREDIT_FILE, JSON.stringify(sales, null, 2), "utf8");
}
function adminAuth(req, res, next) {
  if (!ADMIN_PASSWORD) {
    return res.status(503).send("Painel administrativo desativado. Configure ADMIN_PASSWORD nas variáveis de ambiente do Render.");
  }
  const header = req.headers.authorization || "";
  const [scheme, encoded] = header.split(" ");
  if (scheme !== "Basic" || !encoded) {
    res.set("WWW-Authenticate", 'Basic realm="Doces da Lesly - Administração", charset="UTF-8"');
    return res.status(401).send("Autenticação necessária.");
  }
  let decoded = "";
  try { decoded = Buffer.from(encoded, "base64").toString("utf8"); } catch {}
  const separator = decoded.indexOf(":");
  const username = separator >= 0 ? decoded.slice(0, separator) : "";
  const password = separator >= 0 ? decoded.slice(separator + 1) : "";
  const safeEqual = (a, b) => {
    const aa = Buffer.from(String(a)); const bb = Buffer.from(String(b));
    return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
  };
  if (!safeEqual(username, ADMIN_USER) || !safeEqual(password, ADMIN_PASSWORD)) {
    res.set("WWW-Authenticate", 'Basic realm="Doces da Lesly - Administração", charset="UTF-8"');
    return res.status(401).send("Usuário ou senha incorretos.");
  }
  next();
}
function creditTotals(sale) {
  const paid = (sale.payments || []).reduce((sum, p) => sum + Number(p.amount || 0), 0);
  return { paid: Number(paid.toFixed(2)), balance: Number(Math.max(0, sale.amount - paid).toFixed(2)) };
}


app.get("/api/health", (_req, res) => res.json({ ok: true, store: "Doces da Lesly" }));
app.get("/api/products", (_req, res) => res.json(PRODUCTS));

app.post("/api/orders", async (req, res) => {
  try {
    const { customer, items, delivery, address, notes, paymentMethod } = req.body || {};
    if (!customer || !customer.name || !customer.phone) {
      return res.status(400).json({ error: "Informe nome e telefone." });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "Seu carrinho está vazio." });
    }
    if (!["Entrega", "Retirada"].includes(delivery)) {
      return res.status(400).json({ error: "Escolha entrega ou retirada." });
    }
    if (delivery === "Entrega" && (!address || !address.trim())) {
      return res.status(400).json({ error: "Informe o endereço de entrega." });
    }
    if (!["pix", "card"].includes(paymentMethod)) {
      return res.status(400).json({ error: "Forma de pagamento inválida." });
    }

    // Recalcula os preços no servidor. Nunca confia nos valores enviados pelo navegador.
    const normalizedItems = [];
    for (const item of items) {
      const product = PRODUCTS.find(p => p.id === String(item.productId));
      const quantity = Number(item.quantity);
      if (!product || !Number.isInteger(quantity) || quantity < 1 || quantity > 50) {
        return res.status(400).json({ error: "Um dos produtos ou quantidades é inválido." });
      }
      normalizedItems.push({ productId: product.id, name: product.name, unitPrice: product.price, quantity });
    }
    const total = normalizedItems.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
    const order = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      status: "aguardando_pagamento",
      paymentStatus: "pending",
      paymentMethod,
      customer: {
        name: String(customer.name).trim().slice(0, 100),
        phone: String(customer.phone).trim().slice(0, 30)
      },
      delivery,
      address: delivery === "Entrega" ? String(address).trim().slice(0, 300) : "",
      notes: String(notes || "").trim().slice(0, 500),
      items: normalizedItems,
      total: Number(money(total)),
      paymentUrl: null,
      paymentId: null
    };

    const orders = await readOrders();
    orders.unshift(order);
    await writeOrders(orders);

    if (!ACCESS_TOKEN) {
      return res.status(201).json({
        orderId: order.id,
        total: order.total,
        paymentConfigured: false,
        message: "Pedido salvo em modo de demonstração. Configure o Mercado Pago para cobrar de verdade."
      });
    }

    // Checkout Pro hospeda os dados de pagamento no Mercado Pago; o site não recebe dados do cartão.
    const preferencePayload = {
      items: normalizedItems.map(item => ({
        id: item.productId,
        title: item.name,
        quantity: item.quantity,
        currency_id: "BRL",
        unit_price: item.unitPrice
      })),
      external_reference: order.id,
      notification_url: `${BASE_URL}/api/payments/webhook`,
      back_urls: {
        success: `${BASE_URL}/?payment=success&order=${encodeURIComponent(order.id)}`,
        pending: `${BASE_URL}/?payment=pending&order=${encodeURIComponent(order.id)}`,
        failure: `${BASE_URL}/?payment=failure&order=${encodeURIComponent(order.id)}`
      },
      auto_return: "approved",
      metadata: { order_id: order.id },
      statement_descriptor: "DOCES DA LESLY"
    };

    const mpResponse = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${ACCESS_TOKEN}`,
        "Content-Type": "application/json",
        "X-Idempotency-Key": order.id
      },
      body: JSON.stringify(preferencePayload)
    });
    const mpData = await mpResponse.json().catch(() => ({}));
    if (!mpResponse.ok || !mpData.init_point) {
      console.error("Mercado Pago preference error:", mpData);
      return res.status(502).json({
        orderId: order.id,
        error: "O pedido foi salvo, mas não conseguimos iniciar o pagamento. Verifique as credenciais do Mercado Pago."
      });
    }

    order.paymentUrl = mpData.init_point;
    order.preferenceId = mpData.id;
    await writeOrders(orders.map(o => o.id === order.id ? order : o));
    return res.status(201).json({
      orderId: order.id,
      total: order.total,
      paymentConfigured: true,
      paymentUrl: mpData.init_point,
      message: "Pedido criado. Você será encaminhado ao checkout seguro."
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Erro interno ao criar pedido." });
  }
});

// Endpoint básico para notificações. Em produção, valide a assinatura do webhook
// conforme a documentação atual do Mercado Pago antes de confiar em notificações.
app.post("/api/payments/webhook", async (req, res) => {
  try {
    const paymentId = req.query["data.id"] || req.body?.data?.id;
    const type = req.query.type || req.body?.type;
    if (type !== "payment" || !paymentId) return res.sendStatus(200);
    if (!ACCESS_TOKEN) return res.sendStatus(200);

    const response = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`, {
      headers: { "Authorization": `Bearer ${ACCESS_TOKEN}` }
    });
    if (!response.ok) return res.sendStatus(200);
    const payment = await response.json();
    const orderId = payment.external_reference;
    if (!orderId) return res.sendStatus(200);

    const orders = await readOrders();
    const updated = orders.map(order => {
      if (order.id !== orderId) return order;
      return {
        ...order,
        paymentId: String(payment.id),
        paymentStatus: payment.status || "unknown",
        status: payment.status === "approved" ? "pago" :
          payment.status === "rejected" ? "pagamento_recusado" : "aguardando_pagamento"
      };
    });
    await writeOrders(updated);
    return res.sendStatus(200);
  } catch (err) {
    console.error("Webhook error:", err);
    return res.sendStatus(200);
  }
});


// Painel privado de vendas a prazo. Protegido por autenticação HTTP Basic.
// Configure ADMIN_USER e uma senha forte em Environment no Render.
app.get("/admin", adminAuth, (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

app.get("/api/admin/credit-sales", adminAuth, async (req, res) => {
  try {
    const from = String(req.query.from || "");
    const to = String(req.query.to || "");
    const query = String(req.query.q || "").trim().toLocaleLowerCase("pt-BR");
    const sales = await readCreditSales();
    const filtered = sales.filter(sale => {
      const day = sale.saleDate;
      return (!from || day >= from) && (!to || day <= to) &&
        (!query || sale.customer.toLocaleLowerCase("pt-BR").includes(query) ||
          sale.description.toLocaleLowerCase("pt-BR").includes(query));
    }).map(sale => ({ ...sale, ...creditTotals(sale) }))
      .sort((a, b) => b.saleDate.localeCompare(a.saleDate));
    const totals = filtered.reduce((acc, sale) => {
      acc.amount += sale.amount; acc.paid += sale.paid; acc.balance += sale.balance;
      return acc;
    }, { amount: 0, paid: 0, balance: 0 });
    Object.keys(totals).forEach(k => totals[k] = Number(totals[k].toFixed(2)));
    res.json({ sales: filtered, totals });
  } catch (err) {
    console.error(err); res.status(500).json({ error: "Não foi possível carregar as vendas." });
  }
});

app.post("/api/admin/credit-sales", adminAuth, async (req, res) => {
  try {
    const body = req.body || {};
    const customer = String(body.customer || "").trim().slice(0, 120);
    const description = String(body.description || "").trim().slice(0, 300);
    const saleDate = String(body.saleDate || "");
    const dueDate = String(body.dueDate || "");
    const amount = Number(body.amount);
    const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
    if (!customer || !description || !validDate(saleDate) || !validDate(dueDate) ||
        !Number.isFinite(amount) || amount <= 0 || amount > 10000000) {
      return res.status(400).json({ error: "Informe cliente, descrição, datas válidas e valor maior que zero." });
    }
    const sale = {
      id: crypto.randomUUID(), customer, description, saleDate, dueDate,
      amount: Number(amount.toFixed(2)), payments: [], createdAt: new Date().toISOString()
    };
    const sales = await readCreditSales();
    sales.push(sale);
    await writeCreditSales(sales);
    res.status(201).json({ sale: { ...sale, ...creditTotals(sale) } });
  } catch (err) {
    console.error(err); res.status(500).json({ error: "Não foi possível registrar a venda." });
  }
});

app.post("/api/admin/credit-sales/:id/payments", adminAuth, async (req, res) => {
  try {
    const amount = Number(req.body?.amount);
    const date = String(req.body?.date || new Date().toISOString().slice(0, 10));
    if (!Number.isFinite(amount) || amount <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: "Informe um valor de pagamento válido e a data." });
    }
    const sales = await readCreditSales();
    const index = sales.findIndex(s => s.id === req.params.id);
    if (index < 0) return res.status(404).json({ error: "Venda não encontrada." });
    const totals = creditTotals(sales[index]);
    if (amount > totals.balance + 0.001) return res.status(400).json({ error: "O pagamento é maior que o saldo devedor." });
    sales[index].payments.push({ id: crypto.randomUUID(), amount: Number(amount.toFixed(2)), date, createdAt: new Date().toISOString() });
    await writeCreditSales(sales);
    res.json({ sale: { ...sales[index], ...creditTotals(sales[index]) } });
  } catch (err) {
    console.error(err); res.status(500).json({ error: "Não foi possível registrar o pagamento." });
  }
});


app.get("*", (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Doces da Lesly rodando em ${BASE_URL}`);
  console.log(`Abra no navegador: http://localhost:${PORT}`);
});
