import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to seed the database");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: databaseUrl }),
});

async function main(): Promise<void> {
  const suppliers = [
    {
      id: "supplier-alpine-herb",
      name: "Alpine Herb Collective",
      email: "hello@alpineherb.example",
      country: "Switzerland",
    },
    {
      id: "supplier-botanical-coast",
      name: "Botanical Coast Labs",
      email: "orders@botanicalcoast.example",
      country: "New Zealand",
    },
    {
      id: "supplier-cedar-bloom",
      name: "Cedar & Bloom Botanicals",
      email: "wholesale@cedarbloom.example",
      country: "Canada",
    },
  ];

  for (const supplier of suppliers) {
    await prisma.supplier.upsert({
      where: { email: supplier.email },
      update: supplier,
      create: supplier,
    });
  }

  const products = [
    {
      id: "product-alpine-rose-cleanser",
      name: "Alpine Rose Cream Cleanser",
      price: "24.00",
      stockQuantity: 48,
      organic: true,
      manufacturedOn: new Date("2026-09-10"),
      supplierId: "supplier-alpine-herb",
    },
    {
      id: "product-alpine-calendula-balm",
      name: "Calendula Rescue Balm",
      price: "18.50",
      stockQuantity: 35,
      organic: true,
      manufacturedOn: new Date("2026-08-22"),
      supplierId: "supplier-alpine-herb",
    },
    {
      id: "product-coast-seaweed-serum",
      name: "Coastal Seaweed Hydration Serum",
      price: "32.00",
      stockQuantity: 27,
      organic: true,
      manufacturedOn: new Date("2026-10-02"),
      supplierId: "supplier-botanical-coast",
    },
    {
      id: "product-coast-manuka-mask",
      name: "Manuka & Oat Renewal Mask",
      price: "29.50",
      stockQuantity: 22,
      organic: true,
      manufacturedOn: new Date("2026-09-18"),
      supplierId: "supplier-botanical-coast",
    },
    {
      id: "product-cedar-face-oil",
      name: "Cedar Rosehip Facial Oil",
      price: "36.00",
      stockQuantity: 19,
      organic: true,
      manufacturedOn: new Date("2026-10-05"),
      supplierId: "supplier-cedar-bloom",
    },
  ];

  for (const product of products) {
    await prisma.product.upsert({
      where: { id: product.id },
      update: product,
      create: product,
    });
  }

  const orders = [
    {
      id: "order-morgan-lee",
      customerName: "Morgan Lee",
      total: "56.00",
      status: "PROCESSING",
      items: [
        { productId: "product-alpine-rose-cleanser", quantity: 1, unitPrice: "24.00" },
        { productId: "product-coast-seaweed-serum", quantity: 1, unitPrice: "32.00" },
      ],
    },
    {
      id: "order-jamie-rivera",
      customerName: "Jamie Rivera",
      total: "84.00",
      status: "PENDING",
      items: [
        { productId: "product-alpine-calendula-balm", quantity: 1, unitPrice: "18.50" },
        { productId: "product-coast-manuka-mask", quantity: 1, unitPrice: "29.50" },
        { productId: "product-cedar-face-oil", quantity: 1, unitPrice: "36.00" },
      ],
    },
  ];

  for (const order of orders) {
    const { items, ...orderData } = order;
    await prisma.order.upsert({
      where: { id: order.id },
      update: orderData,
      create: orderData,
    });

    for (const item of items) {
      await prisma.orderItem.upsert({
        where: {
          orderId_productId: {
            orderId: order.id,
            productId: item.productId,
          },
        },
        update: item,
        create: { ...item, orderId: order.id },
      });
    }
  }
}

main()
  .catch((error: unknown) => {
    console.error("Failed to seed the database:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
