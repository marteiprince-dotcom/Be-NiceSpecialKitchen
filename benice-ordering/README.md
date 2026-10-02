# Be-nice Special Kitchen — Ordering System

A full-stack local restaurant ordering system built with Node.js, Express, SQLite and vanilla HTML/CSS/JS.

## Features
- Customer menu browsing and cart
- Delivery or pickup checkout
- Cash / Mobile Money payment selection
- Order creation with server-side price validation
- Automatic order numbers
- Restaurant WhatsApp link for each order
- Admin login
- Admin order dashboard with status updates
- Menu management from the admin dashboard
- Restaurant settings (delivery fee, WhatsApp number, opening status)
- SQLite database for local/self-hosted use
- Security headers, password hashing, signed JWT cookie and rate limiting

## Run locally / Codespaces

1. Install Node.js 20+.
2. Copy `.env.example` to `.env`.
3. Set a strong `SESSION_SECRET` and admin password.
4. Run:

```bash
npm install
npm start
```

5. Open `http://localhost:3000`.
6. Admin dashboard: `http://localhost:3000/admin.html`.

Default sample menu items are inserted automatically on first run. Replace them with the restaurant's real menu in the admin dashboard.

## Production notes

This project is ready for a small self-hosted deployment. SQLite needs persistent storage. On Render, attach a persistent disk to the app and point `DB_FILE` at that disk if you use Render. For a larger multi-branch restaurant, replace SQLite with PostgreSQL and add a payment gateway such as Paystack or Hubtel after obtaining merchant credentials.

## Important

Do not commit `.env`. Change the admin credentials before publishing the site.
