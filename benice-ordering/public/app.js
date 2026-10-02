const state = {
  store: null,
  cart: [],
  category: 'All'
};

const $ = s => document.querySelector(s);

const money = n =>
  `GH₵${Number(n).toFixed(2)}`;

async function api(url, opt = {}) {
  const r = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...(opt.headers || {})
    },
    ...opt
  });

  const d = await r.json().catch(() => ({}));

  if (!r.ok) {
    throw new Error(
      d.error || 'Something went wrong'
    );
  }

  return d;
}

function save() {
  localStorage.setItem(
    'benice_cart',
    JSON.stringify(state.cart)
  );
}

function load() {
  try {
    state.cart = JSON.parse(
      localStorage.getItem('benice_cart') || '[]'
    );
  } catch {
    state.cart = [];
  }
}

function cartCount() {
  return state.cart.reduce(
    (a, x) => a + x.qty,
    0
  );
}

function cartSubtotal() {
  return state.cart.reduce(
    (a, x) => a + x.price * x.qty,
    0
  );
}

function renderTabs() {
  const cats = [
    'All',
    ...new Set(
      state.store.menu.map(x => x.category)
    )
  ];

  $('#tabs').innerHTML = cats
    .map(
      c => `
        <button
          class="tab ${
            state.category === c
              ? 'active'
              : ''
          }"
          data-cat="${escapeHtml(c)}"
        >
          ${escapeHtml(c)}
        </button>
      `
    )
    .join('');

  document
    .querySelectorAll('.tab')
    .forEach(b => {
      b.onclick = () => {
        state.category = b.dataset.cat;
        render();
      };
    });
}

function renderMenu() {
  const items =
    state.category === 'All'
      ? state.store.menu
      : state.store.menu.filter(
          x => x.category === state.category
        );

  $('#menuGrid').innerHTML =
    items
      .map(x => {
        const isVariable =
          x.pricing_type === 'variable';

        const priceText = isVariable
          ? `From ${money(
              x.min_price ?? x.price
            )}+`
          : money(x.price);

        return `
          <article class="food-card">

            <div class="food-image">
              ${
                x.image
                  ? `
                    <img
                      src="${escapeAttr(x.image)}"
                      alt="${escapeAttr(x.name)}"
                    >
                  `
                  : `
                    <div class="food-placeholder">
                      🍽️
                    </div>
                  `
              }
            </div>

            <div class="food-body">

              <h3>
                ${escapeHtml(x.name)}
              </h3>

              <p>
                ${escapeHtml(
                  x.description ||
                    'Freshly prepared to order.'
                )}
              </p>

              <div class="food-bottom">

                <span class="price">
                  ${priceText}
                </span>

                <button
                  class="add"
                  data-add="${x.id}"
                >
                  ${
                    isVariable
                      ? 'Choose'
                      : 'Add +'
                  }
                </button>

              </div>

            </div>

          </article>
        `;
      })
      .join('') ||
    `
      <div class="loading">
        No items in this category yet.
      </div>
    `;

  document
    .querySelectorAll('[data-add]')
    .forEach(b => {
      b.onclick = () =>
        add(Number(b.dataset.add));
    });
}

/*
  ADD ITEM

  Fixed item:
    Add immediately.

  Variable item:
    Ask customer for the amount first.
*/
function add(id) {
  const item =
    state.store.menu.find(
      x => x.id === id
    );

  if (!item) return;

  if (
    item.pricing_type ===
    'variable'
  ) {
    openPriceModal(item);
    return;
  }

  addFixedItem(item);
}

function addFixedItem(item) {
  const found =
    state.cart.find(
      x => x.id === item.id
    );

  if (found) {
    found.qty++;
  } else {
    state.cart.push({
      id: item.id,
      name: item.name,
      price: Number(item.price),
      qty: 1,
      pricingType: 'fixed'
    });
  }

  save();
  renderCart();
  openCart();
}

/*
  VARIABLE PRICE ITEM

  Customer enters their own amount.
*/
function openPriceModal(item) {
  const minimum = Number(
    item.min_price ?? item.price ?? 0
  );

  const existing =
    document.querySelector(
      '#priceEntryModal'
    );

  if (existing) {
    existing.remove();
  }

  const modal =
    document.createElement('div');

  modal.id = 'priceEntryModal';

  modal.className = 'modal open';

  modal.setAttribute(
    'aria-hidden',
    'false'
  );

  modal.innerHTML = `
    <div class="modal-card">

      <button
        class="modal-close"
        id="priceModalClose"
        type="button"
        aria-label="Close"
      >
        ×
      </button>

      <h2>
        ${escapeHtml(item.name)}
      </h2>

      <p>
        Enter the amount you want to spend.
      </p>

      <p>
        Minimum amount:
        <strong>${money(minimum)}</strong>
      </p>

      <label
        for="customerPrice"
        style="
          display:block;
          margin:16px 0 6px;
          font-weight:600;
        "
      >
        Amount
      </label>

      <div
        style="
          display:flex;
          align-items:center;
          gap:8px;
          border:1px solid #ddd;
          border-radius:10px;
          padding:0 12px;
        "
      >

        <span>GH₵</span>

        <input
          id="customerPrice"
          type="number"
          min="${minimum}"
          step="0.01"
          placeholder="${minimum.toFixed(2)}"
          inputmode="decimal"
          style="
            width:100%;
            border:0;
            outline:0;
            padding:14px 4px;
            font-size:18px;
          "
        >

      </div>

      <div
        id="priceEntryError"
        style="
          color:#b42318;
          margin-top:8px;
          min-height:20px;
        "
      ></div>

      <button
        id="confirmCustomerPrice"
        type="button"
        class="checkout-btn"
        style="
          width:100%;
          margin-top:12px;
        "
      >
        Add to Cart
      </button>

    </div>
  `;

  document.body.appendChild(modal);

  const input =
    modal.querySelector(
      '#customerPrice'
    );

  const error =
    modal.querySelector(
      '#priceEntryError'
    );

  input.focus();

  function close() {
    modal.remove();
  }

  modal
    .querySelector('#priceModalClose')
    .onclick = close;

  modal.addEventListener(
    'click',
    e => {
      if (e.target === modal) {
        close();
      }
    }
  );

  modal
    .querySelector(
      '#confirmCustomerPrice'
    )
    .onclick = () => {
      const amount =
        Number(input.value);

      if (
        !Number.isFinite(amount) ||
        amount < minimum
      ) {
        error.textContent =
          `Please enter at least ${money(
            minimum
          )}.`;

        input.focus();
        return;
      }

      const price =
        Math.round(amount * 100) / 100;

      /*
        If the same variable item with
        the same customer price already
        exists in the cart, increase qty.

        Different prices remain separate
        cart lines.
      */
      const found =
        state.cart.find(
          x =>
            x.id === item.id &&
            x.price === price
        );

      if (found) {
        found.qty++;
      } else {
        state.cart.push({
          id: item.id,
          name: item.name,
          price,
          qty: 1,
          pricingType: 'variable',
          minPrice: minimum
        });
      }

      save();
      renderCart();
      close();
      openCart();
    };

  input.addEventListener(
    'keydown',
    e => {
      if (e.key === 'Enter') {
        modal
          .querySelector(
            '#confirmCustomerPrice'
          )
          .click();
      }
    }
  );
}

function change(id, delta, price = null) {
  const x =
    state.cart.find(i => {
      if (i.id !== id) return false;

      if (
        price !== null &&
        i.price !== price
      ) {
        return false;
      }

      return true;
    });

  if (!x) return;

  x.qty += delta;

  if (x.qty <= 0) {
    const index =
      state.cart.indexOf(x);

    state.cart.splice(index, 1);
  }

  save();
  renderCart();
}

function renderCart() {
  const count =
    cartCount();

  $('#cartCount').textContent =
    count;

  $('#cartItems').innerHTML =
    state.cart.length
      ? state.cart
          .map(
            x => `
              <div class="cart-row">

                <div>
                  <h4>
                    ${escapeHtml(x.name)}
                  </h4>

                  <small>
                    ${money(x.price)} each
                  </small>
                </div>

                <div class="qty">

                  <button
                    data-q="${x.id}"
                    data-price="${x.price}"
                    data-d="-1"
                  >
                    −
                  </button>

                  <b>
                    ${x.qty}
                  </b>

                  <button
                    data-q="${x.id}"
                    data-price="${x.price}"
                    data-d="1"
                  >
                    +
                  </button>

                </div>

              </div>
            `
          )
          .join('')
      : `
        <div class="loading">
          Your cart is empty.
        </div>
      `;

  document
    .querySelectorAll('[data-q]')
    .forEach(b => {
      b.onclick = () =>
        change(
          Number(b.dataset.q),
          Number(b.dataset.d),
          Number(b.dataset.price)
        );
    });

  const sub =
    cartSubtotal();

  const delivery =
    state.store &&
    state.store.settings
      ? Number(
          state.store.settings
            .delivery_fee || 0
        )
      : 0;

  $('#subtotal').textContent =
    money(sub);

  $('#deliveryFee').textContent =
    state.cart.length
      ? money(delivery)
      : '—';

  $('#total').textContent =
    money(
      sub +
        (state.cart.length
          ? delivery
          : 0)
    );

  $('#checkoutTotal').textContent =
    money(
      sub +
        (state.cart.length
          ? delivery
          : 0)
    );

  $('#checkoutBtn').disabled =
    !state.cart.length;
}

function openCart() {
  $('#cartDrawer').classList.add(
    'open'
  );

  $('#cartDrawer').setAttribute(
    'aria-hidden',
    'false'
  );
}

function closeCart() {
  $('#cartDrawer').classList.remove(
    'open'
  );

  $('#cartDrawer').setAttribute(
    'aria-hidden',
    'true'
  );
}

function openModal(id) {
  $(id).classList.add('open');

  $(id).setAttribute(
    'aria-hidden',
    'false'
  );
}

function closeModal(id) {
  $(id).classList.remove(
    'open'
  );

  $(id).setAttribute(
    'aria-hidden',
    'true'
  );
}

function render() {
  renderTabs();
  renderMenu();
  renderCart();

  const s =
    state.store.settings;

  $('#address').textContent =
    s.address || '—';

  $('#hours').textContent =
    s.opening_hours || '—';

  $('#phone').textContent =
    s.restaurant_phone || '—';

  $('#openStatus').textContent =
    (
      s.opening_status ||
      'Open'
    ).toUpperCase();

  document.title =
    s.restaurant_name ||
    'Be-nice Special Kitchen';
}

$('#cartBtn').onclick =
  openCart;

$('#closeCart').onclick =
  closeCart;

$('#checkoutBtn').onclick =
  () => {
    if (!state.cart.length)
      return;

    closeCart();

    openModal(
      '#checkoutModal'
    );
  };

$('#closeCheckout').onclick =
  () =>
    closeModal(
      '#checkoutModal'
    );

$('#doneBtn').onclick =
  () =>
    closeModal(
      '#successModal'
    );

document.querySelector(
  'input[name="orderType"][value="delivery"]'
).onchange =
  toggleAddress;

document.querySelector(
  'input[name="orderType"][value="pickup"]'
).onchange =
  toggleAddress;

function toggleAddress() {
  const selected =
    document.querySelector(
      'input[name="orderType"]:checked'
    );

  if (!selected) return;

  const delivery =
    selected.value === 'delivery';

  $('#addressField').style.display =
    delivery
      ? 'grid'
      : 'none';
}

/*
  WHATSAPP CHECKOUT

  The customer fills the checkout form.
  Instead of sending the order to the
  website backend, we build the complete
  order message and send it directly
  to WhatsApp.

  TEST NUMBER:
  233540319990

  Later replace this number with the
  restaurant's real WhatsApp number.
*/
$('#checkoutForm').onsubmit =
  async e => {
    e.preventDefault();

    $('#formError').textContent =
      '';

    if (!state.cart.length) {
      $('#formError').textContent =
        'Your cart is empty.';
      return;
    }

    const f =
      new FormData(e.target);

    const name =
      String(
        f.get('name') || ''
      ).trim();

    const phone =
      String(
        f.get('phone') || ''
      ).trim();

    const orderType =
      String(
        f.get('orderType') ||
          'delivery'
      );

    const address =
      String(
        f.get('address') || ''
      ).trim();

    const paymentMethod =
      String(
        f.get('paymentMethod') ||
          'cash'
      );

    const notes =
      String(
        f.get('notes') || ''
      ).trim();

    if (!name || !phone) {
      $('#formError').textContent =
        'Please enter your name and phone number.';
      return;
    }

    if (
      orderType === 'delivery' &&
      !address
    ) {
      $('#formError').textContent =
        'Please enter your delivery address.';
      return;
    }

    /*
      Calculate subtotal using the exact
      prices stored in the cart.

      This is important for variable-price
      items such as Fufu, Banku and Kokonte.
    */
    const subtotal =
      state.cart.reduce(
        (sum, item) =>
          sum +
          Number(item.price || 0) *
            Number(item.qty || 0),
        0
      );

    /*
      Delivery fee is only charged for
      delivery orders.

      Pickup = GH₵0 delivery.
    */
    const deliveryFee =
      orderType === 'delivery'
        ? Number(
            state.store?.settings
              ?.delivery_fee || 0
          )
        : 0;

    const total =
      subtotal + deliveryFee;

    /*
      Build the WhatsApp order message.
    */
    const lines = [
      '*🍽️ BE-NICE SPECIAL KITCHEN*',
      '*NEW ORDER*',
      '',
      `Customer: ${name}`,
      `Phone: ${phone}`,
      `Order Type: ${
        orderType === 'delivery'
          ? 'Delivery'
          : 'Pickup'
      }`
    ];

    if (
      orderType === 'delivery'
    ) {
      lines.push(
        `Address: ${address}`
      );
    }

    lines.push(
      '',
      '*ORDER ITEMS*'
    );

    state.cart.forEach(item => {
      const qty =
        Number(item.qty || 0);

      const price =
        Number(item.price || 0);

      const lineTotal =
        price * qty;

      lines.push(
        `${qty} × ${item.name} — ${money(
          lineTotal
        )}`
      );
    });

    lines.push(
      '',
      `Subtotal: ${money(subtotal)}`,
      `Delivery: ${money(deliveryFee)}`,
      `*TOTAL: ${money(total)}*`,
      '',
      `Payment: ${
        paymentMethod === 'momo'
          ? 'Mobile Money'
          : 'Cash'
      }`
    );

    if (notes) {
      lines.push(
        `Notes: ${notes}`
      );
    }

    lines.push(
      '',
      'Please confirm my order. Thank you!'
    );

    const message =
      lines.join('\n');

    /*
      WhatsApp number.

      IMPORTANT:
      This is currently the TEST number:
      233540319990

      Change it later to the restaurant's
      real WhatsApp number.
    */
    const whatsappNumber =
      '233540319990';

    const whatsappUrl =
      `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(
        message
      )}`;

    const btn =
      e.target.querySelector(
        'button[type=submit]'
      );

    btn.disabled = true;

    btn.textContent =
      'Opening WhatsApp…';

    /*
      Clear the cart because the order
      is now being sent to WhatsApp.
    */
    state.cart = [];

    save();

    closeModal(
      '#checkoutModal'
    );

    renderCart();

    e.target.reset();

    toggleAddress();

    /*
      Open WhatsApp in a new tab.

      If the browser blocks the popup,
      redirect the current page to WhatsApp.
    */
    const whatsappWindow =
      window.open(
        whatsappUrl,
        '_blank'
      );

    if (!whatsappWindow) {
      window.location.href =
        whatsappUrl;
      return;
    }

    btn.disabled = false;

    btn.textContent =
      'Send Order on WhatsApp';
  };

function escapeHtml(s) {
  return String(s).replace(
    /[&<>'"]/g,
    c =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;'
      }[c])
  );
}

function escapeAttr(s) {
  return escapeHtml(s);
}

(async function () {
  load();

  try {
    state.store =
      await api(
        '/api/store'
      );

    render();

  } catch (e) {
    $('#menuGrid').innerHTML = `
      <div class="loading">
        Could not load the menu.
        Please refresh.
      </div>
    `;
  }
})();

$('#year').textContent =
  new Date().getFullYear();