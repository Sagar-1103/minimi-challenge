import { prisma } from "../lib/prisma";
import { embeddingService } from "../services/embedding.service";
import { logger } from "../utils/logger";

async function main() {
  console.log("Seeding Minimi Benchmark Scenarios...");

  // Clear existing benchmark conversations if re-running
  await prisma.conversation.deleteMany({
    where: {
      title: {
        in: [
          "[Benchmark] Postgres Hosting Shortlist",
          "[Benchmark] CRM Tools Evaluation",
          "[Benchmark] Hokkaido Winter Vacation",
        ],
      },
    },
  });

  // 1. Thread: Postgres Hosting (Date: Tuesday, 3 November 2026)
  const postgresDate = new Date("2026-11-03T14:00:00.000Z");
  const postgresConv = await prisma.conversation.create({
    data: {
      title: "[Benchmark] Postgres Hosting Shortlist",
      createdAt: postgresDate,
      updatedAt: postgresDate,
    },
  });

  const postgresUserMsg = await prisma.message.create({
    data: {
      conversationId: postgresConv.id,
      role: "user",
      content: "What are the best Postgres hosting options for a small team?",
      timestamp: postgresDate,
    },
  });

  const postgresAssistantDate = new Date("2026-11-03T14:00:15.000Z");
  await prisma.message.create({
    data: {
      conversationId: postgresConv.id,
      role: "assistant",
      content: `Here are the top managed and serverless Postgres options for a small team:

1. **Neon Serverless Postgres**:
   - Free tier provides 0.5 GB storage with shared compute.
   - Launch plan is $19/month with 10 GB storage and autoscaling compute.
   - Ideal for serverless architectures, branching, and preview environments.

2. **Supabase Postgres**:
   - Free plan includes 500 MB database storage and 2 active projects.
   - Pro plan is $25/month with 8 GB database storage included.
   - Includes full developer suite: Auth, Storage, Edge Functions, and Realtime.`,
      timestamp: postgresAssistantDate,
    },
  });

  // 2. Thread: CRM Tools (Date: Monday, 9 November 2026)
  const crmDate = new Date("2026-11-09T10:30:00.000Z");
  const crmConv = await prisma.conversation.create({
    data: {
      title: "[Benchmark] CRM Tools Evaluation",
      createdAt: crmDate,
      updatedAt: crmDate,
    },
  });

  const crmUserMsg = await prisma.message.create({
    data: {
      conversationId: crmConv.id,
      role: "user",
      content: "On Monday we shortlisted 5 CRM tools for a 20-person sales team. What are the key plans and pricing?",
      timestamp: crmDate,
    },
  });

  const crmAssistantDate = new Date("2026-11-09T10:30:20.000Z");
  await prisma.message.create({
    data: {
      conversationId: crmConv.id,
      role: "assistant",
      content: `Here is the shortlist of 5 CRM tools evaluated for your 20-person sales team:

1. **HubSpot**: Sales Hub Professional is $90/seat/month billed annually. Free tools remain free for up to 5 users. Best for unified marketing and sales pipeline.
2. **Salesforce**: Starter Suite is $25/user/month; Pro Suite is $100/user/month. Comprehensive ecosystem with deep workflow customization.
3. **Pipedrive**: Essential plan is $14/user/month; Advanced plan is $34/user/month. Great visual pipeline and activity-based selling.
4. **Zoho CRM**: Standard plan is $14/user/month; Professional is $23/user/month. Cost-effective with extensive Zoho suite integrations.
5. **Close**: Basic plan is $49/user/month; Professional is $99/user/month. Built specifically for high-velocity inside sales teams with native calling and email sequences.`,
      timestamp: crmAssistantDate,
    },
  });

  // 3. Thread: Hokkaido Winter Vacation (Semantic Vector Memory Benchmark)
  const hokkaidoDate = new Date("2026-11-01T18:00:00.000Z");
  const hokkaidoConv = await prisma.conversation.create({
    data: {
      title: "[Benchmark] Hokkaido Winter Vacation",
      createdAt: hokkaidoDate,
      updatedAt: hokkaidoDate,
    },
  });

  const hokkaidoUserMsg = await prisma.message.create({
    data: {
      conversationId: hokkaidoConv.id,
      role: "user",
      content: "I'm planning a trip to Hokkaido next winter. I really want to try night skiing and soak in authentic outdoor hot springs.",
      timestamp: hokkaidoDate,
    },
  });

  const hokkaidoAssistantDate = new Date("2026-11-01T18:00:18.000Z");
  await prisma.message.create({
    data: {
      conversationId: hokkaidoConv.id,
      role: "assistant",
      content: `Hokkaido in winter is unforgettable! For night skiing, Niseko Grand Hirafu offers world-class illuminated powder skiing under the floodlights until 7 PM. For authentic outdoor hot springs (rotenburo), Jozankei Onsen and Noboribetsu Onsen provide natural geothermal mineral springs surrounded by pristine snowbanks.`,
      timestamp: hokkaidoAssistantDate,
    },
  });

  // Generate vector embeddings for user messages to support semantic recall
  const userMessages = [postgresUserMsg, crmUserMsg, hokkaidoUserMsg];
  for (const msg of userMessages) {
    if (!msg.content) continue;
    try {
      const vector = await embeddingService.getEmbedding(msg.content);
      if (vector && vector.length > 0 && !vector.every((v) => v === 0)) {
        const vectorStr = `[${vector.join(",")}]`;
        await prisma.$executeRawUnsafe(
          `UPDATE messages SET embedding = $1::vector WHERE id = $2;`,
          vectorStr,
          msg.id
        );
        console.log(`  - Embedded message: "${msg.content.slice(0, 40)}..."`);
      }
    } catch (err: any) {
      logger.warn(`Could not compute vector embedding for message ${msg.id}: ${err.message}`);
    }
  }

  console.log("\nBenchmark scenarios seeded successfully!");
  console.log("You can now ask the agent:");
  console.log('  1. "On Monday we shortlisted 5 CRM tools for a 20-person sales team. Has any of them changed pricing or shipped something big since?"');
  console.log('  2. "What did I ask you on 3 November? Is your answer still correct today?"');
  console.log('  3. "Last Tuesday I asked you about Postgres hosting. Has any pricing changed since then?"');
  console.log('  4. "What cold weather vacation destinations did I mention wanting to visit?" (Semantic recall)\n');
}

main()
  .catch((e) => {
    console.error("Error seeding benchmarks:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
