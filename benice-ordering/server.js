require('dotenv').config();
const path = require('path');
const fs = require('fs');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Database = require('better-sqlite3');
const { nanoid } = require('nanoid');

const app = express();

// Fix for GitHub Codespaces / reverse proxy
app.set('trust proxy', 1);

const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = path.join(__dirname, 'data');

fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_FILE =
  process.env.DB_FILE ||
  path.join(DATA_DIR, 'benice.db');

const db = new Database(DB_FILE);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

app.use(
  helmet({
    contentSecurityPolicy: false
  })
);

app.use(
  express.json({
    limit: '100kb'
  })
);

app.use(cookieParser());

app.use(
  express.static(
    path.join(__dirname, 'public')
  )
);

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false
});

const orderLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 25,
  standardHeaders: true,
  legacyHeaders: false
});

app.use('/api/', apiLimiter);

function now() {
  return new Date().toISOString();
}

function money(n) {
  return Math.round(Number(n) * 100) / 100;
}

function clean(v, max = 500) {
  return String(v ?? '')
    .trim()
    .slice(0, max);
}

function validPhone(v) {
  return /^[0-9+\s()-]{7,20}$/.test(v);
}

function validPricingType(value) {
  return value === 'variable'
    ? 'variable'
    : 'fixed';
}

function validMoney(value) {
  const n = Number(value);

  return (
    Number.isFinite(n) &&
    n >= 0
  );
}

function auth(req, res, next) {
  try {
    const token =
      req.cookies.benice_admin;

    if (!token) {
      return res
        .status(401)
        .json({
          error: 'Unauthorized'
        });
    }

    const payload = jwt.verify(
      token,
      process.env.SESSION_SECRET ||
        'dev-secret-change-me'
    );

    if (payload.role !== 'admin') {
      throw new Error('bad role');
    }

    req.admin = payload;

    next();
  } catch {
    return res
      .status(401)
      .json({
        error: 'Unauthorized'
      });
  }
}

function orderNumber() {
  const date = new Date();

  const stamp = date
    .toISOString()
    .slice(0, 10)
    .replaceAll('-', '');

  return `BN-${stamp}-${Math.floor(
    1000 + Math.random() * 9000
  )}`;
}

function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      sort_order INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS menu_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      price REAL NOT NULL,
      image TEXT DEFAULT '',
      available INTEGER DEFAULT 1,
      sort_order INTEGER DEFAULT 0,
      FOREIGN KEY(category_id) REFERENCES categories(id) ON DELETE RESTRICT
    );

    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_no TEXT NOT NULL UNIQUE,
      customer_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      order_type TEXT NOT NULL CHECK(order_type IN ('delivery','pickup')),
      address TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      payment_method TEXT NOT NULL CHECK(payment_method IN ('cash','momo')),
      subtotal REAL NOT NULL,
      delivery_fee REAL NOT NULL,
      total REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'new'
        CHECK(status IN ('new','accepted','preparing','ready','completed','cancelled')),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      menu_item_id INTEGER NOT NULL,
      item_name TEXT NOT NULL,
      unit_price REAL NOT NULL,
      quantity INTEGER NOT NULL,
      line_total REAL NOT NULL,
      FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE
    );
  `);

  /*
    Add variable-pricing support to existing menu items.

    Existing items automatically become:
      pricing_type = fixed
      min_price = NULL
  */

  const menuColumns = db
    .prepare(
      `PRAGMA table_info(menu_items)`
    )
    .all();

  const hasPricingType =
    menuColumns.some(
      column =>
        column.name === 'pricing_type'
    );

  const hasMinPrice =
    menuColumns.some(
      column =>
        column.name === 'min_price'
    );

  if (!hasPricingType) {
    db.exec(`
      ALTER TABLE menu_items
      ADD COLUMN pricing_type TEXT NOT NULL DEFAULT 'fixed'
    `);
  }

  if (!hasMinPrice) {
    db.exec(`
      ALTER TABLE menu_items
      ADD COLUMN min_price REAL
    `);
  }

  const defaults = {
    restaurant_name:
      process.env.RESTAURANT_NAME ||
      'Be-nice Special Kitchen',

    restaurant_phone:
      process.env.RESTAURANT_PHONE ||
      '',

    whatsapp:
      process.env.RESTAURANT_WHATSAPP ||
      '',

    delivery_fee:
      process.env.DELIVERY_FEE ||
      '10',

    currency:
      process.env.CURRENCY ||
      'GHS',

    opening_status:
      'Open',

    address:
      'Add restaurant address in Admin → Settings',

    opening_hours:
      'Mon–Sun · 10:00 AM – 9:00 PM'
  };

  const insertSetting = db.prepare(
    'INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)'
  );

  const tx = db.transaction(() =>
    Object.entries(defaults).forEach(
      ([k, v]) =>
        insertSetting.run(
          k,
          String(v)
        )
    )
  );

  tx();

  /*
    Create sample menu only if the database
    does not already contain categories.
  */

  if (
    db
      .prepare(
        'SELECT COUNT(*) AS c FROM categories'
      )
      .get().c === 0
  ) {
    const addCat = db.prepare(
      'INSERT INTO categories(name,sort_order) VALUES(?,?)'
    );

    [
      'Main Meals',
      'Sides',
      'Drinks',
      'Extras'
    ].forEach((x, i) =>
      addCat.run(x, i)
    );

    const cats = Object.fromEntries(
      db
        .prepare(
          'SELECT id,name FROM categories'
        )
        .all()
        .map(x => [
          x.name,
          x.id
        ])
    );

    const add = db.prepare(`
      INSERT INTO menu_items
      (
        category_id,
        name,
        description,
        price,
        image,
        available,
        sort_order,
        pricing_type,
        min_price
      )
      VALUES(?,?,?,?,?,?,?,?,?)
    `);

    add.run(
      cats['Main Meals'],
      'Jollof Rice + Chicken',
      'Replace this sample item with the restaurant menu.',
      35,
      '',
      1,
      0,
      'fixed',
      null
    );

    add.run(
      cats['Main Meals'],
      'Fried Rice + Chicken',
      'Replace this sample item with the restaurant menu.',
      35,
      '',
      1,
      1,
      'fixed',
      null
    );

    add.run(
      cats['Sides'],
      'Fried Plantain',
      'Freshly prepared side.',
      15,
      '',
      1,
      0,
      'fixed',
      null
    );

    add.run(
      cats['Drinks'],
      'Soft Drink',
      'Chilled soft drink.',
      8,
      '',
      1,
      0,
      'fixed',
      null
    );
  }
}

initDb();

function getSettings() {
  return Object.fromEntries(
    db
      .prepare(
        'SELECT key,value FROM settings'
      )
      .all()
      .map(x => [
        x.key,
        x.value
      ])
  );
}

function getMenu() {
  return db
    .prepare(`
      SELECT
        m.id,
        m.name,
        m.description,
        m.price,
        m.pricing_type,
        m.min_price,
        m.image,
        m.available,
        m.sort_order,
        c.name category,
        c.id category_id
      FROM menu_items m
      JOIN categories c
        ON c.id = m.category_id
      WHERE m.available = 1
      ORDER BY
        c.sort_order,
        c.name,
        m.sort_order,
        m.name
    `)
    .all();
}

function getFullOrder(id) {
  const order = db
    .prepare(
      'SELECT * FROM orders WHERE id=?'
    )
    .get(id);

  if (!order) return null;

  order.items = db
    .prepare(`
      SELECT
        menu_item_id,
        item_name,
        unit_price,
        quantity,
        line_total
      FROM order_items
      WHERE order_id=?
      ORDER BY id
    `)
    .all(id);

  return order;
}

app.get(
  '/api/store',
  (req, res) => {
    res.json({
      settings: getSettings(),
      menu: getMenu()
    });
  }
);

/*
  CREATE CUSTOMER ORDER
*/

app.post(
  '/api/orders',
  orderLimiter,
  (req, res) => {
    try {
      const name = clean(
        req.body.name,
        100
      );

      const phone = clean(
        req.body.phone,
        30
      );

      const orderType =
        req.body.orderType === 'pickup'
          ? 'pickup'
          : 'delivery';

      const address = clean(
        req.body.address,
        300
      );

      const notes = clean(
        req.body.notes,
        500
      );

      const paymentMethod =
        req.body.paymentMethod === 'momo'
          ? 'momo'
          : 'cash';

      const rawItems =
        Array.isArray(req.body.items)
          ? req.body.items
          : [];

      if (name.length < 2) {
        return res.status(400).json({
          error:
            'Enter a valid name.'
        });
      }

      if (!validPhone(phone)) {
        return res.status(400).json({
          error:
            'Enter a valid phone number.'
        });
      }

      if (
        orderType === 'delivery' &&
        address.length < 5
      ) {
        return res.status(400).json({
          error:
            'Enter a delivery address.'
        });
      }

      if (
        !rawItems.length ||
        rawItems.length > 50
      ) {
        return res.status(400).json({
          error:
            'Your order is empty.'
        });
      }

      const ids = [
        ...new Set(
          rawItems
            .map(x => Number(x.id))
            .filter(
              Number.isInteger
            )
        )
      ];

      const placeholders =
        ids
          .map(() => '?')
          .join(',');

      const menu =
        ids.length
          ? db
              .prepare(`
                SELECT
                  id,
                  name,
                  price,
                  pricing_type,
                  min_price
                FROM menu_items
                WHERE id IN (${placeholders})
                AND available=1
              `)
              .all(...ids)
          : [];

      const byId = new Map(
        menu.map(x => [
          x.id,
          x
        ])
      );

      /*
        IMPORTANT:
        The server decides the real price.

        Fixed item:
          Client cannot change the price.

        Variable item:
          Client must provide a valid amount
          greater than or equal to min_price.
      */

      const items = [];

      for (const raw of rawItems) {
        const item =
          byId.get(
            Number(raw.id)
          );

        if (!item) {
          continue;
        }

        const quantity = Math.max(
          1,
          Math.min(
            20,
            Number(raw.quantity) || 1
          )
        );

        let unitPrice;

        if (
          item.pricing_type ===
          'variable'
        ) {
          const enteredPrice =
            money(raw.price);

          const minimum =
            money(
              item.min_price ??
                item.price
            );

          if (
            !Number.isFinite(
              enteredPrice
            ) ||
            enteredPrice < minimum
          ) {
            return res.status(400).json({
              error:
                `${item.name} must be at least GH₵${minimum.toFixed(2)}.`
            });
          }

          unitPrice =
            enteredPrice;
        } else {
          /*
            Fixed-price item:
            ignore any price supplied
            by the browser.
          */

          unitPrice =
            money(item.price);
        }

        items.push({
          item,
          quantity,
          unitPrice
        });
      }

      if (!items.length) {
        return res.status(400).json({
          error:
            'The selected food is no longer available.'
        });
      }

      const subtotal = money(
        items.reduce(
          (sum, x) =>
            sum +
            x.unitPrice *
              x.quantity,
          0
        )
      );

      const settings =
        getSettings();

      const deliveryFee = 0;

const total = subtotal;

      const orderNo =
        orderNumber();

      const tx =
        db.transaction(() => {
          const result =
            db
              .prepare(`
                INSERT INTO orders(
                  order_no,
                  customer_name,
                  phone,
                  order_type,
                  address,
                  notes,
                  payment_method,
                  subtotal,
                  delivery_fee,
                  total,
                  status,
                  created_at
                )
                VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
              `)
              .run(
                orderNo,
                name,
                phone,
                orderType,
                address,
                notes,
                paymentMethod,
                subtotal,
                deliveryFee,
                total,
                'new',
                now()
              );

          const orderId =
            result.lastInsertRowid;

          const insert =
            db.prepare(`
              INSERT INTO order_items(
                order_id,
                menu_item_id,
                item_name,
                unit_price,
                quantity,
                line_total
              )
              VALUES(?,?,?,?,?,?)
            `);

          items.forEach(x => {
            insert.run(
              orderId,
              x.item.id,
              x.item.name,
              x.unitPrice,
              x.quantity,
              money(
                x.unitPrice *
                  x.quantity
              )
            );
          });

          return Number(
            orderId
          );
        });

      const order =
  getFullOrder(orderId);

      const whatsapp =
        clean(
          settings.whatsapp,
          30
        ).replace(/\D/g, '');

      res.status(201).json({
        order,
        whatsapp,
        whatsappUrl: whatsapp
          ? buildWhatsAppUrl(
              order,
              whatsapp
            )
          : ''
      });
    } catch (e) {
      console.error(e);

      res.status(500).json({
        error:
          'Could not place the order.'
      });
    }
  }
);

function buildWhatsAppUrl(
  order,
  number
) {
  const lines = [
    `*NEW ORDER ${order.order_no}*`,
    `Customer: ${order.customer_name}`,
    `Phone: ${order.phone}`,
    `Type: ${order.order_type}`,

    order.address
      ? `Address: ${order.address}`
      : '',

    '',

    ...order.items.map(
      i =>
        `${i.quantity} × ${i.item_name} — GH₵${i.line_total.toFixed(2)}`
    ),

    '',

    `Subtotal: GH₵${order.subtotal.toFixed(2)}`,

    order.order_type === 'delivery'
  ? 'Delivery: To be confirmed by restaurant'
  : 'Delivery: GH₵0.00',

    `*Total: GH₵${order.total.toFixed(2)}*`,

    `Payment: ${
      order.payment_method === 'momo'
        ? 'Mobile Money'
        : 'Cash'
    }`,

    order.notes
      ? `Notes: ${order.notes}`
      : ''
  ]
    .filter(Boolean)
    .join('\n');

  return `https://wa.me/${number}?text=${encodeURIComponent(
    lines
  )}`;
}

/*
  ADMIN LOGIN
*/

app.post(
  '/api/admin/login',
  rateLimit({
    windowMs:
      10 * 60 * 1000,
    limit: 10
  }),
  async (req, res) => {
    const username =
      clean(
        req.body.username,
        100
      );

    const password =
      String(
        req.body.password || ''
      );

    const expectedUser =
      process.env.ADMIN_USERNAME ||
      'admin';

    const expectedPass =
      process.env.ADMIN_PASSWORD ||
      'change-me';

    const ok =
      username ===
        expectedUser &&
      await bcrypt.compare(
        password,
        await bcrypt.hash(
          expectedPass,
          10
        )
      );

    if (!ok) {
      return res
        .status(401)
        .json({
          error:
            'Invalid username or password.'
        });
    }

    const token =
      jwt.sign(
        {
          role: 'admin',
          username
        },
        process.env.SESSION_SECRET ||
          'dev-secret-change-me',
        {
          expiresIn: '12h'
        }
      );

    res.cookie(
      'benice_admin',
      token,
      {
        httpOnly: true,
        sameSite: 'lax',
        secure:
          process.env.NODE_ENV ===
          'production',
        maxAge:
          12 *
          60 *
          60 *
          1000
      }
    );

    res.json({
      ok: true
    });
  }
);

/*
  ADMIN LOGOUT
*/

app.post(
  '/api/admin/logout',
  (req, res) => {
    res.clearCookie(
      'benice_admin'
    );

    res.json({
      ok: true
    });
  }
);

/*
  CURRENT ADMIN
*/

app.get(
  '/api/admin/me',
  auth,
  (req, res) => {
    res.json({
      username:
        req.admin.username
    });
  }
);

/*
  ADMIN ORDERS
*/

app.get(
  '/api/admin/orders',
  auth,
  (req, res) => {
    const status =
      clean(
        req.query.status,
        30
      );

    const orders =
      status &&
      [
        'new',
        'accepted',
        'preparing',
        'ready',
        'completed',
        'cancelled'
      ].includes(status)
        ? db
            .prepare(
              'SELECT * FROM orders WHERE status=? ORDER BY id DESC LIMIT 300'
            )
            .all(status)
        : db
            .prepare(
              'SELECT * FROM orders ORDER BY id DESC LIMIT 300'
            )
            .all();

    orders.forEach(o => {
      o.items =
        db
          .prepare(`
            SELECT
              menu_item_id,
              item_name,
              unit_price,
              quantity,
              line_total
            FROM order_items
            WHERE order_id=?
          `)
          .all(o.id);
    });

    res.json(
      orders
    );
  }
);

/*
  UPDATE ORDER STATUS
*/

app.patch(
  '/api/admin/orders/:id/status',
  auth,
  (req, res) => {
    const status =
      clean(
        req.body.status,
        30
      );

    if (
      ![
        'new',
        'accepted',
        'preparing',
        'ready',
        'completed',
        'cancelled'
      ].includes(status)
    ) {
      return res
        .status(400)
        .json({
          error:
            'Invalid status.'
        });
    }

    const result =
      db
        .prepare(
          'UPDATE orders SET status=? WHERE id=?'
        )
        .run(
          status,
          Number(
            req.params.id
          )
        );

    if (!result.changes) {
      return res
        .status(404)
        .json({
          error:
            'Order not found.'
        });
    }

    res.json(
      getFullOrder(
        Number(
          req.params.id
        )
      )
    );
  }
);

/*
  ADMIN MENU
*/

app.get(
  '/api/admin/menu',
  auth,
  (req, res) => {
    const rows =
      db
        .prepare(`
          SELECT
            m.*,
            c.name category
          FROM menu_items m
          JOIN categories c
            ON c.id=m.category_id
          ORDER BY
            c.sort_order,
            c.name,
            m.sort_order,
            m.name
        `)
        .all();

    const categories =
      db
        .prepare(
          'SELECT * FROM categories ORDER BY sort_order,name'
        )
        .all();

    res.json({
      items: rows,
      categories
    });
  }
);

/*
  CREATE MENU ITEM
*/

app.post(
  '/api/admin/menu',
  auth,
  (req, res) => {
    const name =
      clean(
        req.body.name,
        100
      );

    const description =
      clean(
        req.body.description,
        300
      );

    const pricingType =
      validPricingType(
        req.body.pricingType
      );

    const categoryId =
      Number(
        req.body.categoryId
      );

    const image =
      clean(
        req.body.image,
        500
      );

    if (
      !name ||
      !Number.isInteger(
        categoryId
      )
    ) {
      return res.status(400).json({
        error:
          'Name and category are required.'
      });
    }

    let price;
    let minPrice = null;

    if (
      pricingType ===
      'variable'
    ) {
      minPrice = money(
        req.body.minPrice
      );

      if (
        !Number.isFinite(
          minPrice
        ) ||
        minPrice <= 0
      ) {
        return res.status(400).json({
          error:
            'A valid minimum price is required for variable-price items.'
        });
      }

      /*
        Keep price equal to the minimum
        for backwards compatibility with
        existing code.
      */
      price = minPrice;
    } else {
      price = money(
        req.body.price
      );

      if (
        !Number.isFinite(
          price
        ) ||
        price < 0
      ) {
        return res.status(400).json({
          error:
            'A valid price is required.'
        });
      }
    }

    const r =
      db
        .prepare(`
          INSERT INTO menu_items(
            category_id,
            name,
            description,
            price,
            image,
            available,
            sort_order,
            pricing_type,
            min_price
          )
          VALUES(?,?,?,?,?,?,?,?,?)
        `)
        .run(
          categoryId,
          name,
          description,
          price,
          image,
          1,
          0,
          pricingType,
          minPrice
        );

    res.status(201).json(
      db
        .prepare(
          'SELECT * FROM menu_items WHERE id=?'
        )
        .get(
          r.lastInsertRowid
        )
    );
  }
);

/*
  UPDATE MENU ITEM
*/

app.patch(
  '/api/admin/menu/:id',
  auth,
  (req, res) => {
    const id =
      Number(
        req.params.id
      );

    const existing =
      db
        .prepare(
          'SELECT * FROM menu_items WHERE id=?'
        )
        .get(id);

    if (!existing) {
      return res
        .status(404)
        .json({
          error:
            'Item not found.'
        });
    }

    const name =
      clean(
        req.body.name ??
          existing.name,
        100
      );

    const description =
      clean(
        req.body.description ??
          existing.description,
        300
      );

    const pricingType =
      req.body.pricingType ===
      undefined
        ? validPricingType(
            existing.pricing_type
          )
        : validPricingType(
            req.body.pricingType
          );

    const image =
      clean(
        req.body.image ??
          existing.image,
        500
      );

    const categoryId =
      Number(
        req.body.categoryId ??
          existing.category_id
      );

    const available =
      req.body.available ===
      undefined
        ? existing.available
        : req.body.available
          ? 1
          : 0;

    let price;
    let minPrice;

    if (
      pricingType ===
      'variable'
    ) {
      minPrice =
        req.body.minPrice ===
        undefined
          ? existing.min_price ??
            existing.price
          : money(
              req.body.minPrice
            );

      minPrice =
        money(minPrice);

      if (
        !Number.isFinite(
          minPrice
        ) ||
        minPrice <= 0
      ) {
        return res.status(400).json({
          error:
            'A valid minimum price is required for variable-price items.'
        });
      }

      /*
        Store minimum price in price too
        for backwards compatibility.
      */
      price = minPrice;
    } else {
      price =
        req.body.price ===
        undefined
          ? money(
              existing.price
            )
          : money(
              req.body.price
            );

      if (
        !Number.isFinite(
          price
        ) ||
        price < 0
      ) {
        return res.status(400).json({
          error:
            'A valid price is required.'
        });
      }

      minPrice = null;
    }

    if (
      !name ||
      !Number.isInteger(
        categoryId
      )
    ) {
      return res.status(400).json({
        error:
          'Name and category are required.'
      });
    }

    db.prepare(`
      UPDATE menu_items
      SET
        category_id=?,
        name=?,
        description=?,
        price=?,
        image=?,
        available=?,
        pricing_type=?,
        min_price=?
      WHERE id=?
    `).run(
      categoryId,
      name,
      description,
      price,
      image,
      available,
      pricingType,
      minPrice,
      id
    );

    res.json(
      db
        .prepare(
          'SELECT * FROM menu_items WHERE id=?'
        )
        .get(id)
    );
  }
);

/*
  DELETE / HIDE MENU ITEM
*/

app.delete(
  '/api/admin/menu/:id',
  auth,
  (req, res) => {
    const id =
      Number(
        req.params.id
      );

    db
      .prepare(
        'UPDATE menu_items SET available=0 WHERE id=?'
      )
      .run(id);

    res.json({
      ok: true
    });
  }
);

/*
  ADMIN SETTINGS
*/

app.get(
  '/api/admin/settings',
  auth,
  (req, res) => {
    res.json(
      getSettings()
    );
  }
);

app.patch(
  '/api/admin/settings',
  auth,
  (req, res) => {
    const allowed = [
      'restaurant_name',
      'restaurant_phone',
      'whatsapp',
      'delivery_fee',
      'currency',
      'opening_status',
      'address',
      'opening_hours'
    ];

    const stmt =
      db.prepare(`
        INSERT INTO settings(key,value)
        VALUES(?,?)
        ON CONFLICT(key)
        DO UPDATE SET value=excluded.value
      `);

    const tx =
      db.transaction(() =>
        allowed.forEach(k => {
          if (
            req.body[k] !==
            undefined
          ) {
            stmt.run(
              k,
              clean(
                req.body[k],
                500
              )
            );
          }
        })
      );

    tx();

    res.json(
      getSettings()
    );
  }
);

/*
  HEALTH CHECK
*/

app.get(
  '/health',
  (req, res) =>
    res.json({
      ok: true,
      time: now()
    })
);

/*
  FRONTEND
*/

app.get(
  '*',
  (req, res) =>
    res.sendFile(
      path.join(
        __dirname,
        'public',
        'index.html'
      )
    )
);

/*
  START SERVER
*/

app.listen(
  PORT,
  () =>
    console.log(
      `Be-nice Special Kitchen running on http://localhost:${PORT}`
    )
);
