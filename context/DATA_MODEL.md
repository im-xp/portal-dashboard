# Dashboard Data Model & API Reference

## NocoDB Connection

```
Base URL: https://app.nocodb.com/api/v2
Auth Header: xc-token: <token>
```

---

## Tables & IDs

| Table          | Table ID          | Description                                |
| -------------- | ----------------- | ------------------------------------------ |
| `applications` | `mhiveeaf8gb9kvy` | Form submissions (one per human per popup) |
| `attendees`    | `mduqna6ve55k8wi` | People on an application (main + family)   |
| `products`     | `mjt8xx9ltkhfcbu` | Purchasable items (passes, lodging)        |
| `humans`       | TBD               | Core identity table                        |
| `payments`     | TBD               | Checkout sessions                          |
| `popups`       | TBD               | Events/cities                              |

---

## Entity Relationships

```
┌─────────────────┐
│     popups      │ (The Portal at Iceland Eclipse)
└────────┬────────┘
         │ 1:many
         ▼
┌─────────────────┐      ┌─────────────────┐
│  applications   │──────│     humans      │
│                 │ many:1│  (citizens)    │
└────────┬────────┘      └─────────────────┘
         │ 1:many
         ▼
┌─────────────────┐      ┌─────────────────┐
│   attendees     │──────│    products     │
│ (main,spouse,   │ many:many (via         │
│  kid, baby)     │  attendee_products)    │
└─────────────────┘      └─────────────────┘
```

---

## API Endpoints

### List Records

```bash
GET /tables/{tableId}/records

# Parameters:
# ?limit=100          # Max records per page
# ?offset=0           # Pagination offset
# ?fields=id,name     # Specific fields only
# ?sort=-created_at   # Sort (- for desc)
# ?where=(status,eq,accepted)  # Filter
```

### Get Linked Records

```bash
GET /tables/{tableId}/links/{columnId}/records/{recordId}

# Example: Get products for attendee ID 4
GET /tables/mduqna6ve55k8wi/links/cjc8h3w216z8n9j/records/4
```

---

## Field Reference

### applications

| Field           | Type     | Description                                  |
| --------------- | -------- | -------------------------------------------- |
| `id`            | int      | Primary key                                  |
| `first_name`    | string   | Applicant first name                         |
| `last_name`     | string   | Applicant last name                          |
| `email`         | string   | Contact email                                |
| `telegram`      | string   | Telegram handle                              |
| `organization`  | string   | Company/org                                  |
| `status`        | string   | `draft`, `in review`, `accepted`, `rejected` |
| `submitted_at`  | datetime | When submitted                               |
| `accepted_at`   | datetime | When accepted                                |
| `citizen_id`    | int      | FK to humans                                 |
| `popup_city_id` | int      | FK to popups                                 |
| `popups`        | object   | Nested popup info `{id, name}`               |
| `humans`        | object   | Nested human info `{id, primary_email}`      |
| `attendees`     | int      | Count of linked attendees                    |
| `payments`      | int      | Count of linked payments                     |

### attendees

| Field               | Type   | Description                             |
| ------------------- | ------ | --------------------------------------- |
| `id`                | int    | Primary key                             |
| `application_id`    | int    | FK to applications                      |
| `name`              | string | Full name                               |
| `email`             | string | Contact email                           |
| `category`          | string | `main`, `spouse`, `kid`, `baby`, `teen` |
| `gender`            | string | Gender                                  |
| `check_in_code`     | string | QR code (e.g., `ICEQPGB`)               |
| `poap_url`          | string | POAP NFT link                           |
| `applications`      | object | Nested app info `{id, first_name}`      |
| `products`          | int    | Count of linked products                |
| `attendee_products` | int    | Count in junction table                 |

**Link Column IDs:**

- Products link: `cjc8h3w216z8n9j`
- Attendee products link: `chpl496x8yj44hf`

### products

| Field               | Type    | Description                             |
| ------------------- | ------- | --------------------------------------- |
| `id`                | int     | Primary key                             |
| `name`              | string  | Product name                            |
| `slug`              | string  | URL-safe name                           |
| `price`             | float   | Price in USD                            |
| `compare_price`     | float   | Original/strikethrough price            |
| `description`       | string  | Product details                         |
| `category`          | string  | `week`, `month`, `day`, `patreon`, etc. |
| `attendee_category` | string  | `main`, `spouse`, `kid`                 |
| `is_active`         | boolean | Currently purchasable                   |
| `popup_city_id`     | int     | FK to popups                            |

---

## Sample Queries

### Get all applications with status

```bash
curl -s "https://app.nocodb.com/api/v2/tables/mhiveeaf8gb9kvy/records?limit=100" \
  -H "xc-token: YOUR_TOKEN"
```

### Get attendees for a specific application

```bash
curl -s "https://app.nocodb.com/api/v2/tables/mduqna6ve55k8wi/records?where=(application_id,eq,4)" \
  -H "xc-token: YOUR_TOKEN"
```

### Get products purchased by an attendee

```bash
curl -s "https://app.nocodb.com/api/v2/tables/mduqna6ve55k8wi/links/cjc8h3w216z8n9j/records/4" \
  -H "xc-token: YOUR_TOKEN"
```

### Filter applications by status

```bash
curl -s "https://app.nocodb.com/api/v2/tables/mhiveeaf8gb9kvy/records?where=(status,eq,accepted)" \
  -H "xc-token: YOUR_TOKEN"
```

---

## Aggregation Patterns

Since NocoDB doesn't support GROUP BY in the REST API, aggregations must be done client-side:

```typescript
// Count applications by status
const statusCounts = applications.reduce((acc, app) => {
  acc[app.status] = (acc[app.status] || 0) + 1;
  return acc;
}, {});

// Sum revenue by product
const revenueByProduct = attendees
  .flatMap((a) => a.products)
  .reduce((acc, p) => {
    acc[p.name] = (acc[p.name] || 0) + p.price;
    return acc;
  }, {});
```

---

## Current Data Snapshot (Dec 17, 2025)

| Metric             | Value    |
| ------------------ | -------- |
| Total Applications | 6        |
| Accepted           | 6 (100%) |
| With Purchases     | 3 (50%)  |
| Products Sold      | 11 items |

| Applicant       | Products                               |
| --------------- | -------------------------------------- |
| MItch Morales   | Portal Patron                          |
| Jon Shapirop    | 8 items (test data)                    |
| MaryLiz Bender  | Portal Entry Pass, Bed (6-person dorm) |
| james ellington | -                                      |
| Mia Hanak       | -                                      |
| Laila Keren     | -                                      |


