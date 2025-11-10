import type { BotHandler } from "@towns-protocol/bot";
import { getIssue, listIssues } from "../api/github-client";
import { stripMarkdown } from "../utils/stripper";
import { truncateText } from "../utils/text";
import { parseCommandArgs, validateIssueFilters } from "../utils/arg-parser";

interface GhIssueEvent {
  channelId: string;
  args: string[];
}

export async function handleGhIssue(
  handler: BotHandler,
  event: GhIssueEvent
): Promise<void> {
  const { channelId, args } = event;

  // Check if this is a list subcommand
  if (args.length > 0 && args[0] === "list") {
    await handleListIssues(handler, channelId, args.slice(1));
    return;
  }

  // Otherwise, handle as show single issue (backward compatible)
  await handleShowIssue(handler, channelId, args);
}

async function handleShowIssue(
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
      "❌ Usage: `/gh_issue owner/repo #123 [--full]` or `/gh_issue owner/repo 123 [--full]`\n\n" +
        "Or use `/gh_issue list owner/repo [count] [--state=...] [--creator=...]` to list issues"
    );
    return;
  }

  // Strip markdown formatting from arguments
  const repo = stripMarkdown(cleanArgs[0]);
  const issueNumber = stripMarkdown(cleanArgs[1]).replace("#", "");

  try {
    const issue = await getIssue(repo, issueNumber);

    const labels = issue.labels
      .map(l => (typeof l === "string" ? l : l.name))
      .join(", ");

    // Format description
    const description = hasFullFlag
      ? issue.body
      : truncateText(issue.body, 100);

    const message =
      `**Issue #${issue.number}**\n` +
      `**${repo}**\n\n` +
      `**${issue.title}**\n\n` +
      (description ? `${description}\n\n` : "") +
      `📊 Status: ${issue.state === "open" ? "🟢 Open" : "✅ Closed"}\n` +
      `👤 Author: ${issue.user?.login || "Unknown"}\n` +
      `💬 Comments: ${issue.comments ?? 0}\n` +
      (labels ? `🏷️ Labels: ${labels}\n` : "") +
      `🔗 ${issue.html_url}`;

    await handler.sendMessage(channelId, message);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error occurred";
    await handler.sendMessage(channelId, `❌ Error: ${message}`);
  }
}

async function handleListIssues(
  handler: BotHandler,
  channelId: string,
  args: string[]
): Promise<void> {
  if (args.length < 1) {
    await handler.sendMessage(
      channelId,
      "❌ Usage: `/gh_issue list owner/repo [count] [--state=open|closed|all] [--creator=username]`\n\nExample: `/gh_issue list facebook/react 5 --state=open`"
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
