# 🌌 The Portal Dashboard

> Real-time insights into attendee journeys, revenue, and event operations for The Portal at Iceland Eclipse

![Next.js](https://img.shields.io/badge/Next.js-15-black?logo=next.js)
![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?logo=typescript)
![Tailwind CSS](https://img.shields.io/badge/Tailwind-3-38bdf8?logo=tailwindcss)
![License](https://img.shields.io/badge/License-MIT-green)

---

## ✨ Features

### 📊 **Overview Dashboard**

- Approved vs Pending revenue at a glance
- Application pipeline metrics
- Real-time data from NocoDB

### 👥 **People Journey Tracker**

Visual conversion funnel showing exactly where each person is:

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│  ACCEPTED   │ →  │  IN CART    │ →  │   PARTIAL   │ →  │  CONFIRMED  │
│ no payment  │    │  checkout   │    │ pass only   │    │pass + lodging│
└─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘
```

- **Accepted** — Application approved, no payment activity yet
- **In Cart** — Items in pending checkout
- **Partial** — Paid for pass OR lodging, but not both
- **Confirmed** — Has both pass AND lodging = ready to attend! 🎉

### 📦 **Products Analytics**

- Revenue breakdown by category (month passes, lodging)
- Sold vs In Cart quantities
- Per-product performance tracking

### 📝 **Applications Pipeline**

- Status breakdown (draft, in review, accepted, rejected)
- Scholarship request tracking

### 🔔 **Payment Notifications** (Webhook)

- Real-time email alerts when payments are approved
- Postmark integration for reliable delivery
- NocoDB webhook receiver

---

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- NocoDB API access
- Postmark account (for notifications)

### Installation

```bash
# Clone the repo
git clone https://github.com/im-xp/portal-dashboard.git
cd portal-dashboard

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env.local
# Edit .env.local with your credentials

# Run development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

### Environment Variables

```bash
# NocoDB API
NOCODB_URL=https://app.nocodb.com/api/v2
NOCODB_TOKEN=your_nocodb_token

# Email Notifications (Postmark)
POSTMARK_SERVER_TOKEN=your_postmark_token
FROM_EMAIL=notifications@your-domain.com
NOTIFY_EMAILS=team@your-domain.com

# Webhook Security
NOCODB_WEBHOOK_SECRET=your_random_secret

# App URL (for email links)
NEXT_PUBLIC_APP_URL=https://your-dashboard.vercel.app
```

---

## 🏗️ Architecture

```
┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│                  │     │                  │     │                  │
│   Next.js App    │────▶│   NocoDB API     │────▶│   PostgreSQL     │
│   (Dashboard)    │     │   (REST)         │     │   (Data)         │
│                  │     │                  │     │                  │
└──────────────────┘     └──────────────────┘     └──────────────────┘
         │
         │  Webhook
         ▼
┌──────────────────┐
│                  │
│    Postmark      │
│    (Email)       │
│                  │
└──────────────────┘
```

---

## 🔧 NocoDB Webhook Setup

To receive real-time payment notifications:

1. Go to NocoDB → `payments` table → Webhooks
2. Create webhook:
   - **Event**: After Update
   - **URL**: `https://your-app.vercel.app/api/webhooks/payment-approved`
   - **Header**: `x-webhook-secret: your_secret`
   - **Condition**: `status = approved`

---

## 🚢 Deployment

### Vercel (Recommended)

1. Push to GitHub
2. Import project in Vercel
3. Add environment variables
4. Deploy!

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/im-xp/portal-dashboard)

---

## 📄 License

MIT © [IM-XP](https://github.com/im-xp)

---

<p align="center">
  <strong>Built with 🧡 for The Portal at Iceland Eclipse</strong>
</p>
