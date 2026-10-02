let currentStatus = 'all', menuData = null;

const $ = s => document.querySelector(s);
const money = n => `GH₵${Number(n).toFixed(2)}`;

async function api(url, opt = {}) {
  const r = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...(opt.headers || {})
    },
    ...opt
  });

  const d = await r.json().catch(() => ({}));

  if (!r.ok) throw new Error(d.error || 'Request failed');

  return d;
}

/* LOGIN */
$('#loginForm').onsubmit = async e => {
  e.preventDefault();
  $('#loginError').textContent = '';

  const f = new FormData(e.target);

  try {
    await api('/api/admin/login', {
      method: 'POST',
      body: JSON.stringify({
        username: f.get('username'),
        password: f.get('password')
      })
    });

    showApp();
  } catch (x) {
    $('#loginError').textContent = x.message;
  }
};

async function showApp() {
  try {
    await api('/api/admin/me');

    $('#loginView').hidden = true;
    $('#app').hidden = false;

    await Promise.all([
      loadOrders(),
      loadMenu(),
      loadSettings()
    ]);
  } catch {
    $('#loginView').hidden = false;
  }
}

/* LOGOUT */
$('#logout').onclick = async () => {
  await api('/api/admin/logout', {
    method: 'POST'
  });

  location.reload();
};

$('#refresh').onclick = loadOrders;

/* ORDERS */
function renderStatusTabs() {
  const statuses = [
    ['all', 'All'],
    ['new', 'New'],
    ['accepted', 'Accepted'],
    ['preparing', 'Preparing'],
    ['ready', 'Ready'],
    ['completed', 'Completed'],
    ['cancelled', 'Cancelled']
  ];

  $('#statusTabs').innerHTML = statuses.map(x =>
    `<button class="${currentStatus === x[0] ? 'active' : ''}" data-status="${x[0]}">${x[1]}</button>`
  ).join('');

  document.querySelectorAll('[data-status]').forEach(b => {
    b.onclick = () => {
      currentStatus = b.dataset.status;
      renderStatusTabs();
      loadOrders();
    };
  });
}

async function loadOrders() {
  renderStatusTabs();

  const q = currentStatus === 'all'
    ? ''
    : '?status=' + currentStatus;

  try {
    const orders = await api('/api/admin/orders' + q);

    $('#orders').innerHTML = orders.length
      ? orders.map(renderOrder).join('')
      : '<div class="order">No orders in this view.</div>';
  } catch (e) {
    $('#orders').innerHTML = `<div class="order">${e.message}</div>`;
  }
}

function renderOrder(o) {
  const next = {
    new: 'accepted',
    accepted: 'preparing',
    preparing: 'ready',
    ready: 'completed'
  }[o.status];

  return `
    <article class="order">
      <div class="order-head">
        <div>
          <div class="order-no">${o.order_no}</div>
          <div class="order-meta">
            ${esc(o.customer_name)} · ${esc(o.phone)} · ${o.order_type}
            ${o.address ? ' · ' + esc(o.address) : ''}
          </div>
        </div>

        <span class="badge">${o.status}</span>
      </div>

      <div class="order-items">
        ${o.items.map(i => `
          <div class="order-item">
            <span>${i.quantity} × ${esc(i.item_name)}</span>
            <b>${money(i.line_total)}</b>
          </div>
        `).join('')}
      </div>

      <div class="order-meta">
        Payment:
        ${o.payment_method === 'momo' ? 'Mobile Money' : 'Cash'}
        ${o.notes ? ' · Note: ' + esc(o.notes) : ''}
      </div>

      <div class="order-total">
        <span>Total</span>
        <span>${money(o.total)}</span>
      </div>

      <div class="order-actions">
        ${
          next
            ? `<button class="next" onclick="setStatus(${o.id},'${next}')">Mark ${next}</button>`
            : ''
        }

        ${
          o.status !== 'completed' && o.status !== 'cancelled'
            ? `<button onclick="setStatus(${o.id},'cancelled')">Cancel</button>`
            : ''
        }
      </div>
    </article>
  `;
}

window.setStatus = async (id, status) => {
  try {
    await api('/api/admin/orders/' + id + '/status', {
      method: 'PATCH',
      body: JSON.stringify({ status })
    });

    loadOrders();
  } catch (e) {
    alert(e.message);
  }
};

/* MENU */
async function loadMenu() {
  menuData = await api('/api/admin/menu');

  renderMenuAdmin();

  $('#categoryId').innerHTML = menuData.categories
    .map(c => `<option value="${c.id}">${esc(c.name)}</option>`)
    .join('');
}

function renderMenuAdmin() {
  $('#menuAdmin').innerHTML = `
    <div class="menu-admin">
      ${menuData.items.map(i => `
        <div class="menu-row">

          <div>
            <b>${esc(i.name)}</b>
            <small>
              ${esc(i.category)} ·
              ${esc(i.description || '')}
            </small>
          </div>

          <div>
            ${
              i.pricing_type === 'variable'
                ? `From ${money(i.min_price)}+`
                : money(i.price)
            }
          </div>

          <div>
            ${
              i.pricing_type === 'variable'
                ? 'Customer chooses price'
                : 'Fixed price'
            }
          </div>

          <div>
            ${i.available ? 'Available' : 'Hidden'}
          </div>

          <div>
            <button onclick="editItem(${i.id})">Edit</button>
          </div>

        </div>
      `).join('')}
    </div>
  `;
}

$('#newItem').onclick = () => openItem();

$('#closeItem').onclick = () =>
  $('#itemModal').classList.remove('open');

window.editItem = id => {
  const i = menuData.items.find(x => x.id === id);
  openItem(i);
};

function openItem(i) {
  const f = $('#itemForm');

  f.reset();

  f.id.value = i?.id || '';
  f.name.value = i?.name || '';
  f.description.value = i?.description || '';

  f.pricingType.value = i?.pricing_type || 'fixed';

  f.price.value =
    i?.pricing_type === 'variable'
      ? ''
      : (i?.price || '');

  f.minPrice.value =
    i?.pricing_type === 'variable'
      ? (i?.min_price || '')
      : '';

  f.categoryId.value =
    i?.category_id ||
    menuData.categories[0]?.id ||
    '';

  f.image.value = i?.image || '';

  f.available.checked =
    i ? !!i.available : true;

  $('#itemTitle').textContent =
    i ? 'Edit item' : 'Add item';

  updatePricingFields();

  $('#itemModal').classList.add('open');
}

/* PRICING TYPE */
function updatePricingFields() {
  const type = $('#pricingType').value;

  const fixed = $('#fixedPriceField');
  const minimum = $('#minimumPriceField');

  if (type === 'variable') {
    fixed.hidden = true;
    minimum.hidden = false;
  } else {
    fixed.hidden = false;
    minimum.hidden = true;
  }
}

$('#pricingType').onchange = updatePricingFields;

/* SAVE MENU ITEM */
$('#itemForm').onsubmit = async e => {
  e.preventDefault();

  $('#itemError').textContent = '';

  const f = new FormData(e.target);

  const pricingType = f.get('pricingType');

  const body = {
    name: f.get('name'),
    description: f.get('description'),

    pricingType,

    price:
      pricingType === 'fixed'
        ? f.get('price')
        : '0',

    minPrice:
      pricingType === 'variable'
        ? f.get('minPrice')
        : null,

    categoryId: Number(f.get('categoryId')),

    image: f.get('image'),

    available:
      f.get('available') === 'on'
  };

  try {
    if (f.get('id')) {
      await api(
        '/api/admin/menu/' + f.get('id'),
        {
          method: 'PATCH',
          body: JSON.stringify(body)
        }
      );
    } else {
      await api(
        '/api/admin/menu',
        {
          method: 'POST',
          body: JSON.stringify(body)
        }
      );
    }

    $('#itemModal').classList.remove('open');

    await loadMenu();

  } catch (x) {
    $('#itemError').textContent = x.message;
  }
};

/* SETTINGS */
async function loadSettings() {
  const s = await api('/api/admin/settings');

  const f = $('#settingsForm');

  for (const [k, v] of Object.entries(s)) {
    if (f.elements[k]) {
      f.elements[k].value = v;
    }
  }
}

$('#settingsForm').onsubmit = async e => {
  e.preventDefault();

  const f = new FormData(e.target);

  const body = Object.fromEntries(f.entries());

  try {
    await api('/api/admin/settings', {
      method: 'PATCH',
      body: JSON.stringify(body)
    });

    $('#settingsMsg').textContent = 'Saved.';

    setTimeout(() => {
      $('#settingsMsg').textContent = '';
    }, 2000);

  } catch (x) {
    $('#settingsMsg').textContent = x.message;
  }
};

/* ESCAPE HTML */
function esc(s) {
  return String(s ?? '').replace(
    /[&<>'"]/g,
    c => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[c])
  );
}

showApp();
