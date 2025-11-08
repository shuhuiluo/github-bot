import type { BotHandler } from "@towns-protocol/bot";
import { listPullRequests } from "../api/github-client";
import { parseCommandArgs, validatePrFilters } from "../utils/arg-parser";

interface GhPrsEvent {
  channelId: string;
  args: string[];
}

export async function handleGhPrs(
  handler: BotHandler,
  event: GhPrsEvent
): Promise<void> {
  const { channelId, args } = event;

  if (args.length < 1) {
    await handler.sendMessage(
      channelId,
      "❌ Usage: `/gh_prs owner/repo [count] [--state=open|closed|merged|all] [--author=username]`\n\nExample: `/gh_prs facebook/react 5 --state=open`"
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
