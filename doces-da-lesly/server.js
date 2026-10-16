require("dotenv").config();
const express = require("express");
const path = require("path");
const fs = require("fs/promises");
const crypto = require("crypto");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, "");
const ACCESS_TOKEN = process.env.MERCADOPAGO_ACCESS_TOKEN || "";
const DATA_DIR = path.join(__dirname, "data");
const ORDERS_FILE = path.join(DATA_DIR, "orders.json");

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

// Painel mínimo protegido por senha ainda não implementado: não exponha os pedidos
// publicamente. Para produção, adicionar autenticação e permissões administrativas.
app.get("/api/admin/orders", (_req, res) => {
  return res.status(501).json({ error: "Painel administrativo protegido será implementado em uma próxima etapa." });
});

app.get("*", (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

app.listen(PORT, () => {
  console.log(`Doces da Lesly rodando em ${BASE_URL}`);
  console.log(`Abra no navegador: http://localhost:${PORT}`);
});
