const state = { products: [], cart: {}, category: "Todos" };
const $ = (selector) => document.querySelector(selector);
const brl = (n) => Number(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

async function loadProducts() {
  try {
    const response = await fetch("/api/products");
    if (!response.ok) throw new Error("Não foi possível carregar os produtos.");
    state.products = await response.json();
    renderCategories();
    renderProducts();
  } catch (error) {
    $("#products").innerHTML = `<p>${escapeHtml(error.message)} Atualize a página para tentar novamente.</p>`;
  }
}
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}
function renderCategories() {
  const categories = ["Todos", ...new Set(state.products.map(p => p.category))];
  $("#categories").innerHTML = categories.map(cat =>
    `<button class="cat ${cat === state.category ? "active" : ""}" data-category="${escapeHtml(cat)}">${escapeHtml(cat)}</button>`
  ).join("");
  $("#categories").querySelectorAll("button").forEach(button => button.addEventListener("click", () => {
    state.category = button.dataset.category;
    renderCategories();
    renderProducts();
  }));
}
function renderProducts() {
  const list = state.products.filter(p => state.category === "Todos" || p.category === state.category);
  $("#result-count").textContent = `${list.length} opções`;
  $("#products").innerHTML = list.map(p => `
    <article class="product">
      <div class="product-art" aria-hidden="true">${p.emoji}</div>
      <div class="product-body">
        <h3>${escapeHtml(p.name)}</h3><div class="desc">${escapeHtml(p.description)}</div>
        <div class="price">${brl(p.price)}</div>
        <button class="btn full" data-add="${p.id}">＋ Adicionar</button>
      </div>
    </article>`).join("");
  $("#products").querySelectorAll("[data-add]").forEach(button => button.addEventListener("click", () => add(button.dataset.add)));
}
function add(id) { state.cart[id] = (state.cart[id] || 0) + 1; updateCartCount(); }
function change(id, amount) {
  state.cart[id] = (state.cart[id] || 0) + amount;
  if (state.cart[id] <= 0) delete state.cart[id];
  updateCartCount(); renderCart();
}
function updateCartCount() {
  $("#cart-count").textContent = Object.values(state.cart).reduce((sum, q) => sum + q, 0);
}
function cartItems() {
  return state.products.filter(p => state.cart[p.id]).map(p => ({ product: p, quantity: state.cart[p.id] }));
}
function cartTotal() { return cartItems().reduce((sum, item) => sum + item.product.price * item.quantity, 0); }
function renderCart() {
  const items = cartItems();
  if (!items.length) {
    $("#cart-items").innerHTML = '<div class="empty">Seu carrinho está vazio.<br>Escolha um docinho para começar 💗</div>';
    $("#cart-summary").innerHTML = "";
    return;
  }
  $("#cart-items").innerHTML = items.map(({ product: p, quantity }) => `
    <div class="cart-line"><div class="mini-art">${p.emoji}</div>
      <div class="line-info"><strong>${escapeHtml(p.name)}</strong><small>${brl(p.price)} cada</small></div>
      <div class="qty"><button type="button" aria-label="Diminuir" data-minus="${p.id}">−</button><b>${quantity}</b><button type="button" aria-label="Aumentar" data-plus="${p.id}">+</button></div>
    </div>`).join("");
  $("#cart-items").querySelectorAll("[data-minus]").forEach(b => b.addEventListener("click", () => change(b.dataset.minus, -1)));
  $("#cart-items").querySelectorAll("[data-plus]").forEach(b => b.addEventListener("click", () => change(b.dataset.plus, 1)));
  $("#cart-summary").innerHTML = `<div class="totalrow"><span>Subtotal dos produtos</span><strong>${brl(cartTotal())}</strong></div><div class="totalrow"><span>Entrega</span><span>A combinar</span></div><div class="totalrow grand"><span>Total dos produtos</span><span>${brl(cartTotal())}</span></div>`;
}
function openCart() {
  $("#overlay").classList.add("show");
  $("#overlay").setAttribute("aria-hidden", "false");
  $("#form-message").textContent = "";
  renderCart();
}
function closeCart() {
  $("#overlay").classList.remove("show");
  $("#overlay").setAttribute("aria-hidden", "true");
}
$("#open-cart").addEventListener("click", openCart);
$("#open-cart-2").addEventListener("click", openCart);
$("#close-cart").addEventListener("click", closeCart);
$("#overlay").addEventListener("click", event => { if (event.target === $("#overlay")) closeCart(); });
$("#shop-now").addEventListener("click", () => $("#catalogo").scrollIntoView({ behavior: "smooth" }));
$("#delivery").addEventListener("change", event => {
  const pickup = event.target.value === "Retirada";
  $("#address-label").style.display = pickup ? "none" : "grid";
  $("#address").required = !pickup;
});
$("#checkout-form").addEventListener("submit", async event => {
  event.preventDefault();
  const message = $("#form-message");
  message.className = "form-message";
  message.textContent = "";
  if (!cartItems().length) {
    message.classList.add("error"); message.textContent = "Adicione pelo menos um doce ao carrinho."; return;
  }
  const form = new FormData(event.currentTarget);
  const payload = {
    customer: { name: form.get("name"), phone: form.get("phone") },
    delivery: form.get("delivery"),
    address: form.get("address"),
    notes: form.get("notes"),
    paymentMethod: form.get("paymentMethod"),
    items: cartItems().map(({ product, quantity }) => ({ productId: product.id, quantity }))
  };
  const button = $("#submit-order");
  button.disabled = true; button.textContent = "Preparando pedido...";
  try {
    const response = await fetch("/api/orders", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload)
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Não foi possível criar o pedido.");
    if (result.paymentUrl) {
      message.classList.add("ok");
      message.textContent = "Pedido criado! Abrindo checkout seguro...";
      window.location.href = result.paymentUrl;
      return;
    }
    message.classList.add("ok");
    message.textContent = `${result.message} Número do pedido: ${result.orderId}. Total: ${brl(result.total)}.`;
    state.cart = {}; updateCartCount(); renderCart();
  } catch (error) {
    message.classList.add("error");
    message.textContent = error.message;
  } finally {
    button.disabled = false; button.textContent = "Finalizar pedido";
  }
});

const params = new URLSearchParams(window.location.search);
if (params.get("payment")) {
  const paymentMessage = params.get("payment") === "success" ? "O checkout retornou como sucesso. Aguarde a confirmação oficial do pagamento." :
    params.get("payment") === "pending" ? "Pagamento pendente. A loja precisa aguardar a confirmação." :
    "O pagamento não foi concluído.";
  window.addEventListener("load", () => alert(paymentMessage));
}
loadProducts();
