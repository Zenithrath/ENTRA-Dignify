/**
 * Prints a session cookie value so you can smoke-test authenticated pages with curl:
 *
 *   npx tsx scripts/dev-session.ts owner@entra.co.id
 *   curl -s -H "Cookie: entra_session=<token>" http://localhost:3000/dashboard | head
 *
 * Development only — it bypasses the password check by design.
 */
import "dotenv/config";
import { createHash, randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../src/generated/prisma/client";

const email = process.argv[2] ?? "owner@entra.co.id";
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required.");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

async function main() {
  const user = await prisma.user.findFirst({ where: { email, isActive: true } });
  if (!user) throw new Error(`No active user with email ${email}.`);

  const token = randomBytes(32).toString("base64url");
  await prisma.session.create({
    data: {
      userId: user.id,
      tokenHash: createHash("sha256").update(token).digest("hex"),
      expiresAt: new Date(Date.now() + 3_600_000),
      userAgent: "dev-session-script",
    },
  });

  console.log(token);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
