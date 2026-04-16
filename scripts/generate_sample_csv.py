"""
Generate synthetic billing CSV (~2400 rows) for integration testing.
"""
from __future__ import annotations

import csv
import random
from datetime import datetime, timedelta

OUT = "sample_billing_2400.csv"

COLUMNS = [
    "order_id",
    "customer_id",
    "order_date",
    "product_id",
    "product_name",
    "category",
    "price",
    "quantity",
    "payment_method",
    "country",
    "city",
]


def main() -> None:
    random.seed(42)
    start = datetime(2024, 1, 1)
    rows = []
    for i in range(2400):
        day = start + timedelta(days=random.randint(0, 300))
        fraud = 1 if random.random() < 0.03 else 0
        price = round(random.uniform(5, 500) + (200 if fraud else 0), 2)  # fraud only biases price, not a column
        rows.append(
            {
                "order_id": f"ORD-{100000 + i}",
                "customer_id": f"CUST-{1000 + (i % 200)}",
                "order_date": day.strftime("%Y-%m-%d"),
                "product_id": f"P-{100 + (i % 50)}",
                "product_name": random.choice(
                    ["Widget A", "Widget B", "Service Pack", "License", "Support"]
                ),
                "category": random.choice(["Electronics", "Services", "Software"]),
                "price": price,
                "quantity": random.randint(1, 5),
                "payment_method": random.choice(["card", "wire", "paypal"]),
                "country": random.choice(["US", "DE", "UK", "FR"]),
                "city": random.choice(["New York", "Berlin", "London", "Paris"]),
            }
        )

    with open(OUT, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=COLUMNS)
        w.writeheader()
        w.writerows(rows)

    print(f"Wrote {len(rows)} rows to {OUT}")


if __name__ == "__main__":
    main()
