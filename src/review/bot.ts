import { Bot, InlineKeyboard, InputFile } from 'grammy';
import { env } from '../config/env.js';
import { logger } from '../monitoring/logger.js';
import { contentItemRepository } from '../db/repositories/content-item.repository.js';
import { reviewActionRepository } from '../db/repositories/review-action.repository.js';
import { assetRepository } from '../db/repositories/asset.repository.js';
import { prisma } from '../db/client.js';
import { publish } from '../linkedin/publish.js';
import { formatPostText } from '../linkedin/publishers/text.js';
import { runContentJob } from '../content/orchestrator.js';
import { parseGenerateArgs, KNOWN_PILLARS } from './parse-generate-args.js';
import type { ContentItem } from '@prisma/client';
import type { Context } from 'grammy';

let bot: Bot | null = null;
const log = logger.child({ module: 'review-bot' });

// Maps telegram user ID string to content item ID string
const editingState = new Map<string, string>();

/**
 * Whether an incoming update comes from the configured Telegram chat. When
 * TELEGRAM_CHAT_ID is unset we cannot verify, so we allow it (the send helpers
 * already warn about the missing chat id). Used to gate token-spending commands.
 */
function isAuthorizedChat(ctx: Context): boolean {
  const allowed = env.TELEGRAM_CHAT_ID;
  if (!allowed) return true;

  const actual = String(ctx.chat?.id);
  const authorized = actual === allowed;
  if (!authorized) {
    log.warn(
      { expectedChatId: allowed, actualChatId: actual },
      'Ignoring command: chat id does not match TELEGRAM_CHAT_ID'
    );
  }
  return authorized;
}

/**
 * Initialize the GrammY Telegram Bot.
 */
export function initBot(): Bot | null {
  const token = env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    log.warn('TELEGRAM_BOT_TOKEN is not set. Telegram review bot is disabled.');
    return null;
  }

  bot = new Bot(token);

  log.info(
    {
      mode: env.TELEGRAM_USE_WEBHOOK ? 'webhook' : 'long-polling',
      chatIdConfigured: Boolean(env.TELEGRAM_CHAT_ID),
      chatId: env.TELEGRAM_CHAT_ID ?? null,
    },
    'Telegram bot instance created'
  );

  // Log every incoming update up front, before any command/auth filtering runs.
  // If a command "does nothing", check whether it even shows up here — if not,
  // the update never reached us (webhook/polling issue), not app logic.
  bot.use(async (ctx, next) => {
    log.info(
      {
        updateId: ctx.update.update_id,
        chatId: ctx.chat?.id,
        fromId: ctx.from?.id,
        fromUsername: ctx.from?.username,
        text: ctx.message?.text,
      },
      'Incoming Telegram update'
    );
    await next();
  });

  // Catch anything that escapes a handler's own try/catch — otherwise it's
  // only printed to stderr by grammy and easy to miss in our logs.
  bot.catch((err) => {
    log.error(
      { err: err.error, updateId: err.ctx.update.update_id },
      'Unhandled error in Telegram bot middleware'
    );
  });

  // ── Commands ───────────────────────────────────────────────────────────
  bot.command('start', async (ctx) => {
    log.info({ chatId: ctx.chat?.id }, 'Received /start command');
    await ctx.reply(
      '🤖 *LinkedIn Content Automation Bot* is active!\n\n' +
        'I deliver draft posts for review and notify you of publish actions.\n\n' +
        '*Commands*\n' +
        '• `/generate [pillar] [format]` — generate a post on demand and send it here for review (nothing is auto‑posted).\n' +
        '• `/status` — pending review / manual counts.\n\n' +
        `Formats: text, image, carousel, infographic, poll\n` +
        `Pillars: ${KNOWN_PILLARS.join(', ')}`,
      { parse_mode: 'Markdown' }
    );
  });

  bot.command('status', async (ctx) => {
    log.info({ chatId: ctx.chat?.id }, 'Received /status command');
    if (!isAuthorizedChat(ctx)) return;

    const pendingCount = (await contentItemRepository.findByStatus('pending_review')).length;
    const manualCount = (await contentItemRepository.findByStatus('manual_required')).length;

    await ctx.reply(
      `📊 **Status Report**\n\n- Pending Review: ${pendingCount}\n- Manual Required (Polls): ${manualCount}`,
      { parse_mode: 'Markdown' }
    );
  });

  // On-demand generation: build a draft now and send it here for review.
  // Never auto-posts — publishing only happens if the user taps "Approve & Post".
  bot.command('generate', async (ctx) => {
    log.info(
      { chatId: ctx.chat?.id, fromId: ctx.from?.id, rawArgs: ctx.match },
      'Received /generate command'
    );

    if (!isAuthorizedChat(ctx)) return;

    const parsed = parseGenerateArgs(ctx.match);
    if (!parsed.ok) {
      log.warn({ rawArgs: ctx.match, error: parsed.error }, '/generate argument parsing failed');
      await ctx.reply(`⚠️ ${parsed.error}`);
      return;
    }

    const { pillar, format } = parsed;
    log.info({ pillar, format }, '/generate resolved pillar/format — starting content job');

    await ctx.reply(
      `⏳ Generating a *${format}* post for *${pillar}*… this can take a moment.`,
      { parse_mode: 'Markdown' }
    );

    try {
      const item = await runContentJob({ pillar, format, mode: 'draft' });
      log.info(
        { contentItemId: item.id, status: item.status },
        '/generate content job finished — routing to Telegram'
      );

      // Polls can't be posted via the official API — deliver manual instructions.
      if (item.status === 'manual_required') {
        await sendManualRequiredToTelegram(item);
      } else {
        await sendDraftToTelegram(item);
      }
      log.info({ contentItemId: item.id }, '/generate draft delivered to Telegram');
    } catch (err: any) {
      log.error({ err, pillar, format }, 'On-demand /generate failed');
      await ctx.reply(`❌ Generation failed: ${err.message}`);
    }
  });

  // ── Callback queries (Inline Buttons) ──────────────────────────────────
  bot.callbackQuery(/^approve_(.+)$/, async (ctx) => {
    const contentItemId = ctx.match[1];
    if (!contentItemId) return;

    await ctx.answerCallbackQuery({ text: 'Processing approval…' });

    try {
      const item = await contentItemRepository.findById(contentItemId);
      if (!item) {
        await ctx.editMessageText('❌ Error: Content item not found.');
        return;
      }

      if (item.status === 'published') {
        await ctx.editMessageText(`✅ Already published URN: ${item.linkedinUrn}`);
        return;
      }

      await ctx.editMessageText('🚀 Publishing to LinkedIn…');

      // Log review action
      await reviewActionRepository.create({
        contentItem: { connect: { id: contentItemId } },
        channel: 'telegram',
        action: 'approve',
        actor: String(ctx.from.id),
      });

      // Update status and publish
      await contentItemRepository.updateStatus(contentItemId, 'approved');
      const result = await publish(item);

      await ctx.editMessageText(
        `✅ **Published to LinkedIn!**\n\n🔗 [View Post](${result.url})\nURN: \`${result.urn}\``,
        { parse_mode: 'Markdown', link_preview: { disable_preview: true } } as any
      );
    } catch (err: any) {
      log.error({ err, contentItemId }, 'Callback approve failed');
      await ctx.editMessageText(`❌ **Publishing Failed:**\n\n${err.message}`);
    }
  });

  bot.callbackQuery(/^reject_(.+)$/, async (ctx) => {
    const contentItemId = ctx.match[1];
    if (!contentItemId) return;

    await ctx.answerCallbackQuery({ text: 'Post rejected.' });

    try {
      await contentItemRepository.updateStatus(contentItemId, 'rejected');
      
      await reviewActionRepository.create({
        contentItem: { connect: { id: contentItemId } },
        channel: 'telegram',
        action: 'reject',
        actor: String(ctx.from.id),
      });

      await ctx.editMessageText('🗑️ **Post Rejected.** Content will not be published.');
    } catch (err: any) {
      log.error({ err, contentItemId }, 'Callback reject failed');
      await ctx.editMessageText(`❌ Error processing rejection: ${err.message}`);
    }
  });

  bot.callbackQuery(/^edit_(.+)$/, async (ctx) => {
    const contentItemId = ctx.match[1];
    if (!contentItemId) return;

    await ctx.answerCallbackQuery();
    editingState.set(String(ctx.from.id), contentItemId);

    await ctx.reply(
      '📝 Please reply directly to this message with the *complete updated body* for the post.',
      { parse_mode: 'Markdown' }
    );
  });

  // ── Handle incoming messages for Editing ───────────────────────────────
  bot.on('message:text', async (ctx) => {
    const userId = String(ctx.from.id);
    const contentItemId = editingState.get(userId);

    if (!contentItemId) {
      // Not in editing mode, ignore or reply
      return;
    }

    editingState.delete(userId);
    const newBody = ctx.message.text;

    try {
      const item = await contentItemRepository.findById(contentItemId);
      if (!item) {
        await ctx.reply('❌ Error: Post not found.');
        return;
      }

      // Update database
      
      const updated = await prisma.contentItem.update({
        where: { id: contentItemId },
        data: { body: newBody },
      });

      // Log review action
      await reviewActionRepository.create({
        contentItem: { connect: { id: contentItemId } },
        channel: 'telegram',
        action: 'edit',
        actor: userId,
        payload: { oldBody: item.body, newBody },
      });

      await ctx.reply('🔄 **Content Updated!** Sending updated draft for approval…');
      await sendDraftToTelegram(updated);
    } catch (err: any) {
      log.error({ err, contentItemId }, 'Failed to edit content item');
      await ctx.reply(`❌ Failed to update content: ${err.message}`);
    }
  });

  // Start the bot
  if (env.TELEGRAM_USE_WEBHOOK) {
    const webhookUrl = `${env.APP_BASE_URL}/telegram/webhook`;
    log.info({ webhookUrl }, 'Registering Telegram Bot webhook');
    bot.api
      .setWebhook(webhookUrl)
      .then(() => {
        log.info({ webhookUrl }, 'Telegram webhook registered successfully');
      })
      .catch((err) => {
        log.error({ err, webhookUrl }, 'Failed to register Telegram webhook');
      });
  } else {
    log.info('Starting Telegram Bot long-polling');
    bot
      .start({
        onStart: (botInfo) => {
          log.info(
            { username: botInfo.username, id: botInfo.id },
            'Telegram long-polling started successfully — bot is receiving updates'
          );
        },
      })
      .catch((err) => {
        log.error({ err }, 'Error during Telegram Bot long polling');
      });
  }

  return bot;
}

/**
 * Retrieve the initialized bot instance (or null if Telegram is not configured).
 */
export function getBot(): Bot | null {
  return bot;
}

/**
 * Format a content item for Telegram preview.
 */
function buildTelegramPreview(item: ContentItem): string {
  return `📝 **DRAFT POST (Pending Review)**

**Hook (see more preview):** 
\`${item.hook}\`

**Body:**
${item.body}

${item.cta ? `**CTA:**\n${item.cta}\n` : ''}
**Hashtags:** \`${item.hashtags.join(' ')}\`

Format: \`${item.format}\` | Pillar: \`${item.pillar}\`
Mode: \`${item.mode}\``;
}

/**
 * Send any rendered visual asset (AI image, infographic, carousel PDF) for a
 * content item ahead of the text preview. Approve/Reject/Edit callbacks rely
 * on editing the *text* message, so the asset is sent as a separate message
 * rather than as a photo caption.
 */
async function sendAssetPreview(chatId: string, item: ContentItem): Promise<void> {
  try {
    const assets = await assetRepository.findByContentItemId(item.id);
    const asset = assets.find((a) => a.type === 'image' || a.type === 'infographic' || a.type === 'pdf');
    if (!asset) return;

    log.info({ contentItemId: item.id, assetType: asset.type, path: asset.path }, 'Sending asset preview to Telegram');
    if (asset.type === 'pdf') {
      await bot!.api.sendDocument(chatId, new InputFile(asset.path));
    } else {
      await bot!.api.sendPhoto(chatId, new InputFile(asset.path));
    }
  } catch (err) {
    log.error({ err, contentItemId: item.id }, 'Failed to send asset preview to Telegram');
  }
}

/**
 * Send a generated draft post to Telegram.
 */
export async function sendDraftToTelegram(item: ContentItem): Promise<void> {
  const chatId = env.TELEGRAM_CHAT_ID;
  if (!bot || !chatId) {
    log.warn(
      { botInitialized: Boolean(bot), chatIdConfigured: Boolean(chatId), contentItemId: item.id },
      'Telegram bot not initialized or TELEGRAM_CHAT_ID missing. Skipping draft send.'
    );
    return;
  }

  await sendAssetPreview(chatId, item);

  const text = buildTelegramPreview(item);
  const keyboard = new InlineKeyboard()
    .text('👍 Approve & Post', `approve_${item.id}`)
    .text('👎 Reject', `reject_${item.id}`)
    .row()
    .text('✏️ Edit Body', `edit_${item.id}`);

  log.info({ contentItemId: item.id, chatId }, 'Sending draft post to Telegram');
  try {
    await bot.api.sendMessage(chatId, text, {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });
    log.info({ contentItemId: item.id }, 'Draft post sent to Telegram successfully');
  } catch (err) {
    log.error({ err, contentItemId: item.id, chatId }, 'Failed to send draft post to Telegram');
    throw err;
  }
}

/**
 * Send system/critical alerts to Telegram.
 */
export async function sendAlertToTelegram(
  message: string,
  level: 'info' | 'warning' | 'error' | 'critical' = 'error',
  context?: any
): Promise<void> {
  const chatId = env.TELEGRAM_CHAT_ID;
  if (!bot || !chatId) {
    log.warn('Telegram bot not initialized or TELEGRAM_CHAT_ID missing. Skipping alert send.');
    return;
  }

  const emojiMap = {
    info: 'ℹ️',
    warning: '⚠️',
    error: '🚨',
    critical: '🔥',
  };

  const text = `${emojiMap[level]} **SYSTEM ALERT [${level.toUpperCase()}]**\n\n${message}${
    context ? `\n\n\`\`\`json\n${JSON.stringify(context, null, 2)}\n\`\`\`` : ''
  }`;

  log.info({ level, chatId }, 'Sending alert to Telegram');
  try {
    await bot.api.sendMessage(chatId, text, { parse_mode: 'Markdown' });
    log.info({ level }, 'Alert sent to Telegram successfully');
  } catch (err) {
    log.error({ err, level, chatId }, 'Failed to send alert to Telegram');
    throw err;
  }
}

/**
 * Deliver manual required instruction (e.g. polls).
 */
export async function sendManualRequiredToTelegram(item: ContentItem): Promise<void> {
  const chatId = env.TELEGRAM_CHAT_ID;
  if (!bot || !chatId) {
    log.warn(
      { botInitialized: Boolean(bot), chatIdConfigured: Boolean(chatId), contentItemId: item.id },
      'Telegram bot not initialized or TELEGRAM_CHAT_ID missing. Skipping manual instruction.'
    );
    return;
  }

  const meta = item.generationMeta as any;
  const pollQuestion = meta?.pollQuestion || 'N/A';
  const pollOptions = (meta?.pollOptions as string[]) || [];

  const text = `📋 **MANUAL POST REQUIRED (Poll Format)**
LinkedIn official API does not support publishing polls directly. Please publish this post manually:

**Step 1: Poll Question & Options**
Question: \`${pollQuestion}\`
Options:
${pollOptions.map((opt, i) => `${i + 1}. \`${opt}\``).join('\n')}

**Step 2: Copy Post commentary text**
\`\`\`
${formatPostText({
  hook: item.hook,
  body: item.body,
  cta: item.cta,
  hashtags: item.hashtags,
})}
\`\`\``;

  log.info({ contentItemId: item.id, chatId }, 'Sending manual-required instructions to Telegram');
  try {
    await bot.api.sendMessage(chatId, text, { parse_mode: 'Markdown' });
    log.info({ contentItemId: item.id }, 'Manual-required instructions sent to Telegram successfully');
  } catch (err) {
    log.error({ err, contentItemId: item.id, chatId }, 'Failed to send manual-required instructions to Telegram');
    throw err;
  }
}
