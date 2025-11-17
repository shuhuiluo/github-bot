import {
  fetchRepoEvents,
  getPullRequest,
  type GitHubPullRequest,
} from "../api/github-client";
import { dbService } from "../db";
import type { GitHubEvent } from "../types/github-events-api";

/**
 * Map short event type names to GitHub event types
 */
const EVENT_TYPE_MAP: Record<string, string> = {
  pr: "PullRequestEvent",
  issues: "IssuesEvent",
  commits: "PushEvent",
  releases: "ReleaseEvent",
  ci: "WorkflowRunEvent",
  comments: "IssueCommentEvent",
  reviews: "PullRequestReviewEvent",
};

/**
 * Check if an event matches the subscription's event type filter
 * @param eventType GitHub event type (e.g., "PullRequestEvent") or null
 * @param subscriptionTypes Comma-separated event types (e.g., "pr,issues") or "all" or null
 */
function isEventTypeMatch(
  eventType: string | null,
  subscriptionTypes: string | null | undefined
): boolean {
  // Treat null event type or null/undefined/"all" subscription as match
  if (!eventType || !subscriptionTypes || subscriptionTypes === "all")
    return true;

  const subscribedTypes = subscriptionTypes.split(",").map(t => t.trim());

  // Check if the event type matches any of the subscribed short names
  for (const shortName of subscribedTypes) {
    if (EVENT_TYPE_MAP[shortName] === eventType) {
      return true;
    }
  }

  return false;
}

/**
 * Format GitHub Events API events into human-readable messages
 * Events API has different structure than webhooks
 *
 * Note: Events API returns minimal PR objects without title/html_url.
 * Full PR details are passed via prDetailsMap (fetched upfront in parallel).
 */
function formatEvent(
  event: GitHubEvent,
  prDetailsMap: Map<number, GitHubPullRequest>
): string {
  const { type, payload, actor, repo } = event;

  switch (type) {
    case "PullRequestEvent": {
      const { action, pull_request: pr, number } = payload;

      if (!pr || !number) return "";

      // HTML URL: https://github.com/{repo}/pull/{number}
      const htmlUrl = `https://github.com/${repo.name}/pull/${number}`;

      // Look up full PR details from map
      const fullPr = prDetailsMap.get(number);

      if (!fullPr) {
        // Fallback if PR details not available
        return (
          `🔔 **Pull Request ${action}**\n` +
          `**${repo.name}** #${number}\n` +
          `👤 ${actor.login}\n` +
          `🔗 ${htmlUrl}`
        );
      }

      if (action === "opened") {
        return (
          `🔔 **Pull Request Opened**\n` +
          `**${repo.name}** #${number}\n\n` +
          `**${fullPr.title}**\n` +
          `👤 ${actor.login}\n` +
          `🔗 ${htmlUrl}`
        );
      }

      if (action === "closed" && fullPr.merged) {
        return (
          `✅ **Pull Request Merged**\n` +
          `**${repo.name}** #${number}\n\n` +
          `**${fullPr.title}**\n` +
          `👤 ${actor.login}\n` +
          `🔗 ${htmlUrl}`
        );
      }

      if (action === "closed" && !fullPr.merged) {
        return (
          `❌ **Pull Request Closed**\n` +
          `**${repo.name}** #${number}\n\n` +
          `**${fullPr.title}**\n` +
          `👤 ${actor.login}\n` +
          `🔗 ${htmlUrl}`
        );
      }
      return "";
    }

    case "IssuesEvent": {
      const { action, issue } = payload;

      if (!issue) return "";

      if (action === "opened") {
        return (
          `🐛 **Issue Opened**\n` +
          `**${repo.name}** #${issue.number}\n\n` +
          `**${issue.title}**\n` +
          `👤 ${actor.login}\n` +
          `🔗 ${issue.html_url}`
        );
      }

      if (action === "closed") {
        return (
          `✅ **Issue Closed**\n` +
          `**${repo.name}** #${issue.number}\n\n` +
          `**${issue.title}**\n` +
          `👤 ${actor.login}\n` +
          `🔗 ${issue.html_url}`
        );
      }
      return "";
    }

    case "PushEvent": {
      const { commits, ref } = payload;

      if (!commits || commits.length === 0) return "";

      const branch = ref?.replace("refs/heads/", "") || "unknown";
      const commitCount = commits.length;

      let message =
        `📦 **Push to ${repo.name}**\n` +
        `🌿 Branch: \`${branch}\`\n` +
        `👤 ${actor.login}\n` +
        `📝 ${commitCount} commit${commitCount > 1 ? "s" : ""}\n\n`;

      // Show first 3 commits
      const displayCommits = commits.slice(0, 3);
      for (const commit of displayCommits) {
        const shortSha = commit.sha.substring(0, 7);
        const shortMessage = commit.message.split("\n")[0].substring(0, 60);
        message += `\`${shortSha}\` ${shortMessage}\n`;
      }

      if (commitCount > 3) {
        message += `\n_... and ${commitCount - 3} more commit${commitCount - 3 > 1 ? "s" : ""}_`;
      }

      return message;
    }

    case "ReleaseEvent": {
      const { action, release } = payload;

      if (!release) return "";

      if (action === "published") {
        return (
          `🚀 **Release Published**\n` +
          `**${repo.name}** ${release.tag_name}\n\n` +
          `**${release.name || release.tag_name}**\n` +
          `👤 ${actor.login}\n` +
          `🔗 ${release.html_url}`
        );
      }
      return "";
    }

    case "WorkflowRunEvent": {
      const { action, workflow_run: workflowRun } = payload;

      if (!workflowRun) return "";

      if (action === "completed") {
        const emoji = workflowRun.conclusion === "success" ? "✅" : "❌";
        const status =
          workflowRun.conclusion === "success" ? "Passed" : "Failed";

        return (
          `${emoji} **CI ${status}**\n` +
          `**${repo.name}**\n` +
          `🔧 ${workflowRun.name}\n` +
          `🌿 ${workflowRun.head_branch}\n` +
          `🔗 ${workflowRun.html_url}`
        );
      }
      return "";
    }

    case "IssueCommentEvent": {
      const { action, issue, comment } = payload;

      if (!issue || !comment) return "";

      if (action === "created") {
        const shortComment = comment.body.split("\n")[0].substring(0, 100);

        return (
          `💬 **New Comment on Issue #${issue.number}**\n` +
          `**${repo.name}**\n\n` +
          `"${shortComment}${comment.body.length > 100 ? "..." : ""}"\n` +
          `👤 ${actor.login}\n` +
          `🔗 ${comment.html_url}`
        );
      }
      return "";
    }

    case "PullRequestReviewEvent": {
      const { action, pull_request: pr, review } = payload;

      if (!pr || !review) return "";

      if (action === "submitted") {
        let emoji = "👀";
        if (review.state === "approved") emoji = "✅";
        if (review.state === "changes_requested") emoji = "🔄";

        return (
          `${emoji} **PR Review: ${review.state.replace("_", " ")}**\n` +
          `**${repo.name}** #${pr.number}\n\n` +
          `**${pr.title}**\n` +
          `👤 ${actor.login}\n` +
          `🔗 ${review.html_url}`
        );
      }
      return "";
    }

    // Ignore other event types for now
    default:
      return "";
  }
}

/**
 * Polling service that checks GitHub repositories for new events
 */
export class PollingService {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private isPolling = false;
  private sendMessageFn:
    | ((channelId: string, message: string) => Promise<void>)
    | null = null;

  constructor(private pollIntervalMs: number = 5 * 60 * 1000) {}

  /**
   * Set the function used to send messages to Towns channels
   */
  setSendMessageFunction(
    fn: (channelId: string, message: string) => Promise<void>
  ): void {
    this.sendMessageFn = fn;
  }

  /**
   * Start the polling service
   */
  start(): void {
    if (this.intervalId) {
      console.log("Polling service already running");
      return;
    }

    console.log(
      `Starting polling service (interval: ${this.pollIntervalMs}ms)`
    );

    // Poll immediately on start
    void this.poll();

    // Then poll on interval
    this.intervalId = setInterval(() => {
      void this.poll();
    }, this.pollIntervalMs);
  }

  /**
   * Stop the polling service
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log("Polling service stopped");
    }
  }

  /**
   * Poll all subscribed repositories for new events
   */
  private async poll(): Promise<void> {
    if (this.isPolling) {
      console.log("Poll already in progress, skipping...");
      return;
    }

    if (!this.sendMessageFn) {
      console.error("Send message function not set, cannot poll");
      return;
    }

    this.isPolling = true;

    try {
      const repos = await dbService.getAllSubscribedRepos();

      if (repos.length === 0) {
        console.log("No subscribed repos to poll");
        this.isPolling = false;
        return;
      }

      console.log(`Polling ${repos.length} repositories...`);

      for (const repo of repos) {
        try {
          await this.pollRepo(repo);
        } catch (error) {
          console.error(`Error polling ${repo}:`, error);
        }
      }

      console.log(`Finished polling ${repos.length} repositories`);
    } catch (error) {
      console.error("Error in polling service:", error);
    } finally {
      this.isPolling = false;
    }
  }

  /**
   * Poll a single repository for new events
   */
  private async pollRepo(repo: string): Promise<void> {
    // Get polling state (ETag and last seen event ID)
    const state = await dbService.getPollingState(repo);
    const etag = state?.etag;
    const lastEventId = state?.lastEventId;

    // Fetch events with ETag
    const result = await fetchRepoEvents(repo, etag);

    // 304 Not Modified - no new events
    if (result.notModified) {
      console.log(`${repo}: No changes (304 Not Modified)`);
      await dbService.updatePollingState(repo, {
        lastPolledAt: new Date(),
      });
      return;
    }

    const { events, etag: newEtag } = result;

    if (events.length === 0) {
      console.log(`${repo}: No events returned`);
      await dbService.updatePollingState(repo, {
        etag: newEtag,
        lastPolledAt: new Date(),
      });
      return;
    }

    // Filter out events we've already seen
    let newEvents = events;
    if (lastEventId) {
      const lastSeenIndex = events.findIndex(e => e.id === lastEventId);
      if (lastSeenIndex >= 0) {
        // Only include events after the last seen event
        newEvents = events.slice(0, lastSeenIndex);
      }
    }

    console.log(
      `${repo}: ${events.length} total events, ${newEvents.length} new`
    );

    if (newEvents.length > 0) {
      // Get all channels subscribed to this repo
      const channels: Array<{ channelId: string; eventTypes: string | null }> =
        await dbService.getRepoSubscribers(repo);

      // Process events in chronological order (oldest first)
      const eventsToSend = newEvents.reverse();

      // Fetch all PR details upfront (in parallel) for events that need them
      const prNumbers = new Set<number>();
      for (const event of eventsToSend) {
        if (
          event.type === "PullRequestEvent" &&
          event.payload &&
          typeof event.payload === "object" &&
          "number" in event.payload
        ) {
          prNumbers.add(event.payload.number as number);
        }
      }

      // Fetch PR details in parallel
      const prDetailsMap = new Map<number, GitHubPullRequest>();
      if (prNumbers.size > 0) {
        const prFetchPromises = Array.from(prNumbers).map(async prNumber => {
          try {
            const prDetails = await getPullRequest(repo, prNumber.toString());
            return { prNumber, prDetails };
          } catch (error) {
            console.error(
              `Failed to fetch PR #${prNumber} for ${repo}:`,
              error
            );
            return null;
          }
        });

        const prResults = await Promise.all(prFetchPromises);
        for (const result of prResults) {
          if (result) {
            prDetailsMap.set(result.prNumber, result.prDetails);
          }
        }
      }

      for (const event of eventsToSend) {
        // TODO: Add runtime validation with Zod to safely parse GitHub API events
        // Currently using unsafe cast which bypasses type safety at runtime.
        // GitHub API could change or return malformed data, causing silent failures.
        // Recommended: Create Zod schemas for event payloads, validate at API boundary,
        // and gracefully skip invalid events with proper error logging.
        // See: https://github.com/colinhacks/zod
        const message = formatEvent(
          event as unknown as GitHubEvent,
          prDetailsMap
        );

        if (message) {
          // Filter channels based on their event type preferences
          const channelsForEvent = channels.filter(channel =>
            isEventTypeMatch(event.type, channel.eventTypes)
          );

          if (channelsForEvent.length === 0) continue;

          // Send to filtered channels in parallel
          // Use Promise.allSettled to attempt all channels independently
          const sendPromises = channelsForEvent.map(({ channelId }) =>
            this.sendMessageFn!(channelId, message).then(
              () => ({ status: "fulfilled" as const, channelId }),
              error => ({ status: "rejected" as const, channelId, error })
            )
          );

          const results = await Promise.allSettled(sendPromises);

          // Log failures for each channel
          results.forEach(result => {
            if (result.status === "rejected") {
              console.error(`Failed to send event to channel:`, result.reason);
            } else if (result.value.status === "rejected") {
              console.error(
                `Failed to send event to channel ${result.value.channelId}:`,
                result.value.error
              );
            }
          });
        }
      }

      // Update polling state with new ETag and last seen event ID
      await dbService.updatePollingState(repo, {
        etag: newEtag,
        lastEventId: events[0].id, // Most recent event ID
        lastPolledAt: new Date(),
      });
    } else {
      // No new events, just update ETag and timestamp
      await dbService.updatePollingState(repo, {
        etag: newEtag,
        lastPolledAt: new Date(),
      });
    }
  }
}

export const pollingService = new PollingService();
