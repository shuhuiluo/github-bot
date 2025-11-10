import type { BotHandler } from "@towns-protocol/bot";
import { getPullRequest, listPullRequests } from "../api/github-client";
import { stripMarkdown } from "../utils/stripper";
import { truncateText } from "../utils/text";
import { parseCommandArgs, validatePrFilters } from "../utils/arg-parser";

interface GhPrEvent {
  channelId: string;
  args: string[];
}

export async function handleGhPr(
  handler: BotHandler,
  event: GhPrEvent
): Promise<void> {
  const { channelId, args } = event;

  // Check if this is a list subcommand
  if (args.length > 0 && args[0] === "list") {
    await handleListPrs(handler, channelId, args.slice(1));
    return;
  }

  // Otherwise, handle as show single PR (backward compatible)
  await handleShowPr(handler, channelId, args);
}

async function handleShowPr(
  handler: BotHandler,
  channelId: string,
  args: string[]
): Promise<void> {
  // Check for --full flag
  const hasFullFlag = args.includes("--full");
  const cleanArgs = args.filter(arg => arg !== "--full");

  if (cleanArgs.length < 2) {
    await handler.sendMessage(
      channelId,
      "❌ Usage: `/gh_pr owner/repo #123 [--full]` or `/gh_pr owner/repo 123 [--full]`\n\n" +
        "Or use `/gh_pr list owner/repo [count] [--state=...] [--author=...]` to list PRs"
    );
    return;
  }

  // Strip markdown formatting from arguments
  const repo = stripMarkdown(cleanArgs[0]);
  const prNumber = stripMarkdown(cleanArgs[1]).replace("#", "");

  try {
    const pr = await getPullRequest(repo, prNumber);

    // Format description
    const description = hasFullFlag ? pr.body : truncateText(pr.body, 100);

    const message =
      `**Pull Request #${pr.number}**\n` +
      `**${repo}**\n\n` +
      `**${pr.title}**\n\n` +
      (description ? `${description}\n\n` : "") +
      `📊 Status: ${pr.state === "open" ? "🟢 Open" : pr.merged ? "✅ Merged" : "❌ Closed"}\n` +
      `👤 Author: ${pr.user?.login || "Unknown"}\n` +
      `📝 Changes: +${pr.additions ?? 0} -${pr.deletions ?? 0}\n` +
      `💬 Comments: ${pr.comments ?? 0}\n` +
      `🔗 ${pr.html_url}`;

    await handler.sendMessage(channelId, message);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error occurred";
    await handler.sendMessage(channelId, `❌ Error: ${message}`);
  }
}

async function handleListPrs(
  handler: BotHandler,
  channelId: string,
  args: string[]
): Promise<void> {
  if (args.length < 1) {
    await handler.sendMessage(
      channelId,
      "❌ Usage: `/gh_pr list owner/repo [count] [--state=open|closed|merged|all] [--author=username]`\n\nExample: `/gh_pr list facebook/react 5 --state=open`"
    );
    return;
  }

  // Parse arguments with filters
  const { repo, count, filters } = parseCommandArgs(args);

  // Validate filters
  const validationError = validatePrFilters(filters);
  if (validationError) {
    await handler.sendMessage(channelId, `❌ ${validationError}`);
    return;
  }

  if (isNaN(count) || count < 1 || count > 50) {
    await handler.sendMessage(
      channelId,
      "❌ Count must be a number between 1 and 50"
    );
    return;
  }

  try {
    const prs = await listPullRequests(repo, count, filters);

    if (prs.length === 0) {
      await handler.sendMessage(
        channelId,
        `No pull requests found for **${repo}**`
      );
      return;
    }

    const prList = prs
      .map(pr => {
        const status = pr.draft
          ? "📝 Draft"
          : pr.state === "open"
            ? "🟢 Open"
            : pr.merged_at
              ? "✅ Merged"
              : "❌ Closed";
        const prLink = `[#${pr.number}](${pr.html_url})`;
        return `• ${prLink} ${status} - **${pr.title}** by ${pr.user?.login || "Unknown"}`;
      })
      .join("\n\n");

    const message =
      `**Recent Pull Requests - ${repo}**\n` +
      `Showing ${prs.length} most recent PRs:\n\n` +
      prList;

    await handler.sendMessage(channelId, message);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error occurred";
    await handler.sendMessage(channelId, `❌ Error: ${message}`);
  }
}
