import { Telegraf, Markup } from "telegraf";
import path from "path";
import { logger } from "./lib/logger";

const CHANNEL_1 = "@pwxonrender";
const CHANNEL_2 = "@PWXCHATON";

const ZIP_FILE = path.resolve(process.cwd(), "attached_assets/pwx-ads-skipper_1785406063000.zip");

const APK_LINK = "https://github.com/kiwibrowser/src.next/releases/tag/14310011181";

async function isChannelMember(bot: Telegraf, userId: number, channel: string): Promise<boolean> {
  try {
    const member = await bot.telegram.getChatMember(channel, userId);
    return ["member", "administrator", "creator"].includes(member.status);
  } catch {
    return false;
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

  bot.action("check_membership", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    await ctx.answerCbQuery("Checking your membership…");

    const [inChannel1, inChannel2] = await Promise.all([
      isChannelMember(bot, userId, CHANNEL_1),
      isChannelMember(bot, userId, CHANNEL_2),
    ]);

    if (!inChannel1 || !inChannel2) {
      const missing: string[] = [];
      if (!inChannel1) missing.push(`📢 [pwxonrender](https://t.me/pwxonrender)`);
      if (!inChannel2) missing.push(`📢 [PWXCHATON](https://t.me/PWXCHATON)`);

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

    // Both channels joined — send files
    await ctx.reply("✅ *Membership verified!* Sending your files now…", { parse_mode: "Markdown" });

    // 1. Send ZIP directly (212 KB — well within Telegram's limit)
    try {
      await ctx.replyWithDocument(
        { source: ZIP_FILE, filename: "pwx-ads-skipper.zip" },
        { caption: "📦 *PWX Ads Skipper*", parse_mode: "Markdown" },
      );
    } catch (err) {
      logger.error({ err }, "Failed to send ZIP file");
      await ctx.reply("⚠️ Could not send the ZIP file. Please try again later.");
    }

    // 2. Send Kiwi Browser APK as GitHub download link
    await ctx.reply(
      `📱 *Kiwi Browser APK*\n\n` +
        `Download the APK from the official GitHub release:\n` +
        `👉 ${APK_LINK}\n\n` +
        `Tap the link, then download the \`.apk\` file from the Assets section.`,
      { parse_mode: "Markdown" },
    );
  });

  bot.catch((err) => {
    logger.error({ err }, "Telegraf error");
  });

  return bot;
}
