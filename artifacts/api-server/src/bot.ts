import { Telegraf, Markup, type Context } from "telegraf";
import path from "path";
import { fileURLToPath } from "url";
import { logger } from "./lib/logger";

// Both channels — bot is admin in both, verified via getChatMember
const CHANNEL_PWXCHATON = "@PWXCHATON";
const CHANNEL_PWXRENDER = "@pwxonrender";

// __dirname equivalent in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Go up from artifacts/api-server/dist/ → workspace root → attached_assets
const WORKSPACE_ROOT = path.resolve(__dirname, "../../../");
const ZIP_FILE = path.join(WORKSPACE_ROOT, "attached_assets/pwx-ads-skipper_1785406063000.zip");
const APK_LINK = "https://github.com/kiwibrowser/src.next/releases/tag/14310011181";

// Per-user verification state (in-memory)
interface UserState {
  pwxchatVerified: boolean;
  pwxrenderVerified: boolean;
}
const userState = new Map<number, UserState>();

function getState(userId: number): UserState {
  if (!userState.has(userId)) {
    userState.set(userId, { pwxchatVerified: false, pwxrenderVerified: false });
  }
  return userState.get(userId)!;
}

async function isChatMember(bot: Telegraf, userId: number, channel: string): Promise<boolean> {
  try {
    const member = await bot.telegram.getChatMember(channel, userId);
    logger.info({ channel, userId, status: member.status }, "getChatMember result");
    return ["member", "administrator", "creator"].includes(member.status);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ channel, userId, err: msg }, "getChatMember failed");
    return false;
  }
}

async function sendFiles(ctx: Context): Promise<void> {
  await ctx.reply("✅ *Both channels verified!* Sending your files now…", {
    parse_mode: "Markdown",
  });

  try {
    await ctx.replyWithDocument(
      { source: ZIP_FILE, filename: "pwx-ads-skipper.zip" },
      { caption: "📦 *PWX Ads Skipper*", parse_mode: "Markdown" },
    );
  } catch (err) {
    logger.error({ err, ZIP_FILE }, "Failed to send ZIP file");
    await ctx.reply("⚠️ Could not send the ZIP file. Please try again later.");
  }

  await ctx.reply(
    `📱 *Kiwi Browser APK*\n\n` +
      `Download from the official GitHub release:\n` +
      `👉 ${APK_LINK}\n\n` +
      `Tap the link, then download the \`.apk\` from the Assets section.`,
    { parse_mode: "Markdown" },
  );
}

export function createBot(token: string): Telegraf {
  const bot = new Telegraf(token);

  const startKeyboard = Markup.inlineKeyboard([
    [
      Markup.button.url("📢 Join @pwxonrender", "https://t.me/pwxonrender"),
      Markup.button.url("📢 Join @PWXCHATON", "https://t.me/PWXCHATON"),
    ],
    [Markup.button.callback("✅ I've Joined Both — Send Files", "check_both")],
  ]);

  bot.start(async (ctx) => {
    userState.delete(ctx.from.id);
    await ctx.reply(
      `👋 *Welcome to PWX Bot!*\n\n` +
        `To receive the files, join *both* channels:\n\n` +
        `📢 [pwxonrender](https://t.me/pwxonrender)\n` +
        `📢 [PWXCHATON](https://t.me/PWXCHATON)\n\n` +
        `After joining, press the button below.`,
      { parse_mode: "Markdown", ...startKeyboard },
    );
  });

  // Single button — verify both channels at once
  bot.action("check_both", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;
    await ctx.answerCbQuery("Checking membership…");

    const [inPwxchat, inPwxrender] = await Promise.all([
      isChatMember(bot, userId, CHANNEL_PWXCHATON),
      isChatMember(bot, userId, CHANNEL_PWXRENDER),
    ]);

    if (!inPwxchat && !inPwxrender) {
      await ctx.reply(
        `❌ You haven't joined *either* channel yet.\n\nJoin both and try again.`,
        {
          parse_mode: "Markdown",
          ...Markup.inlineKeyboard([
            [
              Markup.button.url("📢 Join @pwxonrender", "https://t.me/pwxonrender"),
              Markup.button.url("📢 Join @PWXCHATON", "https://t.me/PWXCHATON"),
            ],
            [Markup.button.callback("🔄 Try Again", "check_both")],
          ]),
        },
      );
      return;
    }

    if (!inPwxchat) {
      await ctx.reply(
        `❌ You haven't joined *@PWXCHATON* yet.\n\nJoin and try again.`,
        {
          parse_mode: "Markdown",
          ...Markup.inlineKeyboard([
            [Markup.button.url("📢 Join @PWXCHATON", "https://t.me/PWXCHATON")],
            [Markup.button.callback("🔄 Try Again", "check_both")],
          ]),
        },
      );
      return;
    }

    if (!inPwxrender) {
      await ctx.reply(
        `❌ You haven't joined *@pwxonrender* yet.\n\nJoin and try again.`,
        {
          parse_mode: "Markdown",
          ...Markup.inlineKeyboard([
            [Markup.button.url("📢 Join @pwxonrender", "https://t.me/pwxonrender")],
            [Markup.button.callback("🔄 Try Again", "check_both")],
          ]),
        },
      );
      return;
    }

    // Both verified
    getState(userId).pwxchatVerified = true;
    getState(userId).pwxrenderVerified = true;
    await sendFiles(ctx);
  });

  // Catch stray messages
  bot.on("message", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;
    const state = getState(userId);
    if (!state.pwxchatVerified || !state.pwxrenderVerified) {
      await ctx.reply("Use /start to begin the verification process.");
    }
  });

  // /checkbot — debug admin status
  bot.command("checkbot", async (ctx) => {
    const results: string[] = [`*ZIP path:* \`${ZIP_FILE}\``];
    for (const channel of [CHANNEL_PWXCHATON, CHANNEL_PWXRENDER]) {
      try {
        const me = await bot.telegram.getChatMember(channel, ctx.botInfo.id);
        results.push(`${channel}: bot status = *${me.status}*`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        results.push(`${channel}: ❌ ${msg}`);
      }
    }
    await ctx.reply(results.join("\n"), { parse_mode: "Markdown" });
  });

  bot.catch((err) => {
    logger.error({ err }, "Telegraf error");
  });

  return bot;
}
