import { Telegraf, Markup } from "telegraf";
import path from "path";
import { logger } from "./lib/logger";

const CHANNEL_1 = "@pwxonrender";
const CHANNEL_2 = "@PWXCHATON";

const ZIP_FILE = path.resolve(process.cwd(), "attached_assets/pwx-ads-skipper_1785406063000.zip");
const APK_LINK = "https://github.com/kiwibrowser/src.next/releases/tag/14310011181";

type MemberStatus = "member" | "not_member" | "bot_not_admin";

async function checkMembership(
  bot: Telegraf,
  userId: number,
  channel: string,
): Promise<MemberStatus> {
  try {
    const member = await bot.telegram.getChatMember(channel, userId);
    logger.info({ channel, userId, status: member.status }, "getChatMember result");
    if (["member", "administrator", "creator"].includes(member.status)) {
      return "member";
    }
    return "not_member";
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ channel, userId, err: msg }, "getChatMember error");

    // Telegram returns these when the bot lacks admin rights in the channel
    if (
      msg.includes("administrator") ||
      msg.includes("not enough rights") ||
      msg.includes("CHAT_ADMIN_REQUIRED") ||
      msg.includes("bot is not a member") ||
      msg.includes("Forbidden")
    ) {
      return "bot_not_admin";
    }

    // "user not found" → user has not joined
    return "not_member";
  }
}

export function createBot(token: string): Telegraf {
  const bot = new Telegraf(token);

  const joinKeyboard = Markup.inlineKeyboard([
    [
      Markup.button.url("📢 Join @pwxonrender", "https://t.me/pwxonrender"),
      Markup.button.url("📢 Join @PWXCHATON", "https://t.me/PWXCHATON"),
    ],
    [Markup.button.callback("✅ I've Joined Both — Send Files", "check_membership")],
  ]);

  bot.start(async (ctx) => {
    await ctx.reply(
      `👋 *Welcome!*\n\n` +
        `To receive the files, you must join *both* channels below:\n\n` +
        `📢 [pwxonrender](https://t.me/pwxonrender)\n` +
        `📢 [PWXCHATON](https://t.me/PWXCHATON)\n\n` +
        `After joining, tap the button below to verify and get your files.`,
      {
        parse_mode: "Markdown",
        ...joinKeyboard,
      },
    );
  });

  // /checkbot command — lets the owner verify the bot has admin rights
  bot.command("checkbot", async (ctx) => {
    const results: string[] = [];
    for (const channel of [CHANNEL_1, CHANNEL_2]) {
      try {
        const me = await bot.telegram.getChatMember(channel, ctx.botInfo.id);
        results.push(`${channel}: bot status = *${me.status}*`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        results.push(`${channel}: ❌ error — ${msg}`);
      }
    }
    await ctx.reply(results.join("\n"), { parse_mode: "Markdown" });
  });

  bot.action("check_membership", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    await ctx.answerCbQuery("Checking your membership…");

    const [status1, status2] = await Promise.all([
      checkMembership(bot, userId, CHANNEL_1),
      checkMembership(bot, userId, CHANNEL_2),
    ]);

    // Bot is not admin in at least one channel — inform the channel owner
    if (status1 === "bot_not_admin" || status2 === "bot_not_admin") {
      const notAdmin: string[] = [];
      if (status1 === "bot_not_admin") notAdmin.push(CHANNEL_1);
      if (status2 === "bot_not_admin") notAdmin.push(CHANNEL_2);
      await ctx.reply(
        `⚙️ *Bot setup required*\n\n` +
          `The bot needs to be an *Administrator* in:\n${notAdmin.map((c) => `• ${c}`).join("\n")}\n\n` +
          `Ask the channel owner to:\n` +
          `1. Open the channel → Manage → Administrators\n` +
          `2. Add *@pwxonrenderbot* as administrator\n` +
          `3. Try again after that.`,
        { parse_mode: "Markdown" },
      );
      return;
    }

    if (status1 !== "member" || status2 !== "member") {
      const missing: string[] = [];
      if (status1 !== "member") missing.push(`📢 [pwxonrender](https://t.me/pwxonrender)`);
      if (status2 !== "member") missing.push(`📢 [PWXCHATON](https://t.me/PWXCHATON)`);

      await ctx.reply(
        `❌ You haven't joined all required channels yet.\n\n` +
          `Please join:\n${missing.join("\n")}\n\n` +
          `Then press the button again.`,
        {
          parse_mode: "Markdown",
          ...joinKeyboard,
        },
      );
      return;
    }

    // Both channels joined ✅
    await ctx.reply("✅ *Membership verified!* Sending your files now…", { parse_mode: "Markdown" });

    // 1. Send ZIP directly (212 KB)
    try {
      await ctx.replyWithDocument(
        { source: ZIP_FILE, filename: "pwx-ads-skipper.zip" },
        { caption: "📦 *PWX Ads Skipper*", parse_mode: "Markdown" },
      );
    } catch (err) {
      logger.error({ err }, "Failed to send ZIP file");
      await ctx.reply("⚠️ Could not send the ZIP file. Please try again later.");
    }

    // 2. Send Kiwi Browser APK link
    await ctx.reply(
      `📱 *Kiwi Browser APK*\n\n` +
        `Download from the official GitHub release:\n` +
        `👉 ${APK_LINK}\n\n` +
        `Tap the link, then download the \`.apk\` from the Assets section.`,
      { parse_mode: "Markdown" },
    );
  });

  bot.catch((err) => {
    logger.error({ err }, "Telegraf error");
  });

  return bot;
}
