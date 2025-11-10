import type { PlainMessage, SlashCommand } from "@towns-protocol/proto";

const commands = [
  {
    name: "help",
    description: "Get help with bot commands",
  },
  {
    name: "github",
    description: "Manage GitHub subscriptions (subscribe, unsubscribe, status)",
  },
  {
    name: "gh_pr",
    description:
      "Show or list pull requests (usage: /gh_pr owner/repo #123 or /gh_pr list owner/repo)",
  },
  {
    name: "gh_issue",
    description: "Show or list issues (usage: /gh_issue owner/repo #123 or /gh_issue list owner/repo)",
  },
] as const satisfies PlainMessage<SlashCommand>[];

export default commands;
