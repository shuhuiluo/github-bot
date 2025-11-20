import {
  fetchRepoEvents,
  getPullRequest,
  type GitHubPullRequest,
} from "../api/github-client";
import { dbService } from "../db";
import { validateGitHubEvent } from "../types/events-api";
import { formatEvent } from "../formatters/events-api";

/**
 * Map short event type names to GitHub event types
 * Values can be comma-separated to map one short name to multiple event types
 */
const EVENT_TYPE_MAP: Record<string, string> = {
  pr: "PullRequestEvent",
  issues: "IssuesEvent",
  commits: "PushEvent",
  releases: "ReleaseEvent",
  ci: "WorkflowRunEvent",
  comments: "IssueCommentEvent",
  reviews: "PullRequestReviewEvent",
  branches: "CreateEvent,DeleteEvent",
  review_comments: "PullRequestReviewCommentEvent",
  stars: "WatchEvent",
  forks: "ForkEvent",
};

/**
 * Check if an event matches the subscription's event type filter
 * @param eventType - GitHub event type (e.g., "PullRequestEvent") or null
 * @param subscriptionTypes - Comma-separated event types (e.g., "pr,issues") or "all" or null
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
    const mappedTypes = EVENT_TYPE_MAP[shortName]?.split(",") ?? [];
    if (mappedTypes.includes(eventType)) {
      return true;
    }
  }

  return false;
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
   * Check if a repository should use polling mode
   * (Skip polling if GitHub App is installed for the repo)
   */
  private shouldPollRepo(repo: string): Promise<boolean> {
    return this.checkIfRepoNeedsPolling
      ? this.checkIfRepoNeedsPolling(repo)
      : Promise.resolve(true);
  }

  private checkIfRepoNeedsPolling: ((repo: string) => Promise<boolean>) | null =
    null;

  /**
   * Set the function to check if a repo needs polling
   * (Used for dual-mode: skip if GitHub App installed)
   */
  setCheckIfRepoNeedsPolling(fn: (repo: string) => Promise<boolean>): void {
    this.checkIfRepoNeedsPolling = fn;
  }

  /**
   * Poll a single repository for new events
   */
  private async pollRepo(repo: string): Promise<void> {
    // Dual-mode check: Skip if GitHub App handles this repo
    if (!(await this.shouldPollRepo(repo))) {
      console.log(`${repo}: Skipping polling (GitHub App webhook mode)`);
      return;
    }

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
        // Validate event against schema
        const validatedEvent = validateGitHubEvent(event);
        if (!validatedEvent) {
          continue; // Skip invalid event (error already logged)
        }

        const message = formatEvent(validatedEvent, prDetailsMap);

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
