import type { BotHandler } from "@towns-protocol/bot";
import { listIssues } from "../api/github-client";
import { parseCommandArgs, validateIssueFilters } from "../utils/arg-parser";

interface GhIssuesEvent {
  channelId: string;
  args: string[];
}

export async function handleGhIssues(
  handler: BotHandler,
  event: GhIssuesEvent
): Promise<void> {
  const { channelId, args } = event;

  if (args.length < 1) {
    await handler.sendMessage(
      channelId,
      "❌ Usage: `/gh_issues owner/repo [count] [--state=open|closed|all] [--creator=username]`\n\nExample: `/gh_issues facebook/react 5 --state=open`"
    );
    return;
  }

  // Parse arguments with filters
  const { repo, count, filters } = parseCommandArgs(args);

  // Validate filters
  const validationError = validateIssueFilters(filters);
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
    const actualIssues = await listIssues(repo, count, filters);

    if (actualIssues.length === 0) {
      await handler.sendMessage(channelId, `No issues found for **${repo}**`);
      return;
    }

    const issueList = actualIssues
      .map(issue => {
        const status = issue.state === "open" ? "🟢 Open" : "✅ Closed";
        const issueLink = `[#${issue.number}](${issue.html_url})`;
        return `• ${issueLink} ${status} - **${issue.title}** by ${issue.user?.login || "Unknown"}`;
      })
      .join("\n\n");

    const message =
      `**Recent Issues - ${repo}**\n` +
      `Showing ${actualIssues.length} most recent issues:\n\n` +
      issueList;

    await handler.sendMessage(channelId, message);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error occurred";
    await handler.sendMessage(channelId, `❌ Error: ${message}`);
  }
}
